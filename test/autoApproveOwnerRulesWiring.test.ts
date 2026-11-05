import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import * as generateVideo from "../src/generateVideo";
import * as imageProvenance from "../src/imageProvenance";
import * as imageStamp from "../src/imageStamp";
import * as logging from "../src/logging";
import type { OwnerRuleViolation } from "../src/ownerContentRules";
import type { DailyContent, DailySlot, VideoSourceRecord } from "../src/types";

// Card C3-2b. autoApprove must hand the duration stored in the video source
// record to the owner-rules checker. Neither checkSlotAgainstOwnerRules nor
// storedReelDurationSeconds is mocked here: the gate runs for real on a temp
// root, so replacing the storedReelDurationSeconds(...) call with undefined
// turns the measured "12 秒" finding into the "時長未知" warning and fails.
//
// Card C3-3. The allowed length depends on the task: a daily automatic Reel is
// ≥10 s (12 s passes), a slot whose video_candidate carries a 25–45 s
// video_length_range is judged against that range (12 s is a finding). The
// report names the range applied and why.
//
// The temp root deliberately has no data/publishing-policy.json. That is a
// day-level blocker, so nothing is approved and approvePost never runs, while
// the owner-rules gate (which runs before that return) still writes
// output/owner-rules/<date>.json.

const DATE = "2026-05-21";
const REEL_SLOT = 2;
const REEL_PATH = `output/videos/${DATE}/slot-${REEL_SLOT}.mp4`;
const PLANNED_SECONDS = 10; // the plan; must never be reported as the measured length
const STORED_SECONDS = 12; // the measured length stored when the video was marked
const TASK_RANGE = { min_seconds: 25, max_seconds: 45 }; // owner-crafted video task

function reelSlot(lengthRange?: { min_seconds: number; max_seconds: number }): DailySlot {
  return {
    slot: REEL_SLOT,
    time: "18:00",
    category: "情境文",
    topic: "白鞋鞋面灰黃",
    media_type: "reel",
    instagram_caption: "白鞋鞋面的灰黃，先看材質再決定怎麼處理。",
    facebook_caption: "白鞋鞋面的灰黃，先看材質再決定怎麼處理。",
    image_prompt: "師傅專注刷洗白鞋鞋面，門市燈光，手機紀實照片",
    video_prompt: "Slow push-in on a brush scrubbing a white sneaker.",
    video_candidate: {
      status: "concept_ready",
      memory_hook: "灰黃鞋面",
      conflict: "鞋面發黃",
      single_action: "刷洗鞋面",
      payoff: "鞋面乾淨",
      cta: "私訊詢問",
      duration_seconds: PLANNED_SECONDS,
      aspect_ratio: "9:16",
      first_frame_direction: "close-up of a white sneaker on the counter",
      grok_motion_prompt: "Slow push-in on a brush scrubbing a white sneaker.",
      fallback_media_type: "image",
      ...(lengthRange ? { video_length_range: lengthRange } : {})
    },
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    local_image_path: `output/images/${DATE}/slot-${REEL_SLOT}.png`,
    public_image_url: `https://example.invalid/images/${DATE}/slot-${REEL_SLOT}.png`,
    local_video_path: REEL_PATH,
    public_video_url: `https://example.invalid/videos/${DATE}/slot-${REEL_SLOT}.mp4`,
    status: "pending"
  };
}

function calendar(slot: DailySlot): DailyContent {
  return {
    date: DATE,
    timezone: "Asia/Taipei",
    generated_at: `${DATE}T00:00:00.000Z`,
    slots: [slot]
  };
}

function videoRecord(overrides: Partial<VideoSourceRecord> = {}): VideoSourceRecord {
  return {
    date: DATE,
    slot: REEL_SLOT,
    source: "grok-imagine-video",
    model: "grok-imagine-video",
    video_path: REEL_PATH,
    request_id: "synthetic-request",
    duration_seconds: STORED_SECONDS,
    width: 720,
    height: 1280,
    frame_rate: 24,
    video_codec: "h264",
    marked_at: `${DATE}T00:00:00.000Z`,
    ...overrides
  };
}

interface OwnerRulesReport {
  date: string;
  mode: string;
  slots: Array<{
    slot: number;
    violations: OwnerRuleViolation[];
    reel_length_range?: { min: number; max?: number; source: string };
  }>;
}

const roots: string[] = [];

async function prepareDay(videoSources: VideoSourceRecord[], slot: DailySlot = reelSlot()): Promise<{
  root: string;
  loadVideoSourcesSpy: ReturnType<typeof vi.spyOn>;
}> {
  const root = await mkdtemp(join(tmpdir(), "laundry-owner-rules-wiring-"));
  roots.push(root);
  vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
  vi.stubEnv("SXJ_OWNER_RULES", "report");

  // Synthetic calendar for the test date only; earlier dates have none.
  vi.spyOn(logging, "loadDailyContent").mockImplementation((async (requested: string) =>
    requested === DATE ? calendar(slot) : undefined) as unknown as typeof logging.loadDailyContent);
  // Synthetic video-source records for the test date only.
  const loadVideoSourcesSpy = vi
    .spyOn(logging, "loadVideoSources")
    .mockImplementation((async (requested: string) =>
      requested === DATE ? videoSources : []) as unknown as typeof logging.loadVideoSources);

  // Evidence gates unrelated to owner rules (no images or videos exist in a temp root).
  vi.spyOn(imageStamp, "imageEvidenceFailures").mockResolvedValue([]);
  vi.spyOn(imageProvenance, "inspectDailyImageProvenance").mockResolvedValue({
    with_manifest: 0,
    without_manifest: 0,
    consistent: true
  } as unknown as Awaited<ReturnType<typeof imageProvenance.inspectDailyImageProvenance>>);
  vi.spyOn(generateVideo, "validatePublishableReel").mockResolvedValue(undefined);

  return { root, loadVideoSourcesSpy };
}

