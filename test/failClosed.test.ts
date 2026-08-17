import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";
import { scheduleReel } from "../src/scheduleReel";

// The three properties in this file are the ones the whole publishing chain
// leans on and none of them had a test: unattended approval must refuse and
// write nothing when a gate fails, scheduling must never approve, and a
// missing reel must stop scheduling before anything is written. Each is a
// stated design rule in its module's comments; here they become assertions.

let root: string;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const DATE = "2026-09-01";

async function writeMinimalCalendar(targetRoot: string, date: string): Promise<void> {
  await mkdir(join(targetRoot, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(targetRoot, "data", "content-calendar", `${date}.json`),
    JSON.stringify(
      stampDailyContentWrite(
        {
          date,
          timezone: "Asia/Taipei",
          generated_at: new Date().toISOString(),
          slots: [1, 2].map((slotNumber) => ({
            slot: slotNumber,
            time: slotNumber === 1 ? "11:30" : "19:30",
            category: slotNumber === 1 ? "知識文" : "情境文",
            topic: "測試",
            format: "image-post",
            media_type: "image",
            instagram_caption: "caption",
            facebook_caption: "caption",
            image_prompt: "prompt",
            visual_route: "macro-detail",
            traffic_route: "object-proof",
            local_image_path: `docs/assets/${date}/slot-0${slotNumber}.png`,
            public_image_url: `https://example.com/assets/${date}/slot-0${slotNumber}.png`,
            status: "pending"
          }))
        },
        { root: targetRoot }
      )
    ),
    "utf8"
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fail-closed-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("unattended approval fails closed", () => {
  it("refuses a day with no publishing policy and writes no approval record", async () => {
    await writeMinimalCalendar(root, DATE);
    // No policy file, no images: multiple gates fail at once.

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    // The refusal must leave nothing behind that a later publish run could
    // read as consent.
    expect(await fileExists(join(root, "data", "approved-log", `${DATE}.json`))).toBe(false);
  });

  it("approves the healthy slot when only the other slot is broken", async () => {
    // Approval used to be all-or-nothing: on 2026-08-01 a regenerated slot 1
    // pointing at slides that were never produced would have blocked the
    // reviewed Reel in slot 2 as well, repeating the zero-publish day.
    await writeMinimalCalendar(root, DATE);
    await writeFile(
      join(root, "data", "publishing-policy.json"),
      JSON.stringify({
        status: "active",
        start_date: "2026-08-01",
        end_date: "2026-12-31",
        platforms: ["facebook", "instagram"],
        slots: [{ slot: 1 }, { slot: 2 }],
        same_day_catch_up: true
      }),
      "utf8"
    );
    // Slot 2's image exists with a source record; slot 1's does not. The
    // fixture must carry a real PNG signature: approval now verifies magic
    // bytes, so text placeholders are (correctly) blocked.
    await mkdir(join(root, "docs", "assets", DATE), { recursive: true });
    const pngFixture = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("image bytes")
    ]);
    await writeFile(join(root, "docs", "assets", DATE, "slot-02.png"), pngFixture);
    // Slot 2 has to be healthy under every gate, not just the ones that existed
    // when this test was written: approval now demands, for every image of every
    // slot, a manifest entry agreeing with the topic and a source record bound
    // to the file's bytes and to the prompt that made them.
    const slot2Path = `docs/assets/${DATE}/slot-02.png`;
    const slot2Prompt = "prompt";
    await mkdir(join(root, "data", "image-prompts"), { recursive: true });
    await writeFile(
      join(root, "data", "image-prompts", `${DATE}.json`),
      JSON.stringify([{ slot: 2, target_path: slot2Path, topic: "測試", prompt: slot2Prompt }]),
      "utf8"
    );
    const hash = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
    await mkdir(join(root, "data", "image-sources"), { recursive: true });
    await writeFile(
      join(root, "data", "image-sources", `${DATE}.json`),
      JSON.stringify([
        {
          date: DATE,
          slot: 2,
          source: "gpt-image-2",
          image_path: slot2Path,
          marked_at: new Date().toISOString(),
          topic: "測試",
          prompt_sha256: hash(slot2Prompt),
          image_sha256: hash(pngFixture)
        }
      ]),
      "utf8"
    );

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved_slots).toEqual([2]);
    expect(result.blockers.some((text) => text.includes("slot-01"))).toBe(true);
  });
});

describe("scheduling a reel", () => {
  it("stops on a missing reel file before writing anything", async () => {
    await writeMinimalCalendar(root, DATE);

    await expect(scheduleReel({ date: DATE, conceptId: "shirt-collar", root })).rejects.toThrow();

    // Failing after a partial write would leave the calendar claiming a video
    // that does not exist, so the failure has to come first.
    expect(await fileExists(join(root, "data", "video-sources", `${DATE}.json`))).toBe(false);
    const calendar = JSON.parse(
      await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")
    );
    expect(calendar.slots[0].media_type).toBe("image");
    expect(await fileExists(join(root, "data", "approved-log", `${DATE}.json`))).toBe(false);
  });

  it("rejects an unknown concept by name", async () => {
    await expect(scheduleReel({ date: DATE, conceptId: "no-such-concept", root })).rejects.toThrow(
      /Unknown concept/
    );
  });
});
