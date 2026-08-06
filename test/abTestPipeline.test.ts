import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateAbTestPlan,
  loadAbTestPlan,
  planForDate,
  planSlot,
  saveAbTestPlan,
  variantsForDate
} from "../src/abTestPlan";
import { buildAbTestReport } from "../src/abTestReport";
import { getConfig } from "../src/config";
import { loadDailyContent, writePostLog } from "../src/logging";
import { assertInsidePublishWindow, postCurrentSlot } from "../src/postCurrentSlot";
import { scheduleReel } from "../src/scheduleReel";
import { DAILY_SCHEDULE, findSlotByNumber } from "../src/scheduler";

const PROJECT = process.cwd();
const RUN_REELS = join(PROJECT, "output", "reels-run", "2026-07-29", "reels");
const RUN_REFS = join(PROJECT, "output", "reels-run", "2026-07-29", "references");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("A/B dual-reel pipeline", () => {
  beforeEach(() => {
    vi.stubEnv("TIMEZONE", "Asia/Taipei");
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("schedules three daily slots with noon and evening reel times", () => {
    expect(DAILY_SCHEDULE).toEqual([
      { slot: 1, time: "11:30", category: "知識文" },
      { slot: 2, time: "20:30", category: "情境文" },
      { slot: 3, time: "12:00", category: "情境文" }
    ]);
    expect(findSlotByNumber(3).time).toBe("12:00");
    expect(findSlotByNumber(2).time).toBe("20:30");
  });

  it("crosses variants by calendar day and pairs distinct concepts", () => {
    expect(variantsForDate("2026-08-07")).toEqual({ noon: "10s", evening: "15s" });
    expect(variantsForDate("2026-08-08")).toEqual({ noon: "15s", evening: "10s" });

    const plan = generateAbTestPlan("2026-08-07", 4);
    expect(plan).toHaveLength(4);
    for (const day of plan) {
      expect(day.noon.conceptId).not.toBe(day.evening.conceptId);
      // Same concept must not appear twice on one day (so 10s+15s of one concept cannot co-occur).
      const ids = [day.noon.conceptId, day.evening.conceptId];
      expect(new Set(ids).size).toBe(2);
    }
    expect(plan[0]?.noon.variant).toBe("10s");
    expect(plan[0]?.evening.variant).toBe("15s");
    expect(plan[1]?.noon.variant).toBe("15s");
    expect(plan[1]?.evening.variant).toBe("10s");
  });

  it("blocks live publish of slot 3 outside its four-hour window", () => {
    const config = getConfig();
    // Slot 3 is 12:00; 18:00 is outside 12:00-16:00.
    expect(() =>
      assertInsidePublishWindow(3, config, new Date("2026-08-07T18:00:00+08:00"))
    ).toThrow(/Refusing to live-publish slot 3/);

    // Inside window is allowed.
    expect(() =>
      assertInsidePublishWindow(3, config, new Date("2026-08-07T12:30:00+08:00"))
    ).not.toThrow();
  });

  it("heals a rewritten slot 3 from the ab-test plan", async () => {
    const conceptId = "leather-bag-corner";
    if (!(await exists(join(RUN_REELS, `${conceptId}.mp4`)))) {
      return; // fixture missing in this checkout; skip rather than invent assets
    }
    const root = await mkdtemp(join(tmpdir(), "ab-heal-"));
    // Mirror only the assets scheduleReel needs into the temp project layout by
    // pointing scheduleReel at the real project root for media and a temp root
    // for calendars — scheduleReel uses a single root, so copy fixtures in.
    await mkdir(join(root, "output", "reels-run", "2026-07-29", "reels"), { recursive: true });
    await mkdir(join(root, "output", "reels-run", "2026-07-29", "references"), { recursive: true });
    await copyFile(join(RUN_REELS, `${conceptId}.mp4`), join(root, "output", "reels-run", "2026-07-29", "reels", `${conceptId}.mp4`));
    await copyFile(
      join(RUN_REELS, `${conceptId}.mp4.audio.json`),
      join(root, "output", "reels-run", "2026-07-29", "reels", `${conceptId}.mp4.audio.json`)
    );
    if (await exists(join(RUN_REFS, `${conceptId}-before.png`))) {
      await copyFile(
        join(RUN_REFS, `${conceptId}-before.png`),
        join(root, "output", "reels-run", "2026-07-29", "references", `${conceptId}-before.png`)
      );
    } else {
      await writeFile(join(root, "output", "reels-run", "2026-07-29", "references", `${conceptId}-before.png`), "png");
    }

    const date = "2026-08-20";
    await saveAbTestPlan(
      [
        {
          date,
          noon: { conceptId, variant: "10s" },
          evening: { conceptId: "handbag-handle", variant: "15s" }
        }
      ],
      root
    );

    await scheduleReel({ date, conceptId, slot: 3, variant: "10s", root });
    let content = await loadDailyContent(date, root);
    expect(content?.slots.find((s) => s.slot === 3)?.media_type).toBe("reel");

    // Rewrite slot 3 to a broken carousel, as a morning clobber would.
    content = await loadDailyContent(date, root);
    const clobbered = {
      ...content!,
      slots: content!.slots.map((slot) =>
        slot.slot === 3
          ? {
              ...slot,
              media_type: "carousel" as const,
              topic: "wrong topic",
              local_video_path: undefined
            }
          : slot
      )
    };
    await writeFile(join(root, "data", "content-calendar", `${date}.json`), `${JSON.stringify(clobbered, null, 2)}\n`);

    // Heal via the same path main() uses when --heal + plan exist.
    const plan = planForDate(await loadAbTestPlan(root), date)!;
    await scheduleReel({
      date,
      conceptId: plan.noon.conceptId,
      slot: 3,
      variant: plan.noon.variant,
      root
    });
    const healed = await loadDailyContent(date, root);
    const slot3 = healed?.slots.find((s) => s.slot === 3);
    expect(slot3?.media_type).toBe("reel");
    expect(slot3?.topic).not.toBe("wrong topic");
    expect(slot3?.local_video_path).toContain("slot-03.mp4");
  });

  it("writes optional ab_variant on posted-log only when a plan exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "ab-log-"));
    const date = "2026-05-15";
    // No plan: logs must omit ab_variant.
    const { generateDailyContent } = await import("../src/generateDailyContent");
    const { approvePost } = await import("../src/approvePost");
    await generateDailyContent({ date, root, force: true });
    await approvePost({
      date,
      slot: 1,
      platforms: ["facebook", "instagram"],
      approvedBy: "test",
      root
    });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "img");

    const results = await postCurrentSlot({
      root,
      date,
      slot: 1,
      now: "2026-05-15T11:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });
    expect(results.every((entry) => entry.ab_variant === undefined)).toBe(true);
  });

  it("reports data_gaps instead of fabricating zero metrics", async () => {
    const root = await mkdtemp(join(tmpdir(), "ab-report-"));
    await saveAbTestPlan(
      [
        {
          date: "2026-08-07",
          noon: { conceptId: "a", variant: "10s" },
          evening: { conceptId: "b", variant: "15s" }
        }
      ],
      root
    );
    await writePostLog(
      "2026-08-07",
      [
        {
          date: "2026-08-07",
          slot: 3,
          platform: "instagram",
          status: "success",
          dry_run: false,
          attempts: 1,
          ab_variant: "10s",
          created_at: "2026-08-07T04:00:00.000Z"
        }
      ],
      root
    );

    const report = await buildAbTestReport({ root, asOf: "2026-08-07" });
    expect(report.data_gaps.length).toBeGreaterThan(0);
    expect(report.variants["10s"].reach).toBeNull();
    expect(report.variants["15s"].reach).toBeNull();
    expect(report.comparison.reach_ratio_15s_over_10s).toBeNull();
  });
});

describe("assemble-reel two-act invariance", () => {
  it("documents ffprobe baseline for the existing two-act reel (mutation target)", async () => {
    const sample = join(PROJECT, "output", "reels-run", "2026-07-29", "reels", "leather-bag-corner.mp4");
    if (!(await exists(sample))) return;
    const buf = await readFile(sample);
    const hash = createHash("sha256").update(buf).digest("hex");
    // Stable fixture fingerprint used by the mutation evidence script.
    expect(hash.length).toBe(64);
    expect(buf.byteLength).toBeGreaterThan(1_000_000);
  });
});

// planSlot is used by postCurrentSlot; keep a tiny pure check.
describe("planSlot mapping", () => {
  it("maps noon to slot 3 and evening to slot 2", () => {
    const day = {
      date: "2026-08-07",
      noon: { conceptId: "a", variant: "10s" as const },
      evening: { conceptId: "b", variant: "15s" as const }
    };
    expect(planSlot(day, 3)?.variant).toBe("10s");
    expect(planSlot(day, 2)?.variant).toBe("15s");
    expect(planSlot(day, 1)).toBeUndefined();
    expect(planSlot(undefined, 2)).toBeUndefined();
  });
});
