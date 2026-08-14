import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";
import {
  imagesChangedSinceStamp,
  imagesDifferFromApproval,
  loadApprovedImageDigests
} from "../src/imageStamp";
import { markImageSource } from "../src/markImageSource";

// The invariant: a slot must not be approved unless every image it will publish
// is provably the file that was generated for that slot's current topic.
//
// The first version of this file tested one third of that. It hand-wrote the
// source JSON, so deleting the entire stamping step from markImageSource left
// the whole suite green; and it never wrote an image-prompts manifest, so the
// first witness always landed in its catch branch and the shape of the actual
// 2026-08-14 accident -- manifest rebuilt into agreement, file still stale --
// had no test at all. Both gaps were found by the review seats, not by me.
//
// So this file now builds a genuinely healthy day through the real writer and
// breaks exactly one thing per test.

const DATE = "2026-09-02";
const SHOE = "白鞋鞋邊泛灰前的檢查";
const BAG = "精品包邊角磨損的三個階段";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(marker: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(marker)]);
}
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

let root: string;

interface SlotSpec {
  slot: number;
  topic: string;
  paths: string[];
}

/** slot 1 is a four-slide carousel, slot 2 a single image. Both are real shapes. */
const SLOTS: SlotSpec[] = [
  {
    slot: 1,
    topic: SHOE,
    paths: [
      `docs/assets/${DATE}/slot-01.png`,
      `docs/assets/${DATE}/slot-01-slide-02.png`,
      `docs/assets/${DATE}/slot-01-slide-03.png`,
      `docs/assets/${DATE}/slot-01-slide-04.png`
    ]
  },
  { slot: 2, topic: BAG, paths: [`docs/assets/${DATE}/slot-02.png`] }
];

const promptFor = (path: string) => `photorealistic laundry shop photo for ${path}`;

function calendarSlot(spec: SlotSpec) {
  const [hero, ...rest] = spec.paths;
  const base = {
    slot: spec.slot,
    time: spec.slot === 1 ? "11:30" : "19:30",
    category: "知識文",
    topic: spec.topic,
    instagram_caption: "caption",
    facebook_caption: "caption",
    visual_route: "macro-detail",
    media_type: "image",
    local_image_path: hero,
    public_image_url: `https://example.com/${hero}`,
    image_prompt: promptFor(hero as string),
    status: "pending"
  };
  if (rest.length === 0) return { ...base, format: "image-post" };
  return {
    ...base,
    format: "mixed-carousel",
    media_type: "mixed-carousel",
    carousel_items: spec.paths.map((path, index) => ({
      slide: index + 1,
      local_image_path: path,
      public_image_url: `https://example.com/${path}`,
      image_prompt: promptFor(path)
    }))
  };
}

/** A day where every gate should pass: calendar, policy, manifest, files, stamps. */
async function seedHealthyDay(): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify({
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots: SLOTS.map(calendarSlot)
    }),
    "utf8"
  );
  await writeFile(
    join(root, "data", "publishing-policy.json"),
    JSON.stringify({
      status: "active",
      start_date: "2026-08-01",
      end_date: "2026-12-31",
      platforms: ["facebook", "instagram"],
      slots: SLOTS.map((s) => ({ slot: s.slot })),
      same_day_catch_up: true
    }),
    "utf8"
  );

  await mkdir(join(root, "data", "image-prompts"), { recursive: true });
  await writeFile(
    join(root, "data", "image-prompts", `${DATE}.json`),
    JSON.stringify(
      SLOTS.flatMap((spec) =>
        spec.paths.map((path) => ({
          slot: spec.slot,
          target_path: path,
          topic: spec.topic,
          prompt: promptFor(path)
        }))
      )
    ),
    "utf8"
  );

  await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
  for (const spec of SLOTS) {
    for (const path of spec.paths) {
      await writeFile(join(root, ...path.split("/")), png(path));
      // The real writer, not a hand-written record.
      await markImageSource({ root, date: DATE, slot: spec.slot, source: "gpt-image-2", imagePath: path });
    }
  }
}

async function sources(): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await readFile(join(root, "data", "image-sources", `${DATE}.json`), "utf8"));
}

async function writeSources(entries: Array<Record<string, unknown>>): Promise<void> {
  await writeFile(join(root, "data", "image-sources", `${DATE}.json`), JSON.stringify(entries), "utf8");
}

