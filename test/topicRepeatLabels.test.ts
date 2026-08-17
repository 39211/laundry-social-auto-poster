import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoApprove } from "../src/autoApprove";
import { stampDailyContentWrite } from "../src/contentPlan";

// The seven-day repeat gate compares the leading characters of slot 1's topic,
// to catch the makeup-bag package that ran four times in five days. It kept its
// own list of lead-in phrases, shorter than the one the captions strip, and it
// did not include 可收藏 -- which the playbook puts in front of every knowledge
// post from day 31. So a white shoe and a duvet looked like the same object,
// and 2026-08-16 onward would have blocked the morning post every single day,
// with the catch-up chain re-judging it into the same wall.
//
// A file label is not an object. These fix which of the two the gate reads.

const YESTERDAY = "2026-09-10";
const TODAY = "2026-09-11";
let root: string;

async function writeCalendar(date: string, slot1Topic: string): Promise<void> {
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    JSON.stringify(
      stampDailyContentWrite(
        {
          date,
          timezone: "Asia/Taipei",
          generated_at: new Date().toISOString(),
          slots: [1, 2].map((slot) => ({
            slot,
            time: slot === 1 ? "11:30" : "20:30",
            category: "知識文",
            topic: slot === 1 ? slot1Topic : "其他主題",
            format: "image-post",
            media_type: "image",
            instagram_caption: "caption",
            facebook_caption: "caption",
            image_prompt: "prompt",
            visual_route: "macro-detail",
            traffic_route: "object-proof",
            local_image_path: `docs/assets/${date}/slot-0${slot}.png`,
            public_image_url: `https://example.com/${date}-${slot}.png`,
            status: "pending"
          }))
        },
        { root }
      )
    ),
    "utf8"
  );
}

/** Only the repeat gate's own message, not other blockers this thin day has. */
async function repeatBlockers(): Promise<string[]> {
  const result = await autoApprove({ date: TODAY, root });
  return result.blockers.filter((b) => /主題與.*重複/.test(b));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "topic-repeat-"));
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

describe("the seven-day repeat gate reads the object, not the label", () => {
  it("allows two different objects that share a file label", async () => {
    await writeCalendar(YESTERDAY, "可收藏：白鞋鞋邊泛灰前的檢查，送洗前先看三個位置");
    await writeCalendar(TODAY, "可收藏：棉被收納前的濕氣與睡眠味，送洗前先看三個位置");

    expect(await repeatBlockers()).toEqual([]);
  });

  it("still blocks the same object on consecutive days", async () => {
    // The makeup bag that ran four times in five days is what this exists for.
    await writeCalendar(YESTERDAY, "可收藏：化妝包拉鍊邊卡粉，先看內袋縫線");
    await writeCalendar(TODAY, "可收藏：化妝包內裡的粉漬，送洗前先看三個位置");

    const blocked = await repeatBlockers();

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toContain("化妝包");
  });

  it("blocks a repeat even when the two days carry different labels", async () => {
    // Stripping the label must not become a way to smuggle a rerun past the
    // gate by relabelling it.
    await writeCalendar(YESTERDAY, "可收藏：行李箱輪子的乾泥，送洗前先看三個位置");
    await writeCalendar(TODAY, "先看懂：行李箱輪子卡泥後怎麼處理");

    expect(await repeatBlockers()).toHaveLength(1);
  });
});
