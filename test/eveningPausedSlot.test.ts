import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AbDayPlan } from "../src/abTestPlan";
import { getConfig } from "../src/config";
import {
  TOPIC_REPEAT_WINDOW_DAYS,
  buildDailyContent,
  repeatingObjectGram,
  topicRepeatsInWindow
} from "../src/contentPlan";
import { SHARED_STILL_PROMPT } from "../src/reelConcepts";
import { reelCoverPrompt, reelCoverSourceRel, scheduleReel } from "../src/scheduleReel";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
});

const PAUSED_0818: AbDayPlan = {
  date: "2026-08-18",
  noon: { conceptId: "wool-coat-shoulder", variant: "10s" },
  evening: { conceptId: "shirt-collar", variant: "15s", paused: true }
};

function isImageFamily(mediaType: string | undefined): boolean {
  return mediaType === "image" || mediaType === "carousel" || mediaType === "mixed-carousel";
}

// output/ is gitignored (no generated media in git), so this real production
// run only exists on machines that have generated it locally. CI and fresh
// checkouts skip the one case that needs it rather than failing on an absent
// fixture no commit could have provided.
const REEL_FIXTURES_AVAILABLE = existsSync(
  join(process.cwd(), "output", "reels-run", "2026-07-29", "reels", "leather-bag-corner.mp4")
);
const reelIt = REEL_FIXTURES_AVAILABLE ? it : it.skip;

