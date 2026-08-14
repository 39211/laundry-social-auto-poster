import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";

// On 2026-08-14 slot 1 was correctly blocked for caption-over-wrong-photos, and
// then re-running `generate-image-manifest` turned the gate green on its own --
// the files on disk were still pictures of a different pair of shoes. The gate
// was asking a witness that can be rewritten at any time.
//
// The second witness is the topic stamped onto each file when it was written.
// These tests pin its discrimination: it must fire on a mismatch, name the
// offending file, refuse an unstamped record, and stay quiet when the record
// agrees with the caption. A day this thin fails other gates too, so each
// assertion is about this blocker specifically and not about the verdict.

const DATE = "2026-09-02";
const CAPTION_TOPIC = "白鞋鞋邊泛灰前的檢查";
const IMAGE = `docs/assets/${DATE}/slot-01.png`;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "topic-witness-"));
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await writeFile(
    join(root, "data", "content-calendar", `${DATE}.json`),
    JSON.stringify({
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots: [
        {
          slot: 1,
          time: "11:30",
          category: "知識文",
          topic: CAPTION_TOPIC,
          format: "image-post",
          media_type: "image",
          instagram_caption: "caption",
          facebook_caption: "caption",
          image_prompt: "prompt",
          visual_route: "macro-detail",
          local_image_path: IMAGE,
          public_image_url: `https://example.com/assets/${DATE}/slot-01.png`,
          status: "pending"
        },
        // A calendar is rejected outright below two slots, so the day needs a
        // second one even though this witness only ever looks at slot 1.
        {
          slot: 2,
          time: "19:30",
          category: "情境文",
          topic: "另一個主題",
          format: "image-post",
          media_type: "image",
          instagram_caption: "caption",
          facebook_caption: "caption",
          image_prompt: "prompt",
          visual_route: "macro-detail",
          local_image_path: `docs/assets/${DATE}/slot-02.png`,
          public_image_url: `https://example.com/assets/${DATE}/slot-02.png`,
          status: "pending"
        }
      ]
    }),
    "utf8"
  );
  await mkdir(join(root, "data", "image-sources"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

async function writeSource(record: Record<string, unknown>): Promise<void> {
  await writeFile(
    join(root, "data", "image-sources", `${DATE}.json`),
    JSON.stringify([{ date: DATE, slot: 1, source: "gpt-image-2", image_path: IMAGE, ...record }]),
    "utf8"
  );
}

function witnessBlockers(blockers: string[]): string[] {
  return blockers.filter((text) => text.includes(IMAGE));
}

describe("the topic stamped on each image file", () => {
  it("blocks and names the file when it disagrees with the caption", async () => {
    await writeSource({ topic: "行李箱收進櫃子前,先看輪子" });

    const result = await autoApprove({ date: DATE, root });

    const named = witnessBlockers(result.blockers);
    expect(named.some((text) => text.includes("文不配圖"))).toBe(true);
    expect(named.some((text) => text.includes("行李箱"))).toBe(true);
  });

  it("blocks when the file carries no topic at all, because agreement is then unproven", async () => {
    await writeSource({});

    const result = await autoApprove({ date: DATE, root });

    expect(witnessBlockers(result.blockers).some((text) => text.includes("沒有記錄產生當下的主題"))).toBe(
      true
    );
  });

  // The shape of the actual 2026-08-14 accident, and the one the first three
  // tests could not see: the manifest has been rebuilt so it agrees with the
  // caption, while the file on disk was made for something else. Designed by
  // the grok review seat, which pointed out that the fixture never writes an
  // image-prompts file at all -- so the first witness always lands in its catch
  // branch and the tests never exercise "manifest green, file stale".
  it("blocks when the manifest agrees but the file's own stamp does not", async () => {
    await writeSource({ topic: "行李箱收進櫃子前,先看輪子" });
    await mkdir(join(root, "data", "image-prompts"), { recursive: true });
    await writeFile(
      join(root, "data", "image-prompts", `${DATE}.json`),
      JSON.stringify([{ slot: 1, topic: CAPTION_TOPIC }]),
      "utf8"
    );

    const result = await autoApprove({ date: DATE, root });

    expect(witnessBlockers(result.blockers).some((text) => text.includes("文不配圖"))).toBe(true);
  });

  it("says nothing about the file when the stamped topic matches the caption", async () => {
    await writeSource({ topic: CAPTION_TOPIC });

    const result = await autoApprove({ date: DATE, root });

    // Other gates still fail this thin fixture; this witness must not be one of
    // them, or the two cases above would prove nothing.
    expect(
      witnessBlockers(result.blockers).filter(
        (text) => text.includes("文不配圖") || text.includes("沒有記錄產生當下的主題")
      )
    ).toEqual([]);
  });
});
