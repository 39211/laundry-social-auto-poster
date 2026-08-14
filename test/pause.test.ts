import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { pausePath, readPause } from "../src/pause";

// There was no way to stop this pipeline. Deleting the approval log is undone
// by the catch-up chain, which re-approves any unapproved slot; disabling the
// scheduled tasks is undone by the morning watchdog, which deliberately
// re-enables them. Both brakes raced automation built to win.

const DATE = "2026-09-05";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pause-"));
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify({
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots: [1, 2].map((slot) => ({
        slot,
        time: slot === 1 ? "11:30" : "19:30",
        category: "知識文",
        topic: "測試",
        format: "image-post",
        media_type: "image",
        instagram_caption: "caption",
        facebook_caption: "caption",
        image_prompt: "prompt",
        visual_route: "macro-detail",
        local_image_path: `docs/assets/${DATE}/slot-0${slot}.png`,
        public_image_url: `https://example.com/slot-0${slot}.png`,
        status: "pending"
      }))
    }),
    "utf8"
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("the owner's brake", () => {
  it("stops approval from granting consent by any path", async () => {
    await writeFile(
      pausePath(root),
      JSON.stringify({ reason: "老闆說先停", since: "2026-09-05T01:00:00Z", paused_by: "owner" }),
      "utf8"
    );

    const result = await autoApprove({ date: DATE, root });

    expect(result.approved).toBe(false);
    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.join()).toContain("老闆說先停");
  });

  it("treats an unreadable brake as engaged, not as absent", async () => {
    // "I cannot parse the brake" must not read as "there is no brake": someone
    // still tried to stop the line.
    await writeFile(pausePath(root), "{ this is not json", "utf8");

    expect(await readPause(root)).toBeTruthy();
    expect((await autoApprove({ date: DATE, root })).approved).toBe(false);
  });

  it("is absent when no one set it", async () => {
    expect(await readPause(root)).toBeUndefined();
  });
});
