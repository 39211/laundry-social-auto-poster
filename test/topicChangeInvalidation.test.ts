import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  invalidateSlotImagesIfTopicChanged,
  invalidateStaleImagesForDate,
  listMissingCalendarImages,
  promptStillMatchesOldStamp,
  regenerationRefusal,
  STALE_PROMPT_AFTER_TOPIC_CHANGE,
  summarizeMissingImages,
  topicIdentity,
  topicsShareIdentity,
  validateImageAssets,
  writeImagePromptManifest
} from "../src/generateImage";
import { sha256 } from "../src/imageStamp";
import { loadDailyContent, loadImageSources } from "../src/logging";
import { markImageSource } from "../src/markImageSource";
import type { DailySlot } from "../src/types";

const DATE = "2026-09-21";
const FORCE_DATE = "2026-07-11";
const DARK_CLOTHES = "可收藏：深色衣服收進衣櫃前的氣味檢查";
const BOOTS = "可收藏：靴子換季除霉";
const COAT = "先看懂：外套領口的皮脂痕跡";
const SHIRT = "今天情境：西裝襯衫領口發黃";
const LUGGAGE = "細節拆解：行李箱輪座卡沙";
const DARK_PROMPT = "Realistic shop photo of dark garments on a rack.";
const BOOT_PROMPT = "Realistic shop photo of leather boots with mildew on the lining.";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(marker: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(marker)]);
}

let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "a7-invalidate-"));
});

function imageSlot(slot: number, topic: string, prompt: string, date = DATE): DailySlot {
  const path = `docs/assets/${date}/slot-0${slot}.png`;
  return {
    slot,
    time: slot === 1 ? "11:30" : slot === 2 ? "19:30" : "12:00",
    category: "知識文",
    topic,
    format: "image-post",
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: prompt,
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: path,
    public_image_url: `https://example.com/${path}`,
    status: "pending"
  };
}

async function writeCalendar(slots: DailySlot[], date = DATE): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    JSON.stringify({
      date,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots
    }),
    "utf8"
  );
}

async function writeManifest(slots: DailySlot[], date = DATE): Promise<void> {
  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(root, "data", "image-prompts", `${date}.json`),
    JSON.stringify(
      slots.map((slot) => ({
        slot: slot.slot,
        slide: 1,
        topic: slot.topic,
        prompt: slot.image_prompt,
        target_path: slot.local_image_path,
        public_image_url: slot.public_image_url,
        visual_route: slot.visual_route
      }))
    ),
    "utf8"
  );
}

async function writePng(relativePath: string, marker = relativePath): Promise<void> {
  const full = join(root, ...relativePath.split("/"));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, png(marker));
}

async function seedStampedSlot(slot: DailySlot, date = DATE): Promise<void> {
  await writePng(slot.local_image_path);
  await markImageSource({
    root,
    date,
    slot: slot.slot,
    source: "gpt-image-2",
    imagePath: slot.local_image_path
  });
}