describe("paused evening slot uses playbook 圖文, not a legacy reel", () => {
  it("rebuilds 2026-08-18 slot 2 as 圖文 with a shop-scene prompt that misses the 15-day window", () => {
    const content = buildDailyContent("2026-08-18", config);
    const slot2 = content.slots.find((slot) => slot.slot === 2);
    expect(slot2).toBeTruthy();
    expect(slot2!.format).not.toBe("reel");
    expect(slot2!.media_type).not.toBe("reel");
    expect(isImageFamily(slot2!.media_type)).toBe(true);
    expect(slot2!.content_plan_source).toBe("growth-playbook");
    expect(slot2!.topic).not.toBe("羽絨外套袖口發黑");
    expect(slot2!.image_prompt).not.toMatch(/^Reel cover still:/);
    expect(slot2!.image_prompt).toMatch(/pink cutting mat|inspection counter|私享家洗衣店/);
    expect(slot2!.local_image_path).toBe("docs/assets/2026-08-18/slot-02.png");

    expect(TOPIC_REPEAT_WINDOW_DAYS).toBe(15);
    const recent: string[] = [];
    for (let back = 1; back <= TOPIC_REPEAT_WINDOW_DAYS; back += 1) {
      const day = new Date(Date.UTC(2026, 7, 18 - back)).toISOString().slice(0, 10);
      try {
        const raw = readFileSync(
          join(process.cwd(), "data", "content-calendar", `${day}.json`),
          "utf8"
        );
        const parsed = JSON.parse(raw) as { slots?: Array<{ topic?: string }> };
        for (const slot of parsed.slots ?? []) {
          if (slot.topic) recent.push(slot.topic);
        }
      } catch {
        // A day with no calendar is not a collision.
      }
    }
    expect(topicRepeatsInWindow(slot2!.topic, recent)).toBeUndefined();
  });

  it("does not treat an unpaused evening as 圖文 just because the playbook can emit one", () => {
    const live: AbDayPlan[] = [
      {
        date: "2026-08-13",
        noon: { conceptId: "luggage-wheel", variant: "15s" },
        evening: { conceptId: "shirt-collar", variant: "15s" }
      }
    ];
    const content = buildDailyContent("2026-08-13", config, { abPlan: live });
    const slot2 = content.slots.find((slot) => slot.slot === 2);
    expect(slot2?.format).toBe("reel");
  });

  it("swaps a paused-evening topic that already sits inside the 15-day window", async () => {
    const root = await mkdtemp(join(tmpdir(), "evening-repeat-"));
    try {
      await mkdir(join(root, "data", "content-calendar"), { recursive: true });
      const colliding = "細節拆解：換季時西裝和襯衫不要一起悶收，先看容易忽略的位置";
      await writeFile(
        join(root, "data", "content-calendar", "2026-08-16.json"),
        JSON.stringify({
          date: "2026-08-16",
          timezone: "Asia/Taipei",
          generated_at: new Date().toISOString(),
          slots: [{ slot: 2, topic: colliding }]
        }),
        "utf8"
      );

      const content = buildDailyContent("2026-08-18", config, {
        root,
        abPlan: [PAUSED_0818]
      });
      const slot2 = content.slots.find((slot) => slot.slot === 2);
      expect(slot2?.format).not.toBe("reel");
      expect(slot2?.topic).not.toBe(colliding);
      expect(repeatingObjectGram(slot2!.topic, colliding)).toBeUndefined();
      expect(isImageFamily(slot2?.media_type)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });
});

describe("reel cover manifest is a copy or a shop-scene generation", () => {
  const concept = {
    id: "down-jacket-cuff",
    object_type: "down-jacket",
    hook: "羽絨外套袖口發黑",
    close: "close",
    narration: "narration that is long enough",
    before_subject:
      "a navy down jacket sleeve cuff, the ribbed band darkened grey-black with ingrained skin oil, fabric intact",
    after_subject: "the same cuff clean"
  };

  it("records the before-still path instead of a bare subject prompt", () => {
    const source = reelCoverSourceRel(concept.id);
    const prompt = reelCoverPrompt(concept, source);
    expect(source).toBe("output/reels-run/2026-07-29/references/down-jacket-cuff-before.png");
    expect(prompt).toContain(source);
    expect(prompt).not.toMatch(/^Reel cover still:/);
    expect(prompt).not.toBe(`Reel cover still: ${concept.before_subject}`);
    expect(prompt).not.toContain(concept.before_subject);
  });

  it("wraps a generated cover in SHARED_STILL_PROMPT when no before still exists", () => {
    const prompt = reelCoverPrompt(concept);
    expect(prompt).toBe(SHARED_STILL_PROMPT.replace("[SUBJECT]", concept.before_subject));
    expect(prompt).toContain(concept.before_subject);
    expect(prompt).toContain("pink cutting mat");
    expect(prompt).not.toMatch(/^Reel cover still:/);
    expect(prompt.length).toBeGreaterThan(concept.before_subject.length + 80);
  });

  reelIt("writes that source onto the live manifest when the before still is present", async () => {
    const conceptId = "leather-bag-corner";
    const project = process.cwd();
    const reel = join(project, "output", "reels-run", "2026-07-29", "reels", `${conceptId}.mp4`);
    const before = join(project, "output", "reels-run", "2026-07-29", "references", `${conceptId}-before.png`);
    await readFile(reel);
    await readFile(before);

    const root = await mkdtemp(join(tmpdir(), "cover-source-"));
    try {
      const runReels = join(root, "output", "reels-run", "2026-07-29", "reels");
      const runRefs = join(root, "output", "reels-run", "2026-07-29", "references");
      await mkdir(runReels, { recursive: true });
      await mkdir(runRefs, { recursive: true });
      await copyFile(reel, join(runReels, `${conceptId}.mp4`));
      await copyFile(`${reel}.audio.json`, join(runReels, `${conceptId}.mp4.audio.json`));
      await copyFile(before, join(runRefs, `${conceptId}-before.png`));

      const date = "2026-08-23";
      await scheduleReel({ date, conceptId, slot: 2, variant: "10s", root });

      const manifest = JSON.parse(
        await readFile(join(root, "data", "image-prompts", `${date}.json`), "utf8")
      ) as Array<Record<string, unknown>>;
      const calendar = JSON.parse(
        await readFile(join(root, "data", "content-calendar", `${date}.json`), "utf8")
      ) as { slots: Array<{ slot: number; image_prompt: string }> };
      const entry = manifest.find((item) => item.target_path === `docs/assets/${date}/slot-02.png`);
      const slot = calendar.slots.find((item) => item.slot === 2);
      const source = reelCoverSourceRel(conceptId);

      expect(entry?.source).toBe(source);
      expect(entry?.prompt).toBe(`Copied reel cover from ${source}`);
      expect(slot?.image_prompt).toBe(`Copied reel cover from ${source}`);
      expect(String(entry?.prompt)).not.toMatch(/^Reel cover still:/);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
    }
  });
});