/** Blockers naming a specific file, which is what the per-asset checks emit. */
function about(blockers: string[], path: string): string[] {
  return blockers.filter((text) => text.includes(path));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "topic-witness-"));
  await seedHealthyDay();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("the stamp each image file carries", () => {
  it("is written by the real marking command, with topic and both hashes", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const record = (await sources()).find((entry) => entry.image_path === hero);

    expect(record).toBeTruthy();
    expect(record!.topic).toBe(SHOE);
    expect(record!.image_sha256).toBe(sha(png(hero)));
    expect(record!.prompt_sha256).toBe(sha(promptFor(hero)));
  });

  it("approves a day where everything agrees", async () => {
    const result = await autoApprove({ date: DATE, root });

    expect(result.approved_slots).toEqual([1, 2]);
    expect(result.blockers).toEqual([]);
  });

  it("refuses to re-stamp a file whose bytes have not changed", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    // The laundering move: topic moved on, image did not.
    const calendarPath = join(root, "data", "content-calendar", `${DATE}.json`);
    const calendar = JSON.parse(await readFile(calendarPath, "utf8"));
    calendar.slots[0].topic = "完全不同的主題";
    await writeFile(calendarPath, JSON.stringify(calendar), "utf8");

    await expect(
      markImageSource({ root, date: DATE, slot: 1, source: "gpt-image-2", imagePath: hero })
    ).rejects.toThrow(/byte-identical/);

    // And the record it refused to overwrite still says what it always said.
    expect((await sources()).find((e) => e.image_path === hero)!.topic).toBe(SHOE);
  });
});

