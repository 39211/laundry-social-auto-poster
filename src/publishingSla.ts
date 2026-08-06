import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadPostLog } from "./logging";
import { postCurrentSlot } from "./postCurrentSlot";
import { projectRoot } from "./paths";
import { DAILY_SCHEDULE, getZonedDateParts } from "./scheduler";
import type { Platform, PostLogEntry } from "./types";

const PLATFORMS: Platform[] = ["facebook", "instagram"];
const SLA_TARGET = 0.95;

export type SlaCheckpointMode = "preflight" | "overdue";

export type SlaSlot = 1 | 2 | 3;

export interface SlaCheckpoint {
  slot: SlaSlot;
  mode: SlaCheckpointMode;
  expected_time: string;
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

function formatTime(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Preflight 45 minutes before the slot; overdue 15 minutes after. */
export function slaTimesForSlot(slot: SlaSlot): { preflight: string; overdue: string } {
  const schedule = DAILY_SCHEDULE.find((item) => item.slot === slot);
  if (!schedule) throw new Error(`Unknown SLA slot: ${slot}`);
  const scheduled = minutesOfDay(schedule.time);
  return {
    preflight: formatTime(scheduled - 45),
    overdue: formatTime(scheduled + 15)
  };
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
  const checkpoints: SlaCheckpoint[] = ([1, 2, 3] as const).flatMap((slot) => {
    const times = slaTimesForSlot(slot);
    return [
      { slot, mode: "preflight" as const, expected_time: times.preflight },
      { slot, mode: "overdue" as const, expected_time: times.overdue }
    ];
  });
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
    for (const schedule of DAILY_SCHEDULE) {
      if (date > endDate || (date === endDate && schedule.time > time)) continue;
      dueSlots += 1;
      if (PLATFORMS.every((platform) => isLiveSuccess(entries, schedule.slot, platform))) {
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
  slot?: SlaSlot;
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
        expected_time: options.mode === "preflight"
          ? slaTimesForSlot(options.slot).preflight
          : slaTimesForSlot(options.slot).overdue
      }
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
    slot: slotOption ? Number(slotOption) as SlaSlot : undefined,
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
