import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { validatePublishableImages } from "../src/generateImage";
import { PUBLISHABLE_IMAGE_SOURCES, isPublishableImageSource } from "../src/imageSources";
import { markImageSource } from "../src/markImageSource";

// The publish gate used to accept exactly one generator string. When the Codex
// quota ran dry (2026-09-05) the only honest way to publish a Google-generated
// carousel was to widen the allowlist, not to relabel the file. These tests pin
// both edges: the second supplier passes, an unknown label still fails, and the
// gate reads the shared list rather than its own copy of the string.

const DATE = "2026-09-08";
const HERO1 = `docs/assets/${DATE}/slot-01.png`;
const HERO2 = `docs/assets/${DATE}/slot-02.png`;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (marker: string) => Buffer.concat([PNG_MAGIC, Buffer.from(marker)]);

let root: string;

function slot(n: number, hero: string, topic: string) {
  return {
    slot: n,
    time: n === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic,
    instagram_caption: "caption",
    facebook_caption: "caption",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    media_type: "image",
    format: "image-post",
    local_image_path: hero,
    public_image_url: `https://example.com/${hero}`,
    image_prompt: `plain object on a pink cutting mat for ${hero}`,
    status: "pending"
  };
}

/** A minimal two-slot day: the calendar loader refuses anything with fewer slots. */
async function seedDay(): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  const calendar = {
    date: DATE,
    timezone: "Asia/Taipei",
    generated_at: new Date().toISOString(),
    slots: [
      slot(1, HERO1, "開學一週童鞋就臭了？先看鞋墊、鞋口、鞋帶 3 個位置"),
      slot(2, HERO2, "雨傘滴水旁的包角容易先受影響")
    ]
  };
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify(stampDailyContentWrite(calendar as Parameters<typeof stampDailyContentWrite>[0], { root }), null, 2),
    "utf8"
  );
  await writeFile(join(root, ...HERO1.split("/")), png("hero-1"));
  await writeFile(join(root, ...HERO2.split("/")), png("hero-2"));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "publishable-image-sources-"));
  await seedDay();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("publishable image sources", () => {
  it("lists both suppliers and nothing else", () => {
    expect([...PUBLISHABLE_IMAGE_SOURCES]).toEqual(["gpt-image-2", "google-agy-image"]);
    expect(isPublishableImageSource("gpt-image-2")).toBe(true);
    expect(isPublishableImageSource("google-agy-image")).toBe(true);
    expect(isPublishableImageSource("grok-imagine-image")).toBe(false);
    expect(isPublishableImageSource(undefined)).toBe(false);
  });

  it("accepts a day whose slot 1 file was stamped google-agy-image", async () => {
    await markImageSource({ root, date: DATE, slot: 1, source: "google-agy-image", imagePath: HERO1 });
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: HERO2 });
    await expect(validatePublishableImages(DATE, root)).resolves.toBeUndefined();
  });

  it("still accepts a day stamped only by the Codex supplier", async () => {
    await markImageSource({ root, date: DATE, slot: 1, source: "gpt-image-2", imagePath: HERO1 });
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: HERO2 });
    await expect(validatePublishableImages(DATE, root)).resolves.toBeUndefined();
  });

  it("refuses a file stamped with a generator the gate does not know, naming only that file", async () => {
    await markImageSource({ root, date: DATE, slot: 1, source: "some-other-generator", imagePath: HERO1 });
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: HERO2 });
    const failure = await validatePublishableImages(DATE, root).then(
      () => undefined,
      (error: Error) => error.message
    );
    expect(failure).toMatch(/publishable image source records \(gpt-image-2 \/ google-agy-image\)/);
    expect(failure).toContain(`slot 1 slide 1: ${HERO1}`);
    expect(failure).not.toContain(HERO2);
  });

  it("refuses an unstamped file (the asset inventory catches it before the source gate)", async () => {
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: HERO2 });
    await expect(validatePublishableImages(DATE, root)).rejects.toThrow(HERO1);
  });
});
