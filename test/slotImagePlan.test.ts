import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { stampDailyContentWrite } from "../src/contentPlan";
import { buildSlotImagePlan, IMAGE_GUARD_SUFFIX, withGuardSuffix } from "../src/slotImagePlan";
import type { DailyContent } from "../src/types";

// The D+3 image line: the 21:40 wrapper generates whatever a future calendar
// still lacks via the hermes-Grok route. These tests pin the plan's contract --
// what gets generated, from which certified prompt, anchored to which identity
// image -- because the Python driver executes it without judgment.

const DATE = "2026-09-23";

function assetPath(slot: number, slide: number): string {
  const pad = `0${slot}`;
  return slide === 1
    ? `docs/assets/${DATE}/slot-${pad}.png`
    : `docs/assets/${DATE}/slot-${pad}-slide-0${slide}.png`;
}

function publicUrl(path: string): string {
  return `https://tester.example/${path.replace(/^docs\//, "")}`;
}

function calendar(): DailyContent {
  const carouselItems = [1, 2, 3, 4].map((slide) => ({
    slide,
    image_prompt: `calendar prompt s1 slide ${slide}`,
    local_image_path: assetPath(1, slide),
    public_image_url: publicUrl(assetPath(1, slide))
  }));
  return {
    date: DATE,
    timezone: "Asia/Taipei",
    generated_at: "2026-09-20T00:00:00.000Z",
    slots: [
      {
        slot: 1,
        time: "11:30",
        category: "知識文",
        topic: "測試主題一",
        media_type: "mixed-carousel",
        instagram_caption: "c1",
        facebook_caption: "c1",
        image_prompt: "calendar prompt s1 slide 1",
        carousel_items: carouselItems,
        visual_route: "shop-inspection",
        traffic_route: "object-proof",
        local_image_path: assetPath(1, 1),
        public_image_url: publicUrl(assetPath(1, 1)),
        status: "pending"
      },
      {
        slot: 2,
        time: "20:30",
        category: "情境文",
        topic: "測試主題二",
        media_type: "image",
        instagram_caption: "c2",
        facebook_caption: "c2",
        image_prompt: "calendar prompt s2",
        visual_route: "macro-detail",
        traffic_route: "dwell-detail",
        local_image_path: assetPath(2, 1),
        public_image_url: publicUrl(assetPath(2, 1)),
        status: "pending"
      },
      {
        slot: 3,
        time: "12:00",
        category: "知識文",
        topic: "測試主題三",
        media_type: "reel",
        instagram_caption: "c3",
        facebook_caption: "c3",
        image_prompt: "calendar prompt s3 fallback",
        visual_route: "shop-inspection",
        traffic_route: "trust-reset",
        local_image_path: assetPath(3, 1),
        public_image_url: publicUrl(assetPath(3, 1)),
        status: "pending"
      }
    ]
  } as DailyContent;
}

function manifestFor(content: DailyContent): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  for (const slot of content.slots) {
    const items =
      slot.media_type === "mixed-carousel" || slot.media_type === "carousel"
        ? (slot.carousel_items ?? [])
        : [{ slide: 1, image_prompt: slot.image_prompt, local_image_path: slot.local_image_path }];
    for (const item of items) {
      entries.push({
        slot: slot.slot,
        target_path: item.local_image_path,
        topic: slot.topic,
        prompt: `MANIFEST ${item.local_image_path}`
      });
    }
  }
  return entries;
}

let root: string;

async function seed(options: {
  existing?: string[];
  manifest?: Array<Record<string, unknown>> | null;
  tamper?: boolean;
} = {}): Promise<void> {
  const content = calendar();
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  const stamped = stampDailyContentWrite(content, { root }) as unknown as DailyContent;
  if (options.tamper) {
    stamped.slots[0]!.topic = "偷改過的主題";
  }
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    `${JSON.stringify(stamped, null, 2)}\n`,
    "utf8"
  );
  const manifest = options.manifest === undefined ? manifestFor(content) : options.manifest;
  if (manifest) {
    await mkdir(join(root, "data", "image-prompts"), { recursive: true });
    await writeFile(join(root, "data", "image-prompts", `${DATE}.json`), JSON.stringify(manifest, null, 2), "utf8");
  }
  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const rel of options.existing ?? []) {
    await writeFile(join(root, ...rel.split("/")), "png-bytes");
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "slot-image-plan-"));
});