describe("what the approval gate refuses", () => {
  it("blocks when a stamp names a different topic than the caption", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const entries = await sources();
    entries.find((e) => e.image_path === hero)!.topic = "行李箱收進櫃子前,先看輪子";
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("文不配圖"))).toBe(true);
    expect(about(result.blockers, hero).some((t) => t.includes("行李箱"))).toBe(true);
    expect(result.approved_slots).not.toContain(1);
  });

  it("blocks when a stamp carries no topic, because agreement is then unproven", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const entries = await sources();
    delete entries.find((e) => e.image_path === hero)!.topic;
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("沒有記錄產生當下的主題"))).toBe(true);
  });

  // The 2026-08-14 accident: rebuilding the manifest made the first witness
  // agree while the file on disk was still the wrong picture.
  it("blocks when the manifest agrees but the file's own stamp does not", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const entries = await sources();
    entries.find((e) => e.image_path === hero)!.topic = "帆布鞋送洗前的檢查";
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("文不配圖"))).toBe(true);
  });

  it("blocks when the image was swapped after it was stamped", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    await writeFile(join(root, ...hero.split("/")), png("a completely different picture"));

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("蓋章之後被換過"))).toBe(true);
  });

  it("blocks when the prompt changed but the image was never regenerated", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const manifestPath = join(root, "data", "image-prompts", `${DATE}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.find((e: { target_path: string }) => e.target_path === hero).prompt = "a rewritten prompt";
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("提示詞已經改過"))).toBe(true);
  });

  // Slot 2 was never checked at all before this. 2026-08-01 and 2026-08-13 both
  // ran four-slide carousels there.
  it("blocks a non-first slot too", async () => {
    const path = SLOTS[1]!.paths[0]!;
    const entries = await sources();
    entries.find((e) => e.image_path === path)!.topic = SHOE;
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, path).some((t) => t.includes("文不配圖"))).toBe(true);
    expect(result.approved_slots).not.toContain(2);
    // The healthy slot must still go out; blocking the whole day over one bad
    // slide is how a zero-publish day gets manufactured.
    expect(result.approved_slots).toContain(1);
  });

  it("names the one polluted slide of a carousel, not just the first", async () => {
    const slide3 = SLOTS[0]!.paths[2]!;
    const entries = await sources();
    entries.find((e) => e.image_path === slide3)!.topic = "羽絨被結塊";
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, slide3).some((t) => t.includes("文不配圖"))).toBe(true);
    expect(about(result.blockers, SLOTS[0]!.paths[0]!)).toEqual([]);
  });

  it("blocks when a record is filed under the wrong slot", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const entries = await sources();
    // Satisfies the path-only source gate; proves nothing about slot 1.
    entries.find((e) => e.image_path === hero)!.slot = 2;
    await writeSources(entries);

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("沒有屬於這一格的來源紀錄"))).toBe(true);
  });

  // Publishing asks a narrower question than approval: not "is this proven"
  // but "did it change since we agreed to it". Approval already happened by
  // then, so re-asking for proof would strand every day approved before stamps
  // existed -- while a swap after approval is invisible to the fingerprint,
  // which hashes the calendar slot and not one byte of any image.
  describe("the narrower check publishing runs", () => {
    it("reports an image whose bytes moved after stamping", async () => {
      const hero = SLOTS[0]!.paths[0]!;
      await writeFile(join(root, ...hero.split("/")), png("swapped after approval"));

      const changed = await imagesChangedSinceStamp(
        root,
        SLOTS[0]!,
        [{ local_image_path: hero }],
        (await sources()) as never
      );

      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain("核准之後被換過");
    });

    it("says nothing when the bytes are untouched", async () => {
      const hero = SLOTS[0]!.paths[0]!;

      const changed = await imagesChangedSinceStamp(
        root,
        SLOTS[0]!,
        [{ local_image_path: hero }],
        (await sources()) as never
      );

      expect(changed).toEqual([]);
    });

    // The sequence the review named: approve, replace the picture, re-run the
    // marker so the source record agrees with the new bytes, publish. Every
    // check that compares a file to its own record stays green through this,
    // because the record was rewritten to match. Only something written by
    // approval and untouched afterwards can catch it.
    it("catches a swap that was re-stamped to look consistent", async () => {
      const hero = SLOTS[0]!.paths[0]!;
      await autoApprove({ date: DATE, root });
      const snapshot = await loadApprovedImageDigests(root, DATE);

      await writeFile(join(root, ...hero.split("/")), png("a different picture entirely"));
      await markImageSource({
        root,
        date: DATE,
        slot: 1,
        source: "gpt-image-2",
        imagePath: hero
      });

      // The record now agrees with the new bytes, so the stamp check is happy.
      const byStamp = await imagesChangedSinceStamp(
        root,
        SLOTS[0]!,
        [{ local_image_path: hero }],
        (await sources()) as never
      );
      expect(byStamp).toEqual([]);

      // The approval snapshot is not.
      const byApproval = await imagesDifferFromApproval(
        root,
        SLOTS[0]!,
        [{ local_image_path: hero }],
        snapshot
      );
      expect(byApproval).toHaveLength(1);
      expect(byApproval[0]).toContain("不是被核准的那一張");
    });

    it("treats an image approval never saw as a change", async () => {
      await autoApprove({ date: DATE, root });
      const snapshot = await loadApprovedImageDigests(root, DATE);

      const differ = await imagesDifferFromApproval(
        root,
        SLOTS[0]!,
        [{ local_image_path: `docs/assets/${DATE}/slot-01-slide-05.png` }],
        snapshot
      );

      expect(differ[0]).toContain("不在核准當下的圖片清單裡");
    });

    it("says nothing about an unstamped file, because that is approval's business", async () => {
      const hero = SLOTS[0]!.paths[0]!;
      const entries = await sources();
      delete entries.find((e) => e.image_path === hero)!.image_sha256;
      await writeSources(entries);
      await writeFile(join(root, ...hero.split("/")), png("swapped after approval"));

      const changed = await imagesChangedSinceStamp(
        root,
        SLOTS[0]!,
        [{ local_image_path: hero }],
        (await sources()) as never
      );

      // Fail-closed here would block every legacy day at the moment of
      // publishing, which is a worse failure than the one it would catch.
      expect(changed).toEqual([]);
    });
  });

  it("blocks when the manifest has two entries for the same file", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const manifestPath = join(root, "data", "image-prompts", `${DATE}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown[];
    // An ambiguous manifest is not evidence. Taking the first match would let a
    // conflicting second entry sit there unnoticed.
    manifest.push({ slot: 1, target_path: hero, topic: SHOE, prompt: "a different prompt" });
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await autoApprove({ date: DATE, root });

    expect(about(result.blockers, hero).some((t) => t.includes("沒有唯一對應的條目"))).toBe(true);
  });

  it("blocks rather than crashing when the manifest contains junk entries", async () => {
    const manifestPath = join(root, "data", "image-prompts", `${DATE}.json`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown[];
    manifest.unshift(null, 42, "nonsense");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    // Malformed data has to become a refusal, not an exception: a throw here
    // escapes autoApprove and takes the whole day's approval with it, healthy
    // slots included.
    const result = await autoApprove({ date: DATE, root });

    expect(result.approved_slots).toEqual([1, 2]);
  });

  it("refuses to re-topic a record that has no hash to prove the file is unchanged", async () => {
    const hero = SLOTS[0]!.paths[0]!;
    const entries = await sources();
    // The shape every legacy record and every pre-fix Reel cover had.
    delete entries.find((e) => e.image_path === hero)!.image_sha256;
    await writeSources(entries);

    const calendarPath = join(root, "data", "content-calendar", `${DATE}.json`);
    const calendar = JSON.parse(await readFile(calendarPath, "utf8"));
    calendar.slots[0].topic = "完全不同的主題";
    await writeFile(calendarPath, JSON.stringify(calendar), "utf8");

    await expect(
      markImageSource({ root, date: DATE, slot: 1, source: "gpt-image-2", imagePath: hero })
    ).rejects.toThrow(/no file hash/);
  });

  it("blocks every image-bearing slot when the manifest cannot be read", async () => {
    await writeFile(join(root, "data", "image-prompts", `${DATE}.json`), "{ not json", "utf8");

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.some((t) => t.includes("manifest 缺失或無法解析"))).toBe(true);
  });
});