async function readReport(root: string): Promise<OwnerRulesReport> {
  return JSON.parse(await readFile(join(root, "output", "owner-rules", `${DATE}.json`), "utf8")) as OwnerRulesReport;
}

function reportEntry(report: OwnerRulesReport): OwnerRulesReport["slots"][number] {
  const entry = report.slots.find((item) => item.slot === REEL_SLOT);
  if (!entry) throw new Error(`report has no entry for slot ${REEL_SLOT}`);
  return entry;
}

function reelFindings(report: OwnerRulesReport): OwnerRuleViolation[] {
  const entry = report.slots.find((item) => item.slot === REEL_SLOT);
  if (!entry) throw new Error(`report has no entry for slot ${REEL_SLOT}`);
  return entry.violations.filter((violation) => violation.rule === "reel_length");
}

describe("autoApprove wires the stored Reel duration into the owner-rules gate", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    while (roots.length > 0) {
      const root = roots.pop();
      if (root) await rm(root, { recursive: true, force: true });
    }
  });

  it("reports the measured 12 s against a task-specified 25–45 s range, not unknown", async () => {
    const { root, loadVideoSourcesSpy } = await prepareDay([videoRecord()], reelSlot(TASK_RANGE));

    const result = await autoApprove({ date: DATE, root });

    expect(loadVideoSourcesSpy).toHaveBeenCalledWith(DATE, root);
    // Nothing may be approved: the missing policy is a day-level blocker.
    expect(result.approved).toBe(false);
    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.some((blocker) => blocker.startsWith("publishing_policy"))).toBe(true);

    const report = await readReport(root);
    expect(report.date).toBe(DATE);
    expect(report.mode).toBe("report");
    expect(reportEntry(report).reel_length_range).toEqual({ min: 25, max: 45, source: "任務指定 25–45 秒" });
    const findings = reelFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("block");
    expect(findings[0]?.field).toBe("video");
    expect(findings[0]?.excerpt).toContain(`影片 ${STORED_SECONDS} 秒`);
    expect(findings[0]?.excerpt).toContain("任務指定 25–45 秒");
    expect(findings[0]?.excerpt).not.toContain("未知");
    expect(findings[0]?.excerpt).not.toContain(`規劃 ${PLANNED_SECONDS}`);

    const gate = result.checks.find((check) => check.name === `owner_rules_slot${REEL_SLOT}`);
    expect(gate?.ok).toBe(true); // report mode never blocks
    expect(gate?.detail).toContain("report-only (would block)");
    expect(gate?.detail).toContain(`影片 ${STORED_SECONDS} 秒`);
    expect(gate?.detail).toContain("任務指定 25–45 秒");
    expect(gate?.detail).not.toContain("時長未知");
  });

  it("a measured 12 s daily automatic Reel has no reel_length finding; the report names the daily range", async () => {
    const { root } = await prepareDay([videoRecord()]);

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved).toBe(false);
    const report = await readReport(root);
    expect(reportEntry(report).reel_length_range).toEqual({ min: 10, source: "每日自動 Reel ≥10 秒" });
    expect(reelFindings(report)).toEqual([]);
    const gate = result.checks.find((check) => check.name === `owner_rules_slot${REEL_SLOT}`);
    expect(gate?.ok).toBe(true);
    expect(gate?.detail ?? "").not.toContain("reel_length");
  });

  it("warns that the duration is unknown when no record matches the slot", async () => {
    // Same duration, but a different video_path: storedReelDurationSeconds must not use it.
    const { root } = await prepareDay([videoRecord({ video_path: `output/videos/${DATE}/other.mp4` })]);

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved).toBe(false);
    const findings = reelFindings(await readReport(root));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("warn");
    expect(findings[0]?.excerpt).toContain("時長未知");
    expect(findings[0]?.excerpt).toContain(`規劃 ${PLANNED_SECONDS} 秒`);
    expect(findings[0]?.excerpt).not.toContain(`影片 ${STORED_SECONDS} 秒`);

    const gate = result.checks.find((check) => check.name === `owner_rules_slot${REEL_SLOT}`);
    expect(gate?.ok).toBe(true);
    expect(gate?.detail).toMatch(/^warning: /);
    expect(gate?.detail).toContain("時長未知");
  });

  it("produces no reel_length finding when the stored duration is inside 25-45 s", async () => {
    const { root } = await prepareDay([videoRecord({ duration_seconds: 30 })]);

    const result = await autoApprove({ date: DATE, root });

    expect(reelFindings(await readReport(root))).toEqual([]);
    const gate = result.checks.find((check) => check.name === `owner_rules_slot${REEL_SLOT}`);
    expect(gate?.ok).toBe(true);
    expect(gate?.detail ?? "").not.toContain("reel_length");
  });
});