describe("buildSlotImagePlan", () => {
  it("plans hero-then-edits for a fresh day, all prompts certified by the manifest and guard-suffixed", async () => {
    await seed();
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.blockers).toEqual([]);
    expect(plan.items).toHaveLength(6);

    const slot1 = plan.items.filter((item) => item.slot === 1);
    expect(slot1.map((item) => item.role)).toEqual(["hero", "edit", "edit", "edit"]);
    expect(slot1[0]!.target_path).toBe(assetPath(1, 1));
    for (const edit of slot1.slice(1)) {
      expect(edit.base_path).toBe(assetPath(1, 1));
      expect(edit.base_exists).toBe(false);
    }
    // The single-image slot and the reel's fallback image are both one hero.
    expect(plan.items.filter((item) => item.slot === 2)).toMatchObject([{ role: "hero", slide: 1 }]);
    expect(plan.items.filter((item) => item.slot === 3)).toMatchObject([{ role: "hero", slide: 1 }]);

    for (const item of plan.items) {
      expect(item.prompt.startsWith(`MANIFEST ${item.target_path}`)).toBe(true);
      expect(item.prompt.endsWith(IMAGE_GUARD_SUFFIX)).toBe(true);
      expect(item.public_image_url).toBe(publicUrl(item.target_path));
    }
  });

  it("edits from the existing anchor when the hero is already on disk", async () => {
    await seed({ existing: [assetPath(1, 1), assetPath(1, 3), assetPath(2, 1), assetPath(3, 1)] });
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.blockers).toEqual([]);
    expect(plan.items.map((item) => [item.slot, item.slide, item.role])).toEqual([
      [1, 2, "edit"],
      [1, 4, "edit"]
    ]);
    for (const item of plan.items) {
      expect(item.base_path).toBe(assetPath(1, 1));
      expect(item.base_exists).toBe(true);
    }
  });

  it("plans nothing when every calendar image already exists", async () => {
    await seed({
      existing: [assetPath(1, 1), assetPath(1, 2), assetPath(1, 3), assetPath(1, 4), assetPath(2, 1), assetPath(3, 1)]
    });
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.items).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it("refuses the whole day when the image-prompts manifest is missing", async () => {
    await seed({ manifest: null });
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.items).toEqual([]);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toContain("generate-image-manifest");
  });

  it("blocks only the slot whose slide lacks a unique manifest entry; other slots still plan", async () => {
    const entries = manifestFor(calendar()).filter(
      (entry) => entry.target_path !== assetPath(1, 4)
    );
    await seed({ manifest: entries });
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toContain("slot 1");
    expect(plan.blockers[0]).toContain(assetPath(1, 4));
    expect(plan.items.map((item) => item.slot)).toEqual([2, 3]);
  });

  it("never double-appends the guard suffix", async () => {
    const entries = manifestFor(calendar()).map((entry) => ({
      ...entry,
      prompt: `${entry.prompt}\n\n${IMAGE_GUARD_SUFFIX}`
    }));
    await seed({ manifest: entries });
    const plan = await buildSlotImagePlan(DATE, root);
    expect(plan.items.length).toBeGreaterThan(0);
    for (const item of plan.items) {
      const occurrences = item.prompt.split("ABSOLUTELY no text of any kind").length - 1;
      expect(occurrences).toBe(1);
    }
    expect(withGuardSuffix(withGuardSuffix("p"))).toBe(withGuardSuffix("p"));
  });

  it("refuses a tampered calendar outright", async () => {
    await seed({ tamper: true });
    await expect(buildSlotImagePlan(DATE, root)).rejects.toThrow(/integrity/);
  });
});

// The wrapper and the Python driver cannot run under vitest, so their critical
// wiring is pinned the same way generate-missing-images.ps1 pins its inventory:
// as source assertions that go red when someone reorders or drops a step.
describe("schedule-ahead-daily wiring", () => {
  it("generates, stamps and publishes images between heal and auto-approve, in order", async () => {
    const source = await readFile(new URL("../scripts/schedule-ahead-daily.ps1", import.meta.url), "utf8");
    const heal = source.indexOf("heal-reel-slot");
    // The missing-calendar branch has its own earlier generate-image-manifest
    // call; the unconditional one this suite pins is the last occurrence.
    const manifest = source.lastIndexOf("generate-image-manifest -- --date $date");
    const planStep = source.indexOf("slot-image-plan -- --date $date");
    const driver = source.indexOf("hermes-image-gen.py");
    const stamp = source.indexOf("mark-image-source -- --date $date");
    const pages = source.indexOf("publish-pages -- --date $date");
    const approve = source.indexOf("auto-approve -- --date $date");
    const schedule = source.indexOf("schedule-ahead -- --date $date --live");
    for (const [name, index] of Object.entries({ heal, manifest, planStep, driver, stamp, pages, approve, schedule })) {
      expect(index, `${name} step missing`).toBeGreaterThan(-1);
    }
    // Manifest before plan (a plan without certified prompts refuses the day),
    // generation chain complete before approval, approval before scheduling.
    expect(heal).toBeLessThan(manifest);
    expect(manifest).toBeLessThan(planStep);
    expect(planStep).toBeLessThan(driver);
    expect(driver).toBeLessThan(stamp);
    expect(stamp).toBeLessThan(pages);
    expect(pages).toBeLessThan(approve);
    expect(approve).toBeLessThan(schedule);
    expect(source).toContain("--source grok-imagine-image");
    expect(source).toContain("hermes-agent\\venv\\Scripts\\python.exe");
  });

  it("driver executes the plan without adding prompt text, edits at 3:4, and stages per slot", async () => {
    const source = await readFile(new URL("../scripts/hermes-image-gen.py", import.meta.url), "utf8");
    expect(source).toContain('GEN_ASPECT = "3:4"');
    expect(source).toContain("aspect_ratio=GEN_ASPECT");
    expect(source).toContain("image_url=str(image_url)");
    expect(source).toContain('".staged"');
    expect(source).toContain('"--plan"');
    expect(source).toContain("FINAL_SIZE = (1080, 1350)");
    // The guard suffix lives in slotImagePlan.ts only; a second copy here would
    // drift and double-append.
    expect(source).not.toContain("ABSOLUTELY");
  });
});
