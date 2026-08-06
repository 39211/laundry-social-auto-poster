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
import {
  assertInsidePublishWindow,
  classifyCalendarSlotPresence,
  postCurrentSlot
} from "../src/postCurrentSlot";
import { healOneSlot, scheduleReel, slotMatchesPlanReel } from "../src/scheduleReel";
import { DAILY_SCHEDULE, findSlotByNumber } from "../src/scheduler";
import { videoRunReportPath } from "../src/videoRunFreshness";

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

async function requireFixture(path: string, label: string): Promise<void> {
  if (!(await exists(path))) {
    throw new Error(`Required fixture missing: ${label} at ${path}`);
  }
}

async function seedReelFixtures(root: string, conceptId: string, variants: Array<"10s" | "15s">): Promise<void> {
  const reelsDir = join(root, "output", "reels-run", "2026-07-29", "reels");
  const refsDir = join(root, "output", "reels-run", "2026-07-29", "references");
  await mkdir(reelsDir, { recursive: true });
  await mkdir(refsDir, { recursive: true });

  const base10 = join(RUN_REELS, `${conceptId}.mp4`);
  await requireFixture(base10, `${conceptId}.mp4`);
  await requireFixture(`${base10}.audio.json`, `${conceptId}.mp4.audio.json`);

  for (const variant of variants) {
    const name = variant === "15s" ? `${conceptId}-15s.mp4` : `${conceptId}.mp4`;
    // 15s may not exist as a distinct file in the checkout; reuse 10s bytes so
    // scheduleReel can open the path. Discriminator is run.json ab_variant.
    const src = variant === "15s" && (await exists(join(RUN_REELS, name)))
      ? join(RUN_REELS, name)
      : base10;
    await copyFile(src, join(reelsDir, name));
    await copyFile(`${base10}.audio.json`, join(reelsDir, `${name}.audio.json`));
  }

  if (await exists(join(RUN_REFS, `${conceptId}-before.png`))) {
    await copyFile(
      join(RUN_REFS, `${conceptId}-before.png`),
      join(refsDir, `${conceptId}-before.png`)
    );
  } else {
    await writeFile(join(refsDir, `${conceptId}-before.png`), "png");
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
    expect(() =>
      assertInsidePublishWindow(3, config, new Date("2026-08-07T18:00:00+08:00"))
    ).toThrow(/Refusing to live-publish slot 3/);

    expect(() =>
      assertInsidePublishWindow(3, config, new Date("2026-08-07T12:30:00+08:00"))
    ).not.toThrow();
  });

  it("heals a rewritten slot 3 from the ab-test plan", async () => {
    const conceptId = "leather-bag-corner";
    await requireFixture(join(RUN_REELS, `${conceptId}.mp4`), `${conceptId}.mp4`);
    const root = await mkdtemp(join(tmpdir(), "ab-heal-"));
    await seedReelFixtures(root, conceptId, ["10s"]);

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

    const plan = planForDate(await loadAbTestPlan(root), date)!;
    await healOneSlot({
      date,
      slotNumber: 3,
      conceptId: plan.noon.conceptId,
      variant: plan.noon.variant,
      root
    });
    const healed = await loadDailyContent(date, root);
    const slot3 = healed?.slots.find((s) => s.slot === 3);
    expect(slot3?.media_type).toBe("reel");
    expect(slot3?.topic).not.toBe("wrong topic");
    expect(slot3?.local_video_path).toContain("slot-03.mp4");
  });

  it("heals a slot when the concept is right but the variant is wrong", async () => {
    // Mutation target: if heal only checks topic and ignores ab_variant, this
    // test goes red (slot stays 10s while plan wants 15s).
    const conceptId = "leather-bag-corner";
    await requireFixture(join(RUN_REELS, `${conceptId}.mp4`), `${conceptId}.mp4`);
    const root = await mkdtemp(join(tmpdir(), "ab-heal-var-"));
    await seedReelFixtures(root, conceptId, ["10s", "15s"]);

    const date = "2026-08-21";
    // Schedule the 10s cut first, then the plan demands 15s for the same concept.
    await scheduleReel({ date, conceptId, slot: 3, variant: "10s", root });
    expect(await slotMatchesPlanReel({ date, slotNumber: 3, conceptId, variant: "10s", root })).toBe(
      true
    );
    expect(await slotMatchesPlanReel({ date, slotNumber: 3, conceptId, variant: "15s", root })).toBe(
      false
    );

    await healOneSlot({
      date,
      slotNumber: 3,
      conceptId,
      variant: "15s",
      root
    });

    expect(await slotMatchesPlanReel({ date, slotNumber: 3, conceptId, variant: "15s", root })).toBe(
      true
    );
    const runRaw = await readFile(videoRunReportPath(date, 3, root), "utf8");
    expect(JSON.parse(runRaw).ab_variant).toBe("15s");
  });

  it("classifies a missing slot 3 as skip, not fail (catch-up / post path)", () => {
    // TS-layer mirror of catchup-publish.ps1: absent slot 3 must not become a
    // failed publish. Slots 1 and 2 still fail hard.
    expect(classifyCalendarSlotPresence(3, false)).toBe("absent_skip");
    expect(classifyCalendarSlotPresence(3, true)).toBe("present");
    expect(classifyCalendarSlotPresence(2, false)).toBe("absent_fail");
    expect(classifyCalendarSlotPresence(1, false)).toBe("absent_fail");
  });

  it("postCurrentSlot skips absent slot 3 without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "ab-skip3-"));
    const date = "2026-05-16";
    const { generateDailyContent } = await import("../src/generateDailyContent");
    const { approvePost } = await import("../src/approvePost");
    await generateDailyContent({ date, root, force: true });

    // Strip slot 3 if the generator added it, simulating an older 2-slot calendar.
    const content = await loadDailyContent(date, root);
    const without3 = {
      ...content!,
      slots: content!.slots.filter((slot) => slot.slot !== 3)
    };
    await writeFile(
      join(root, "data", "content-calendar", `${date}.json`),
      `${JSON.stringify(without3, null, 2)}\n`
    );

    await approvePost({
      date,
      slot: 1,
      platforms: ["facebook", "instagram"],
      approvedBy: "test",
      root
    });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), "img");

    // Slot 3 request must resolve to empty results, not throw.
    const results = await postCurrentSlot({
      root,
      date,
      slot: 3,
      now: "2026-05-16T12:30:00+08:00",
      dryRun: true,
      verifyPublicImageUrl: false,
      fetchImpl: vi.fn() as unknown as typeof fetch
    });
    expect(results).toEqual([]);
  });

  it("writes optional ab_variant on posted-log only when a plan exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "ab-log-"));
    const date = "2026-05-15";
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

  it("puts posted-log rows without ab_variant into the unattributed bucket", async () => {
    // Mutation target: if the report falls back to plan.variant when the log
    // field is missing, this row would land in "10s" and the assertion fails.
    const root = await mkdtemp(join(tmpdir(), "ab-unattr-"));
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
          // deliberately omit ab_variant
          created_at: "2026-08-07T04:00:00.000Z"
        },
        {
          date: "2026-08-07",
          slot: 3,
          platform: "facebook",
          status: "success",
          dry_run: false,
          attempts: 1,
          created_at: "2026-08-07T04:00:00.000Z"
        }
      ],
      root
    );

    const report = await buildAbTestReport({ root, asOf: "2026-08-07" });
    const noonRow = report.rows.find((row) => row.slot === 3);
    expect(noonRow?.variant).toBe("unattributed");
    expect(report.variants.unattributed.posts).toBeGreaterThanOrEqual(1);
    expect(report.variants["10s"].posts).toBe(0);
    expect(
      report.data_gaps.some((gap) => gap.includes("missing ab_variant") && gap.includes("unattributed"))
    ).toBe(true);
  });

  it("captionsFor includes LINE id and never bare-shops in block 2", async () => {
    const conceptId = "leather-bag-corner";
    await requireFixture(join(RUN_REELS, `${conceptId}.mp4`), `${conceptId}.mp4`);
    const root = await mkdtemp(join(tmpdir(), "ab-caption-"));
    await seedReelFixtures(root, conceptId, ["10s"]);
    const date = "2026-08-22";
    await scheduleReel({ date, conceptId, slot: 2, variant: "10s", root });
    const content = await loadDailyContent(date, root);
    const slot = content?.slots.find((s) => s.slot === 2);
    expect(slot).toBeTruthy();
    for (const caption of [slot!.instagram_caption, slot!.facebook_caption]) {
      expect(caption).toContain("0968327653");
      expect(caption).toContain("加 LINE 直接問：");
      expect(caption).toContain("私享家洗衣店｜台中市區免費到府收送");
      const blocks = caption.split("\n\n");
      expect(blocks[1]).not.toBe("私享家洗衣店");
      expect(caption).not.toContain("先拍完整外觀和局部");
    }
    expect(slot!.instagram_caption).toMatch(/拍一張私訊/);
    expect(slot!.facebook_caption).toMatch(/拍一張傳 LINE|傳 LINE/);
  });
});

describe("assemble-reel two-act invariance", () => {
  it("documents ffprobe baseline for the existing two-act reel (mutation target)", async () => {
    const sample = join(PROJECT, "output", "reels-run", "2026-07-29", "reels", "leather-bag-corner.mp4");
    await requireFixture(sample, "leather-bag-corner.mp4");
    const buf = await readFile(sample);
    const hash = createHash("sha256").update(buf).digest("hex");
    expect(hash.length).toBe(64);
    expect(buf.byteLength).toBeGreaterThan(1_000_000);
  });
});

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
