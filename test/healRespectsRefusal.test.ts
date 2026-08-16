import { createHash } from "node:crypto";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { healDay } from "../src/dayLock";
import { topicIdentity } from "../src/generateImage";
import { loadDailyContent } from "../src/logging";
import { markImageSource } from "../src/markImageSource";
import { REEL_CONCEPTS, loadExtensions } from "../src/reelConcepts";
import {
  healOneSlot,
  reelCoverPrompt,
  reelCoverSourceRel,
  slotMatchesPlanReel
} from "../src/scheduleReel";

const PROJECT = process.cwd();
const RUN_REELS = join(PROJECT, "output", "reels-run", "2026-07-29", "reels");
const RUN_REFS = join(PROJECT, "output", "reels-run", "2026-07-29", "references");
const CONCEPT_ID = "leather-bag-corner";
const DATE = "2026-09-23";
const OLD_TOPIC = "可收藏：深色衣服收進衣櫃前的氣味檢查";
const OLD_PROMPT = "Realistic shop photo of dark garments on a rack.";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function digestTree(dir: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string, rel: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      hash.update(`missing:${rel}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, nextRel);
      } else {
        hash.update(nextRel);
        hash.update(await readFile(full));
      }
    }
  }
  await walk(dir, "");
  return hash.digest("hex");
}

async function writableDigest(root: string, date: string): Promise<string> {
  const parts = await Promise.all([
    digestTree(join(root, "data", "content-calendar")),
    digestTree(join(root, "data", "image-prompts")),
    digestTree(join(root, "data", "image-sources")),
    digestTree(join(root, "data", "video-sources")),
    digestTree(join(root, "data", "video-runs")),
    digestTree(join(root, "docs", "assets", date))
  ]);
  return parts.join("|");
}

async function seedReelFixtures(root: string, conceptId: string, variants: Array<"10s" | "15s">): Promise<void> {
  const reelsDir = join(root, "output", "reels-run", "2026-07-29", "reels");
  const refsDir = join(root, "output", "reels-run", "2026-07-29", "references");
  await mkdir(reelsDir, { recursive: true });
  await mkdir(refsDir, { recursive: true });
  const base10 = join(RUN_REELS, `${conceptId}.mp4`);
  if (!(await exists(base10))) throw new Error(`Missing fixture ${conceptId}.mp4`);
  for (const variant of variants) {
    const name = variant === "15s" ? `${conceptId}-15s.mp4` : `${conceptId}.mp4`;
    const src =
      variant === "15s" && (await exists(join(RUN_REELS, name))) ? join(RUN_REELS, name) : base10;
    await copyFile(src, join(reelsDir, name));
    await copyFile(`${base10}.audio.json`, join(reelsDir, `${name}.audio.json`));
  }
  const before = join(RUN_REFS, `${conceptId}-before.png`);
  if (await exists(before)) {
    await copyFile(before, join(refsDir, `${conceptId}-before.png`));
  } else {
    await writeFile(join(refsDir, `${conceptId}-before.png`), Buffer.concat([PNG_MAGIC, Buffer.from("cover")]));
  }
}

function imageSlot(slot: number, topic: string, prompt: string, date = DATE) {
  return {
    slot,
    time: slot === 1 ? "11:30" : slot === 2 ? "19:30" : "12:00",
    category: slot === 1 ? "知識文" : "情境文",
    topic,
    format: "image-post" as const,
    media_type: "image" as const,
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: prompt,
    visual_route: "macro-detail" as const,
    traffic_route: "object-proof" as const,
    local_image_path: `docs/assets/${date}/slot-0${slot}.png`,
    public_image_url: `https://example.com/docs/assets/${date}/slot-0${slot}.png`,
    status: "pending" as const
  };
}

async function writeCalendar(root: string, slots: unknown[], date = DATE): Promise<void> {
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    `${JSON.stringify(
      {
        date,
        timezone: "Asia/Taipei",
        generated_at: `${date}T00:00:00.000Z`,
        slots
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function writeManifest(
  root: string,
  slots: Array<{ slot: number; topic: string; image_prompt: string; local_image_path: string }>,
  date = DATE
): Promise<void> {
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
        public_image_url: `https://example.com/${slot.local_image_path}`,
        visual_route: "macro-detail"
      }))
    ),
    "utf8"
  );
}