async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await access(join(root, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

function staleDir(oldTopic: string, date = DATE): string {
  return join(root, "docs", "assets", date, "_stale", sha256(topicIdentity(oldTopic)).slice(0, 12));
}

describe("topicIdentity", () => {
  it("strips only TOPIC_LABEL_PREFIX_RE and treats a label swap as the same object", () => {
    expect(topicIdentity("可收藏：白鞋鞋邊泛灰前的檢查")).toBe("白鞋鞋邊泛灰前的檢查");
    expect(topicIdentity("先看懂：白鞋鞋邊泛灰前的檢查")).toBe("白鞋鞋邊泛灰前的檢查");
    expect(
      topicsShareIdentity("可收藏：白鞋鞋邊泛灰前的檢查", "先看懂：白鞋鞋邊泛灰前的檢查")
    ).toBe(true);
    expect(topicsShareIdentity(DARK_CLOTHES, BOOTS)).toBe(false);
    expect(topicIdentity("外套領口的皮脂痕跡")).toBe("外套領口的皮脂痕跡");
  });

  it("is the single imported TOPIC_LABEL_PREFIX_RE, not a copied prefix list", async () => {
    const source = await readFile(new URL("../src/generateImage.ts", import.meta.url), "utf8");
    expect(source).toMatch(/TOPIC_LABEL_PREFIXES/);
    expect(source).toMatch(/TOPIC_LABEL_PREFIX_RE/);
    expect(source).toMatch(/from ["']\.\/contentPlan["']/);
    const fn = source.slice(source.indexOf("export function topicIdentity"));
    const body = fn.slice(0, fn.indexOf("export function topicsShareIdentity"));
    expect(body).toContain("TOPIC_LABEL_PREFIX_RE");
    expect(body).not.toMatch(/先看懂\|今天情境\|可收藏/);
  });
});

describe("calendar inventory, not the manifest", () => {
  it("treats the 8/18 two-ruler day as missing two hero images", async () => {
    const slot1 = imageSlot(1, COAT, "coat collar prompt");
    const slot2 = imageSlot(2, SHIRT, "shirt collar prompt");
    const slot3 = imageSlot(3, LUGGAGE, "suitcase reel cover prompt");
    slot3.media_type = "reel";
    slot3.format = "reel";
    slot3.local_video_path = `docs/assets/${DATE}/slot-03.mp4`;
    await writeCalendar([slot1, slot2, slot3]);
    await writeManifest([slot3]);
    await writePng(slot3.local_image_path);
    await writeFile(join(root, "docs", "assets", DATE, "slot-03.mp4"), "video", "utf8");
    await markImageSource({
      root,
      date: DATE,
      slot: 3,
      source: "gpt-image-2",
      imagePath: slot3.local_image_path
    });

    const missing = await listMissingCalendarImages(DATE, root);
    const paths = missing.map((item) => item.path).sort();
    expect(paths).toEqual([slot1.local_image_path, slot2.local_image_path]);
    expect(missing.every((item) => item.reason === "absent")).toBe(true);
    expect(summarizeMissingImages(DATE, missing)).not.toMatch(/Every image .* already present/);
    await expect(validateImageAssets(DATE, root)).rejects.toThrow(slot1.local_image_path);
    await expect(validateImageAssets(DATE, root)).rejects.toThrow(slot2.local_image_path);
  });

  it("does not consult the image-prompts manifest when deciding what is missing", async () => {
    const source = await readFile(new URL("../src/generateImage.ts", import.meta.url), "utf8");
    const start = source.indexOf("export async function listMissingCalendarImages");
    const end = source.indexOf("export function summarizeMissingImages");
    const body = source.slice(start, end);
    expect(body).not.toMatch(/image-prompts|loadImagePromptManifest|manifestEntryFor/);
    expect(body).toContain("imageAssetsForSlot");
  });
});

describe("false-kill guards", () => {
  it("does not move files when only the TOPIC_LABEL_PREFIXES label changes", async () => {
    const slot1 = imageSlot(1, "可收藏：白鞋鞋邊泛灰前的檢查", DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);

    slot1.topic = "先看懂：白鞋鞋邊泛灰前的檢查";
    await writeCalendar([slot1, slot2]);

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toEqual([]);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });

  it("does not move files when only captions change", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);

    slot1.instagram_caption = "a refreshed caption that never touches the topic";
    slot1.facebook_caption = "facebook refreshed too";
    await writeCalendar([slot1, slot2]);

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toEqual([]);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });

  it("does not move a force-preserved reel cover", async () => {
    await generateDailyContent({ date: FORCE_DATE, root });
    const content = await loadDailyContent(FORCE_DATE, root);
    expect(content).toBeTruthy();
    const slot2 = content!.slots.find((slot) => slot.slot === 2)!;
    slot2.media_type = "reel";
    slot2.format = "reel";
    slot2.topic = "排定的 Reel";
    slot2.local_video_path = `docs/assets/${FORCE_DATE}/slot-02.mp4`;
    slot2.image_prompt = "Reel cover still: scheduled hook";
    await writeFile(
      join(root, "data", "content-calendar", `${FORCE_DATE}.json`),
      JSON.stringify(content),
      "utf8"
    );
    await writeManifest(
      content!.slots.map((slot) =>
        slot.slot === 2 ? slot : slot
      ),
      FORCE_DATE
    );
    await writePng(slot2.local_image_path, "reel-cover");
    await mkdir(join(root, "docs", "assets", FORCE_DATE), { recursive: true });
    await writeFile(join(root, "docs", "assets", FORCE_DATE, "slot-02.mp4"), "video bytes");
    await markImageSource({
      root,
      date: FORCE_DATE,
      slot: 2,
      source: "gpt-image-2",
      imagePath: slot2.local_image_path
    });

    await generateDailyContent({ date: FORCE_DATE, root, force: true });

    expect(await pathExists(slot2.local_image_path)).toBe(true);
    const staleRoot = join(root, "docs", "assets", FORCE_DATE, "_stale");
    let staleNames: string[] = [];
    try {
      staleNames = await readdir(staleRoot);
    } catch {
      staleNames = [];
    }
    for (const dir of staleNames) {
      const files = await readdir(join(staleRoot, dir));
      expect(files.some((name) => name.includes("slot-02.png"))).toBe(false);
    }
    const regenerated = await loadDailyContent(FORCE_DATE, root);
    expect(regenerated!.slots.find((slot) => slot.slot === 2)!.topic).toBe("排定的 Reel");
  });
});

describe("topic change actually moves bytes", () => {
  it("moves the old hero into _stale/<topicIdentity hash>/ when the object word changes", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);

    const next1 = imageSlot(1, BOOTS, BOOT_PROMPT);
    await writeCalendar([next1, slot2]);

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toHaveLength(1);
    expect(report.moved[0]?.from).toBe(slot1.local_image_path);
    expect(await pathExists(slot1.local_image_path)).toBe(false);

    const destDir = staleDir(DARK_CLOTHES);
    const dest = join(destDir, "slot-01.png");
    await access(dest);
    expect(report.moved[0]?.to).toBe(dest);
  });

  it("moves slot 1 on generateDailyContent --force when playbook replaces a different object", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT, FORCE_DATE);
    const slot2 = imageSlot(2, "其他主題", "other prompt", FORCE_DATE);
    await writeCalendar([slot1, slot2], FORCE_DATE);
    await writeManifest([slot1, slot2], FORCE_DATE);
    await seedStampedSlot(slot1, FORCE_DATE);
    await seedStampedSlot(slot2, FORCE_DATE);

    await generateDailyContent({ date: FORCE_DATE, root, force: true });

    expect(await pathExists(slot1.local_image_path)).toBe(false);
    const destDir = staleDir(DARK_CLOTHES, FORCE_DATE);
    await access(join(destDir, "slot-01.png"));
    const written = await loadDailyContent(FORCE_DATE, root);
    expect(topicIdentity(written!.slots[0]!.topic)).not.toBe(topicIdentity(DARK_CLOTHES));
  });

  it("moves orphan carousel slides when the slot is now a reel, but leaves the cover if the video is on disk", async () => {
    const hero = `docs/assets/${DATE}/slot-02.png`;
    const slide2 = `docs/assets/${DATE}/slot-02-slide-02.png`;
    const slide3 = `docs/assets/${DATE}/slot-02-slide-03.png`;
    const previous: DailySlot = {
      ...imageSlot(2, DARK_CLOTHES, DARK_PROMPT),
      media_type: "carousel",
      format: "carousel-guide",
      carousel_items: [
        { slide: 1, image_prompt: DARK_PROMPT, local_image_path: hero, public_image_url: "https://example.com/h" },
        { slide: 2, image_prompt: DARK_PROMPT, local_image_path: slide2, public_image_url: "https://example.com/2" },
        { slide: 3, image_prompt: DARK_PROMPT, local_image_path: slide3, public_image_url: "https://example.com/3" }
      ]
    };
    const next: DailySlot = {
      ...imageSlot(2, "排定的 Reel", "Reel cover still: hook"),
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${DATE}/slot-02.mp4`
    };
    const slot1 = imageSlot(1, "其他主題", "other prompt");
    await writeCalendar([slot1, previous]);
    await writeManifest([slot1, previous]);
    await writePng(hero);
    await writePng(slide2);
    await writePng(slide3);
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.mp4"), "video");
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: hero });

    const report = await invalidateSlotImagesIfTopicChanged({ date: DATE, root, previous, next });
    expect(await pathExists(hero)).toBe(true);
    expect(await pathExists(slide2)).toBe(false);
    expect(await pathExists(slide3)).toBe(false);
    expect(report.moved.map((item) => item.from).sort()).toEqual([slide2, slide3].sort());
    expect(report.skipped.some((item) => item.reason === "protected-reel")).toBe(true);
  });

  it("invalidates the whole carousel when any slide stamp identity differs", async () => {
    // Mutation target: if previousTopicForScan / the date scan only read
    // slide 1, a new first slide would hide an old later slide and this
    // test would stay green while the mixed slot is left in place.
    const hero = `docs/assets/${DATE}/slot-02.png`;
    const slide2 = `docs/assets/${DATE}/slot-02-slide-02.png`;
    const slot2: DailySlot = {
      ...imageSlot(2, BOOTS, BOOT_PROMPT),
      media_type: "carousel",
      format: "carousel-guide",
      carousel_items: [
        { slide: 1, image_prompt: BOOT_PROMPT, local_image_path: hero, public_image_url: "https://example.com/h" },
        { slide: 2, image_prompt: BOOT_PROMPT, local_image_path: slide2, public_image_url: "https://example.com/2" }
      ]
    };
    const slot1 = imageSlot(1, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await writePng(hero, "slide-1-new-boots");
    await writePng(slide2, "slide-2-old-clothes");
    await mkdir(join(root, "data", "image-sources"), { recursive: true });
    await writeFile(
      join(root, "data", "image-sources", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 2,
          source: "gpt-image-2",
          image_path: hero,
          topic: BOOTS,
          prompt_sha256: sha256(BOOT_PROMPT),
          image_sha256: sha256("slide-1-new-boots"),
          marked_at: new Date().toISOString()
        },
        {
          date: DATE,
          slot: 2,
          source: "gpt-image-2",
          image_path: slide2,
          topic: DARK_CLOTHES,
          prompt_sha256: sha256(DARK_PROMPT),
          image_sha256: sha256("slide-2-old-clothes"),
          marked_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(await pathExists(hero)).toBe(false);
    expect(await pathExists(slide2)).toBe(false);
    expect(report.moved.map((item) => item.from).sort()).toEqual([hero, slide2].sort());
    const destDir = staleDir(DARK_CLOTHES);
    await access(join(destDir, "slot-02.png"));
    await access(join(destDir, "slot-02-slide-02.png"));

    const source = await readFile(new URL("../src/generateImage.ts", import.meta.url), "utf8");
    const scanStart = source.indexOf("function previousTopicForScan");
    const scanEnd = source.indexOf("function refuseIfUnsafeToRegenerate");
    const scanBody = source.slice(scanStart, scanEnd);
    expect(scanBody).toContain("topicsShareIdentity");
    expect(scanBody).toContain("imageAssetsForSlot");
    expect(scanBody).toMatch(/\.find\(/);
  });
});

describe("A1 refuse regeneration", () => {
  it("refuses when identity changed but the new image_prompt still hashes to the old stamp", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);
    const stamp = (await loadImageSources(DATE, root)).find((entry) => entry.slot === 1);
    expect(stamp?.prompt_sha256).toBeTruthy();

    const next1 = imageSlot(1, BOOTS, DARK_PROMPT);
    await writeCalendar([next1, slot2]);

    await expect(invalidateStaleImagesForDate(DATE, root)).rejects.toThrow(
      STALE_PROMPT_AFTER_TOPIC_CHANGE
    );
    expect(await pathExists(slot1.local_image_path)).toBe(true);
    const after = (await loadImageSources(DATE, root)).find((entry) => entry.slot === 1);
    expect(after?.topic).toBe(DARK_CLOTHES);
    expect(after?.prompt_sha256).toBe(stamp?.prompt_sha256);
  });

  it("refuses when the new calendar topic clashes with the new image_prompt", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);

    const next1 = imageSlot(1, COAT, "Close-up of sneakers on a tiled laundry floor.");
    await writeCalendar([next1, slot2]);

    await expect(invalidateStaleImagesForDate(DATE, root)).rejects.toThrow(/contradictorySubject|sneakers|衣物/);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });

  it("keeps the A1 predicate in source so deleting it turns this suite red", async () => {
    const source = await readFile(new URL("../src/generateImage.ts", import.meta.url), "utf8");
    expect(source).toContain("promptStillMatchesOldStamp");
    expect(source).toContain("STALE_PROMPT_AFTER_TOPIC_CHANGE");
    expect(source).toMatch(/promptSha256\(nextPrompt\) === stampPromptSha256/);
    expect(
      promptStillMatchesOldStamp(DARK_PROMPT, sha256(DARK_PROMPT))
    ).toBe(true);
    expect(
      regenerationRefusal(DARK_CLOTHES, BOOTS, DARK_PROMPT, sha256(DARK_PROMPT))?.kind
    ).toBe("stale-prompt");
    expect(regenerationRefusal(DARK_CLOTHES, DARK_CLOTHES, DARK_PROMPT, sha256(DARK_PROMPT))).toBeUndefined();
  });
});

describe("do not touch posted, approved, or lock-conflict slots", () => {
  async function seedChangedTopic(): Promise<{ slot1: DailySlot; slot2: DailySlot }> {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);
    const next1 = imageSlot(1, BOOTS, BOOT_PROMPT);
    await writeCalendar([next1, slot2]);
    return { slot1, slot2 };
  }

  it("never moves a posted slot", async () => {
    const { slot1 } = await seedChangedTopic();
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 1,
          platform: "instagram",
          status: "success",
          dry_run: false,
          attempts: 1,
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toEqual([]);
    expect(report.skipped.some((item) => item.reason === "posted-log")).toBe(true);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });

  it("reports but does not move an approved slot", async () => {
    const { slot1 } = await seedChangedTopic();
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 1,
          platform: "instagram",
          status: "approved",
          approved_by: "test",
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toEqual([]);
    expect(report.skipped.some((item) => item.reason === "approved-log")).toBe(true);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });

  it("reports A3 and does not move when the day-lock topic disagrees with the calendar", async () => {
    const { slot1 } = await seedChangedTopic();
    await mkdir(join(root, "data", "day-locks"), { recursive: true });
    await writeFile(
      join(root, "data", "day-locks", `${DATE}.json`),
      JSON.stringify({
        date: DATE,
        locked_at: new Date().toISOString(),
        slot1: { topic: DARK_CLOTHES }
      }),
      "utf8"
    );

    const report = await invalidateStaleImagesForDate(DATE, root);
    expect(report.moved).toEqual([]);
    expect(report.skipped.some((item) => item.reason.startsWith("A3"))).toBe(true);
    expect(await pathExists(slot1.local_image_path)).toBe(true);
  });
});

describe("writeImagePromptManifest rebuilds from the calendar after a move", () => {
  it("does not treat a rebuilt manifest as the repair — the file has to leave its path", async () => {
    const slot1 = imageSlot(1, DARK_CLOTHES, DARK_PROMPT);
    const slot2 = imageSlot(2, "其他主題", "other prompt");
    await writeCalendar([slot1, slot2]);
    await writeManifest([slot1, slot2]);
    await seedStampedSlot(slot1);
    await seedStampedSlot(slot2);

    const next1 = imageSlot(1, BOOTS, BOOT_PROMPT);
    await writeCalendar([next1, slot2]);

    await writeImagePromptManifest(DATE, root);

    expect(await pathExists(slot1.local_image_path)).toBe(false);
    await access(join(staleDir(DARK_CLOTHES), "slot-01.png"));
    const manifest = JSON.parse(
      await readFile(join(root, "data", "image-prompts", `${DATE}.json`), "utf8")
    ) as Array<{ slot: number; topic: string; prompt: string }>;
    expect(manifest.find((entry) => entry.slot === 1)?.topic).toBe(BOOTS);
    expect(manifest.find((entry) => entry.slot === 1)?.prompt).toContain("boots");
  });
});
