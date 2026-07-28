import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadPostLog } from "./logging";
import { postCurrentSlot } from "./postCurrentSlot";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { Platform, PostLogEntry } from "./types";

const PLATFORMS: Platform[] = ["facebook", "instagram"];
const SLA_TARGET = 0.95;

export type SlaCheckpointMode = "preflight" | "overdue";

export interface SlaCheckpoint {
  slot: 1 | 2;
  mode: SlaCheckpointMode;
  expected_time: "10:45" | "11:45" | "18:45" | "19:45";
}

export interface PublishingSlaReport {
  generated_at: string;
  date: string;
  checkpoint: SlaCheckpoint;
  checkpoint_status: "pass" | "alert";
  message: string;
  rolling_14_days: {
    start_date: string;
    end_date: string;
    due_slots: number;
    dual_platform_success_slots: number;
    fulfillment_rate: number | null;
    target: number;
    target_met: boolean | null;
  };
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function minutesOfDay(time: string): number {
  const [hour = Number.NaN, minute = Number.NaN] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error(`Invalid time: ${time}`);
  return hour * 60 + minute;
}

function isLiveSuccess(entries: PostLogEntry[], slot: number, platform: Platform): boolean {
  return entries.some(
    (entry) =>
      entry.slot === slot &&
      entry.platform === platform &&
      !entry.dry_run &&
      ["success", "posted"].includes(entry.status)
  );
}

export function resolveSlaCheckpoint(now: Date, timezone = "Asia/Taipei"): SlaCheckpoint {
  const { time } = getZonedDateParts(now, timezone);
  const checkpoints: SlaCheckpoint[] = [
    { slot: 1, mode: "preflight", expected_time: "10:45" },
    { slot: 1, mode: "overdue", expected_time: "11:45" },
    { slot: 2, mode: "preflight", expected_time: "18:45" },
    { slot: 2, mode: "overdue", expected_time: "19:45" }
  ];
  const current = minutesOfDay(time);
  const matched = checkpoints.find((checkpoint) => Math.abs(current - minutesOfDay(checkpoint.expected_time)) <= 10);
  if (!matched) {
    throw new Error(`No publishing SLA checkpoint is scheduled around ${time}. Use --mode and --slot for a manual check.`);
  }
  return matched;
}

export async function calculateRollingPublishingSla(
  root: string,
  now: Date,
  timezone = "Asia/Taipei"
): Promise<PublishingSlaReport["rolling_14_days"]> {
  const { date: endDate, time } = getZonedDateParts(now, timezone);
  const startDate = addDays(endDate, -13);
  let dueSlots = 0;
  let dualPlatformSuccessSlots = 0;

  for (let offset = 0; offset < 14; offset += 1) {
    const date = addDays(startDate, offset);
    const entries = await loadPostLog(date, root);
    for (const slot of [1, 2] as const) {
      const scheduled = slot === 1 ? "11:30" : "19:30";
      if (date > endDate || (date === endDate && scheduled > time)) continue;
      dueSlots += 1;
      if (PLATFORMS.every((platform) => isLiveSuccess(entries, slot, platform))) {
        dualPlatformSuccessSlots += 1;
      }
    }
  }

  const fulfillmentRate = dueSlots > 0 ? dualPlatformSuccessSlots / dueSlots : null;
  return {
    start_date: startDate,
    end_date: endDate,
    due_slots: dueSlots,
    dual_platform_success_slots: dualPlatformSuccessSlots,
    fulfillment_rate: fulfillmentRate,
    target: SLA_TARGET,
    target_met: fulfillmentRate === null ? null : fulfillmentRate >= SLA_TARGET
  };
}

export async function runPublishingSlaCheck(options: {
  root?: string;
  now?: Date;
  slot?: 1 | 2;
  mode?: SlaCheckpointMode;
  fetchImpl?: typeof fetch;
} = {}): Promise<PublishingSlaReport> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const now = options.now ?? new Date();
  const checkpoint = options.slot && options.mode
    ? {
        slot: options.slot,
        mode: options.mode,
        expected_time:
          options.slot === 1
            ? options.mode === "preflight" ? "10:45" : "11:45"
            : options.mode === "preflight" ? "18:45" : "19:45"
      } as SlaCheckpoint
    : resolveSlaCheckpoint(now, config.timezone);
  const { date } = getZonedDateParts(now, config.timezone);
  const rolling = await calculateRollingPublishingSla(root, now, config.timezone);

  try {
    if (checkpoint.mode === "preflight") {
      await postCurrentSlot({
        root,
        date,
        slot: checkpoint.slot,
        now,
        dryRun: false,
        preflightOnly: true,
        verifyPublicImageUrl: true,
        fetchImpl: options.fetchImpl
      });
    } else {
      const entries = await loadPostLog(date, root);
      const missing = PLATFORMS.filter((platform) => !isLiveSuccess(entries, checkpoint.slot, platform));
      if (missing.length > 0) {
        throw new Error(`Slot ${checkpoint.slot} is overdue on: ${missing.join(", ")}.`);
      }
    }

    return {
      generated_at: now.toISOString(),
      date,
      checkpoint,
      checkpoint_status: "pass",
      message: checkpoint.mode === "preflight" ? "Publishing preflight passed." : "Both platforms published on time.",
      rolling_14_days: rolling
    };
  } catch (error) {
    return {
      generated_at: now.toISOString(),
      date,
      checkpoint,
      checkpoint_status: "alert",
      message: error instanceof Error ? error.message : String(error),
      rolling_14_days: rolling
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slotOption = getOption(args, "slot");
  const modeOption = getOption(args, "mode");
  const report = await runPublishingSlaCheck({
    root: getOption(args, "root"),
    now: getOption(args, "now") ? new Date(getOption(args, "now")!) : undefined,
    slot: slotOption ? Number(slotOption) as 1 | 2 : undefined,
    mode: modeOption as SlaCheckpointMode | undefined
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.checkpoint_status === "alert") process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
