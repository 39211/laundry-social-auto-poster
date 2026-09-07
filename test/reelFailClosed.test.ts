import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";
import { loadPostLog, loadVideoRepairQueue, writeApprovalLog } from "../src/logging";
import {
  postCurrentSlot,
  resolveSlotPublishMedia,
  slotRequiresPublishedVideo
} from "../src/postCurrentSlot";
import type { DailySlot } from "../src/types";

const DATE = "2026-08-30";
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("image bytes")
]);

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function reelSlot(slot = 3): DailySlot {
  return {
    slot,
    time: slot === 3 ? "12:00" : slot === 1 ? "11:30" : "20:30",
    category: slot === 1 ? "知識文" : "情境文",
    topic: "測試 Reel",
    format: "reel",
    media_type: "reel",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "cover",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
    public_image_url: `https://example.com/assets/${DATE}/slot-0${slot}.png`,
    local_video_path: `docs/assets/${DATE}/slot-0${slot}.mp4`,
    public_video_url: `https://example.com/assets/${DATE}/slot-0${slot}.mp4`,
    status: "pending"
  };
}

function imageSlot(slot: 1 | 2): DailySlot {
  return {
    slot,
    time: slot === 1 ? "11:30" : "20:30",
    category: slot === 1 ? "知識文" : "情境文",
    topic: "測試圖片",
    format: "image-post",
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "prompt",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
    public_image_url: `https://example.com/assets/${DATE}/slot-0${slot}.png`,
    status: "pending"
  };
}

function mixedSlot(): DailySlot {
  return {
    slot: 1,
    time: "11:30",
    category: "知識文",
    topic: "測試 carousel",
    format: "image-post",
    media_type: "mixed-carousel",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "prompt",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${DATE}/slot-01.png`,
    public_image_url: `https://example.com/assets/${DATE}/slot-01.png`,
    local_video_path: `docs/assets/${DATE}/slot-01.mp4`,
    public_video_url: `https://example.com/assets/${DATE}/slot-01.mp4`,
    carousel_items: [1, 2, 3, 4].map((slide) => ({
      slide,
      image_prompt: "prompt",
      local_image_path: `docs/assets/${DATE}/slot-01-0${slide}.png`,
      public_image_url: `https://example.com/assets/${DATE}/slot-01-0${slide}.png`
    })),
    status: "pending"
  };
}

async function writeCalendar(root: string, slots: DailySlot[]): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify(
      stampDailyContentWrite(
        { date: DATE, timezone: "Asia/Taipei", generated_at: `${DATE}T00:00:00.000Z`, slots },
        { root }
      ),
      null,
      2
    ),
    "utf8"
  );
}

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })));
});

describe("slotRequiresPublishedVideo", () => {
  it("is true for calendar media_type reel and for noon slot 3", () => {
    expect(slotRequiresPublishedVideo(reelSlot(3))).toBe(true);
    expect(slotRequiresPublishedVideo(reelSlot(1))).toBe(true);
    expect(slotRequiresPublishedVideo(mixedSlot())).toBe(false);
    expect(slotRequiresPublishedVideo({ ...mixedSlot(), slot: 3, time: "12:00" })).toBe(true);
  });
});

describe("resolveSlotPublishMedia fail-closed for reels", () => {
  it("throws for a reel with no video and does not return image", async () => {
    const root = await mkdtemp(join(tmpdir(), "reel-fail-closed-"));
    roots.push(root);
    const slot = reelSlot(3);
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-03.png"), PNG);

    await expect(resolveSlotPublishMedia(slot, DATE, root)).rejects.toThrow(
      /Refusing image fallback for reel slot 3/
    );
  });

  it("still falls back to carousel for mixed-carousel companion video", async () => {
    const root = await mkdtemp(join(tmpdir(), "mixed-fallback-"));
    roots.push(root);
    const slot = mixedSlot();
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    for (const item of slot.carousel_items ?? []) {
      await writeFile(join(root, ...item.local_image_path.split("/")), PNG);
    }

    const resolved = await resolveSlotPublishMedia(slot, DATE, root);
    expect(resolved.mediaType).toBe("carousel");
    expect(resolved.videoDeferred).toBe(true);
  });
});

describe("postCurrentSlot dry-run does not write posted-log success for a failed reel", () => {
  it("throws and leaves posted-log absent when slot 3 video is missing", async () => {
    vi.stubEnv("PUBLIC_IMAGE_BASE_URL", "https://tester.github.io/laundry-social-auto-poster");
    vi.stubEnv("DRY_RUN", "true");
    const root = await mkdtemp(join(tmpdir(), "reel-post-fail-"));
    roots.push(root);
    const slot = reelSlot(3);
    await writeCalendar(root, [imageSlot(1), imageSlot(2), slot]);
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-01.png"), PNG);
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.png"), PNG);
    await writeFile(join(root, "docs", "assets", DATE, "slot-03.png"), PNG);
    await writeApprovalLog(
      DATE,
      [
        { date: DATE, slot: 3, platform: "facebook", status: "approved", approved_by: "test", created_at: `${DATE}T00:00:00.000Z` },
        { date: DATE, slot: 3, platform: "instagram", status: "approved", approved_by: "test", created_at: `${DATE}T00:00:00.000Z` }
      ],
      root
    );

    await expect(
      postCurrentSlot({
        root,
        date: DATE,
        slot: 3,
        dryRun: true,
        verifyPublicImageUrl: false,
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow(/Refusing image fallback for reel slot 3/);

    expect(await fileExists(join(root, "data", "posted-log", `${DATE}.json`))).toBe(false);
    expect(await loadPostLog(DATE, root)).toEqual([]);
    expect(await loadVideoRepairQueue(root)).toEqual([]);
  });
});

describe("autoApprove does not grant reel consent when the video gate fails", () => {
  it("leaves a reel slot unapproved when the mp4 is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "reel-auto-approve-"));
    roots.push(root);
    const slot = reelSlot(3);
    await writeCalendar(root, [imageSlot(1), imageSlot(2), slot]);
    await writeFile(
      join(root, "data", "publishing-policy.json"),
      JSON.stringify({
        status: "active",
        start_date: "2026-08-01",
        end_date: "2026-12-31",
        platforms: ["facebook", "instagram"],
        slots: [{ slot: 1 }, { slot: 2 }, { slot: 3 }],
        same_day_catch_up: true
      }),
      "utf8"
    );
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", DATE, "slot-03.png"), PNG);
    const prompt = "cover";
    await mkdir(join(root, "data", "image-prompts"), { recursive: true });
    await writeFile(
      join(root, "data", "image-prompts", `${DATE}.json`),
      JSON.stringify([{ slot: 3, target_path: slot.local_image_path, topic: slot.topic, prompt }]),
      "utf8"
    );
    const hash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
    await mkdir(join(root, "data", "image-sources"), { recursive: true });
    await writeFile(
      join(root, "data", "image-sources", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 3,
          source: "gpt-image-2",
          image_path: slot.local_image_path,
          marked_at: new Date().toISOString(),
          topic: slot.topic,
          prompt_sha256: hash(prompt),
          image_sha256: hash(PNG)
        }
      ]),
      "utf8"
    );

    const result = await autoApprove({ date: DATE, root });
    expect(result.approved).toBe(false);
    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.some((text) => /reel video gate/i.test(text))).toBe(true);
    expect(await fileExists(join(root, "data", "approved-log", `${DATE}.json`))).toBe(false);
  });
});