async function seedOutgoingImageSlot(
  root: string,
  slotNumber: number,
  topic = OLD_TOPIC,
  prompt = OLD_PROMPT,
  date = DATE
): Promise<{ path: string; bytes: Buffer }> {
  const slot1 = imageSlot(1, slotNumber === 1 ? topic : "其他主題", slotNumber === 1 ? prompt : "other prompt", date);
  const target = imageSlot(slotNumber, topic, prompt, date);
  const slots = slotNumber === 1 ? [target, imageSlot(2, "其他主題", "other prompt", date)] : [slot1, target];
  await writeCalendar(root, slots, date);
  await writeManifest(root, slots, date);
  const bytes = Buffer.concat([PNG_MAGIC, Buffer.from(`old-${slotNumber}`)]);
  await mkdir(join(root, "docs", "assets", date), { recursive: true });
  await writeFile(join(root, ...target.local_image_path.split("/")), bytes);
  await markImageSource({
    root,
    date,
    slot: slotNumber,
    source: "gpt-image-2",
    imagePath: target.local_image_path
  });
  return { path: target.local_image_path, bytes };
}

describe("healOneSlot respects invalidate refusals", () => {
  const roots: string[] = [];

  afterEach(async () => {
    // Leave temp dirs; Windows often locks them. Tests must not depend on cleanup.
    roots.length = 0;
  });

  async function tempRoot(label: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), label));
    roots.push(root);
    await seedReelFixtures(root, CONCEPT_ID, ["10s"]);
    return root;
  }

  it("keeps reading the invalidate report so dropping that read turns the suite red", async () => {
    const source = await readFile(new URL("../src/scheduleReel.ts", import.meta.url), "utf8");
    const healBody = source.slice(
      source.indexOf("export async function healOneSlot"),
      source.indexOf("async function main")
    );
    expect(healBody).toContain("invalidateSlotImagesIfTopicChanged");
    expect(healBody).toMatch(/invalidate = await invalidateSlotImagesIfTopicChanged/);
    expect(healBody).toMatch(/healStopReasonFromReport|report\.skipped|invalidate\.skipped/);
    expect(healBody).not.toContain("scheduleReel will still replace the cover");
    const matchBody = source.slice(
      source.indexOf("export async function slotMatchesPlanReel"),
      source.indexOf("export async function healOneSlot")
    );
    expect(matchBody).toContain("topicIdentity");
    expect(matchBody).not.toMatch(/slot\.topic === concept/);
  });

  it("stops on approved-log and writes nothing", async () => {
    const root = await tempRoot("heal-approved-");
    const { path, bytes } = await seedOutgoingImageSlot(root, 2);
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await writeFile(
      join(root, "data", "approved-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 2,
          platform: "instagram",
          status: "approved",
          approved_by: "test",
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );
    const before = await writableDigest(root, DATE);

    const result = await healOneSlot({
      date: DATE,
      slotNumber: 2,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("stopped");
    expect(result.stopReason).toBe("approved-log");
    expect(result.invalidate?.skipped.some((item) => item.reason === "approved-log")).toBe(true);
    expect(await writableDigest(root, DATE)).toBe(before);
    expect(await readFile(join(root, ...path.split("/")))).toEqual(bytes);
    const calendar = await loadDailyContent(DATE, root);
    expect(calendar?.slots.find((slot) => slot.slot === 2)?.topic).toBe(OLD_TOPIC);
    expect(calendar?.slots.find((slot) => slot.slot === 2)?.media_type).toBe("image");
  });

  it("stops on posted-log and writes nothing", async () => {
    const root = await tempRoot("heal-posted-");
    await seedOutgoingImageSlot(root, 2);
    await mkdir(join(root, "data", "posted-log"), { recursive: true });
    await writeFile(
      join(root, "data", "posted-log", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 2,
          platform: "instagram",
          status: "success",
          dry_run: false,
          attempts: 1,
          created_at: new Date().toISOString()
        }
      ]),
      "utf8"
    );
    const before = await writableDigest(root, DATE);

    const result = await healOneSlot({
      date: DATE,
      slotNumber: 2,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("stopped");
    expect(result.stopReason).toBe("posted-log");
    expect(result.invalidate?.skipped.some((item) => item.reason === "posted-log")).toBe(true);
    expect(await writableDigest(root, DATE)).toBe(before);
    const calendar = await loadDailyContent(DATE, root);
    expect(calendar?.slots.find((slot) => slot.slot === 2)?.topic).toBe(OLD_TOPIC);
  });

  it("stops on day-lock and writes nothing", async () => {
    const root = await tempRoot("heal-daylock-");
    await seedOutgoingImageSlot(root, 1);
    await mkdir(join(root, "data", "day-locks"), { recursive: true });
    await writeFile(
      join(root, "data", "day-locks", `${DATE}.json`),
      JSON.stringify({
        date: DATE,
        locked_at: new Date().toISOString(),
        slot1: { topic: OLD_TOPIC }
      }),
      "utf8"
    );
    const before = await writableDigest(root, DATE);

    const result = await healOneSlot({
      date: DATE,
      slotNumber: 1,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("stopped");
    expect(result.stopReason).toBe("day-lock");
    expect(result.invalidate?.skipped.some((item) => item.reason.includes("day-lock") || item.reason.startsWith("A3"))).toBe(
      true
    );
    expect(await writableDigest(root, DATE)).toBe(before);
    const calendar = await loadDailyContent(DATE, root);
    expect(calendar?.slots.find((slot) => slot.slot === 1)?.topic).toBe(OLD_TOPIC);
    expect(calendar?.slots.find((slot) => slot.slot === 1)?.media_type).toBe("image");
  });

  it("stops on protected-reel and writes nothing", async () => {
    const root = await tempRoot("heal-protected-");
    const concept = REEL_CONCEPTS.find((item) => item.id === CONCEPT_ID)!;
    const cover = `docs/assets/${DATE}/slot-02.png`;
    const video = `docs/assets/${DATE}/slot-02.mp4`;
    await writeCalendar(root, [
      imageSlot(1, "其他主題", "other prompt"),
      {
        ...imageSlot(2, OLD_TOPIC, OLD_PROMPT),
        media_type: "reel",
        format: "reel",
        topic: OLD_TOPIC,
        local_video_path: video,
        image_prompt: "Reel cover still: old clothes"
      }
    ]);
    await writeManifest(root, [
      imageSlot(1, "其他主題", "other prompt"),
      { ...imageSlot(2, OLD_TOPIC, OLD_PROMPT), local_image_path: cover }
    ]);
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    const coverBytes = Buffer.concat([PNG_MAGIC, Buffer.from("protected-cover")]);
    await writeFile(join(root, ...cover.split("/")), coverBytes);
    await writeFile(join(root, ...video.split("/")), "video-bytes");
    await markImageSource({ root, date: DATE, slot: 2, source: "gpt-image-2", imagePath: cover });
    const before = await writableDigest(root, DATE);

    const result = await healOneSlot({
      date: DATE,
      slotNumber: 2,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("stopped");
    expect(result.stopReason).toBe("protected-reel");
    expect(result.invalidate?.skipped.some((item) => item.reason === "protected-reel")).toBe(true);
    expect(await writableDigest(root, DATE)).toBe(before);
    expect(await readFile(join(root, ...cover.split("/")))).toEqual(coverBytes);
    const calendar = await loadDailyContent(DATE, root);
    const slot2 = calendar?.slots.find((slot) => slot.slot === 2);
    expect(slot2?.topic).toBe(OLD_TOPIC);
    expect(slot2?.media_type).toBe("reel");
    expect(slot2?.topic).not.toBe(concept.hook);
  });

  it("stops on A1-refusal and writes nothing", async () => {
    const root = await tempRoot("heal-a1-");
    const concept = REEL_CONCEPTS.find((item) => item.id === CONCEPT_ID)!;
    const nextPrompt = reelCoverPrompt(concept, reelCoverSourceRel(concept.id));
    await seedOutgoingImageSlot(root, 2, OLD_TOPIC, nextPrompt);
    const before = await writableDigest(root, DATE);

    const result = await healOneSlot({
      date: DATE,
      slotNumber: 2,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("stopped");
    expect(result.stopReason).toMatch(/^A1-refusal:/);
    expect(result.invalidate?.refused.some((item) => item.reason.includes("A1-refusal"))).toBe(true);
    expect(await writableDigest(root, DATE)).toBe(before);
    const calendar = await loadDailyContent(DATE, root);
    expect(calendar?.slots.find((slot) => slot.slot === 2)?.topic).toBe(OLD_TOPIC);
    expect(calendar?.slots.find((slot) => slot.slot === 2)?.media_type).toBe("image");
  });
});

describe("prefix-only Reel topic uses topicIdentity", () => {
  it("treats a canonical prefix on an otherwise matching Reel as already matched", async () => {
    const root = await mkdtemp(join(tmpdir(), "heal-prefix-"));
    await seedReelFixtures(root, CONCEPT_ID, ["10s"]);
    const concept = REEL_CONCEPTS.find((item) => item.id === CONCEPT_ID)!;
    const prefixed = `可收藏：${concept.hook}`;
    expect(topicIdentity(prefixed)).toBe(topicIdentity(concept.hook));
    expect(prefixed).not.toBe(concept.hook);

    const { scheduleReel } = await import("../src/scheduleReel");
    await scheduleReel({ date: DATE, conceptId: CONCEPT_ID, slot: 3, variant: "10s", root });
    const content = await loadDailyContent(DATE, root);
    const rewritten = {
      ...content!,
      slots: content!.slots.map((slot) => (slot.slot === 3 ? { ...slot, topic: prefixed } : slot))
    };
    await writeFile(
      join(root, "data", "content-calendar", `${DATE}.json`),
      `${JSON.stringify(rewritten, null, 2)}\n`,
      "utf8"
    );

    expect(
      await slotMatchesPlanReel({ date: DATE, slotNumber: 3, conceptId: CONCEPT_ID, variant: "10s", root })
    ).toBe(true);

    const before = await writableDigest(root, DATE);
    const result = await healOneSlot({
      date: DATE,
      slotNumber: 3,
      conceptId: CONCEPT_ID,
      variant: "10s",
      root
    });

    expect(result.action).toBe("already-matched");
    expect(await writableDigest(root, DATE)).toBe(before);
    const after = await loadDailyContent(DATE, root);
    expect(after?.slots.find((slot) => slot.slot === 3)?.topic).toBe(prefixed);
  });
});

describe("2026-08-17 daily-approve includes heal-reel-slot in order", () => {
  it("runs day-lock heal, then heal-reel-slot, then auto-approve", async () => {
    const script = await readFile(join(PROJECT, "scripts", "daily-approve.ps1"), "utf8");
    const dayLock = script.indexOf("npm.cmd run day-lock");
    const healReel = script.indexOf("npm.cmd run heal-reel-slot");
    const approve = script.indexOf("npm.cmd run auto-approve");
    expect(dayLock).toBeGreaterThan(-1);
    expect(healReel).toBeGreaterThan(dayLock);
    expect(approve).toBeGreaterThan(healReel);

    loadExtensions(PROJECT);
    const date = "2026-08-17";
    const conceptId = "suede-shoe-nap";
    const concept = REEL_CONCEPTS.find((item) => item.id === conceptId);
    expect(concept).toBeTruthy();

    const root = await mkdtemp(join(tmpdir(), "heal-0817-e2e-"));
    await seedReelFixtures(root, conceptId, ["15s"]);
    const realCalendar = JSON.parse(
      await readFile(join(PROJECT, "data", "content-calendar", `${date}.json`), "utf8")
    ) as { slots: Array<Record<string, unknown>> };
    expect(realCalendar.slots.find((slot) => slot.slot === 3)?.topic).toBe(concept!.hook);

    const clobbered = {
      ...realCalendar,
      slots: realCalendar.slots.map((slot) =>
        slot.slot === 3
          ? {
              ...slot,
              media_type: "carousel",
              format: "carousel-guide",
              topic: "wrong 0817 topic",
              local_video_path: undefined
            }
          : slot
      )
    };
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await writeFile(
      join(root, "data", "content-calendar", `${date}.json`),
      `${JSON.stringify(clobbered, null, 2)}\n`,
      "utf8"
    );

    const order: string[] = [];
    await healDay(date, root);
    order.push("day-lock-heal");
    const heal = await healOneSlot({
      date,
      slotNumber: 3,
      conceptId,
      variant: "15s",
      root
    });
    order.push("heal-reel-slot");
    const afterHeal = await loadDailyContent(date, root);
    expect(afterHeal?.slots.find((slot) => slot.slot === 3)?.media_type).toBe("reel");
    expect(afterHeal?.slots.find((slot) => slot.slot === 3)?.topic).toBe(concept!.hook);
    expect(heal.action).toBe("healed");

    const approveResult = await autoApprove({ date, root, approvedBy: "e2e", dryRun: true });
    order.push("auto-approve");
    expect(order).toEqual(["day-lock-heal", "heal-reel-slot", "auto-approve"]);
    expect(approveResult.date).toBe(date);
    const afterApprove = await loadDailyContent(date, root);
    expect(afterApprove?.slots.find((slot) => slot.slot === 3)?.media_type).toBe("reel");
    expect(afterApprove?.slots.find((slot) => slot.slot === 3)?.topic).toBe(concept!.hook);
  });
});
