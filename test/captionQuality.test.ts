import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent, linePostRedirectUrl } from "../src/contentPlan";

// Thirty days of generated captions, checked for the faults that thirty days of
// real posting produced: no comments, no link taps, three saves. Every fault
// below was measured in the copy that was actually going out, not imagined.

const config = getConfig();
const dates = Array.from({ length: 30 }, (_, offset) =>
  new Date(Date.UTC(2026, 7, 10 + offset)).toISOString().slice(0, 10)
);
// Slot 3 is the optional noon A/B Reel stub; caption quality gates still apply
// to the primary two posts that the 90-day programme is measured on.
const captions = dates.flatMap((date) =>
  buildDailyContent(date, config)
    .slots.filter((slot) => slot.slot <= 2)
    .map((slot) => ({
      date,
      slot: slot.slot,
      text: slot.instagram_caption ?? "",
      blocks: (slot.instagram_caption ?? "").split("\n\n")
    }))
);

// Prompts, not just captions: the 2026-08-14 carousel for 白鞋鞋邊泛灰 was
// generated as navy canvas shoes because the subject was a per-category
// constant. No gate could see it -- they check that an image exists, not that
// it shows the object the words are about.
const prompted = dates.flatMap((date) =>
  buildDailyContent(date, config).slots.flatMap((slot) => [
    { date, topic: slot.topic, prompt: slot.image_prompt ?? "" },
    ...(slot.carousel_items ?? []).map((item) => ({
      date,
      topic: slot.topic,
      prompt: item.image_prompt ?? ""
    }))
  ])
);

describe("image prompts name the object the topic is about", () => {
  it("never asks for navy shoes on a white-shoe topic", () => {
    const whiteShoe = prompted.filter((entry) => /白鞋/.test(entry.topic) && entry.prompt);
    expect(whiteShoe.length, "no 白鞋 topic in the sampled month").toBeGreaterThan(0);
    for (const entry of whiteShoe) {
      expect(entry.prompt, `${entry.date} 白鞋 prompt asks for navy`).not.toMatch(/navy/i);
      expect(entry.prompt, `${entry.date} 白鞋 prompt never says white`).toMatch(/white/i);
    }
  });
});

describe("caption quality", () => {
  it("never spends the fold line on the shop name", () => {
    // Instagram folds around 125 characters, so block 2 is the last thing most
    // readers see. It held the account's own name on all sixty posts.
    for (const caption of captions) {
      expect(caption.blocks[1]).not.toBe("私享家洗衣店");
    }
  });

  it("still says who the shop is", () => {
    for (const caption of captions) {
      expect(caption.text).toContain("私享家");
    }
  });

  it("gives the reader the LINE ID the videos point at", () => {
    // The Reels say "LINE 聯絡" but until 2026-08-07 no caption carried the
    // actual ID, so the call to action pointed at nothing findable.
    for (const caption of captions) {
      expect(caption.text).toContain("0968327653");
    }
  });

  it("carries the tappable LINE redirect with source=post", () => {
    const lineUrl = linePostRedirectUrl();
    for (const caption of captions) {
      expect(caption.text).toContain(lineUrl);
    }
  });

  it("asks something answerable", () => {
    for (const caption of captions) {
      expect(caption.text).toContain("？");
    }
  });

  it("keeps any slot-2 action sentence at or under half the sampled captions", () => {
    const action = /^拍.+和.+兩張傳 LINE，我們先看。$/;
    const counts = new Map<string, number>();
    for (const caption of captions) {
      for (const block of caption.blocks) {
        if (action.test(block)) counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
    for (const [sentence, count] of counts) {
      expect(count, sentence).toBeLessThanOrEqual(captions.length / 2);
    }
  });

  it("does not repeat one sentence across most of a month", () => {
    // A sentence on every post is invisible while writing one caption and
    // unmistakable to anyone who follows the account for a week. The worst
    // offender was on 60 of 60.
    const counts = new Map<string, number>();
    for (const caption of captions) {
      for (const block of caption.blocks) {
        // Hashtags and the LINE contact line are deliberate boilerplate, like
        // the follow line: identical on purpose, not accidental repetition.
        // Exempt the contact line by identity, not by its opening words. When
        // the phone number became a tappable link the prefix changed and this
        // test started counting deliberate boilerplate as accidental repetition.
        if (block.startsWith("#") || block.includes("go/line.html") || block.length < 12) continue;
        counts.set(block, (counts.get(block) ?? 0) + 1);
      }
    }
    const worst = [...counts].sort((a, b) => b[1] - a[1])[0];
    expect(worst?.[1] ?? 0).toBeLessThanOrEqual(captions.length / 2);
  });

  it("does not repeat a phrase inside a single caption", () => {
    // Both copies are on screen at once, so this reads worse than repetition
    // across days. The follow line is excluded: it is boilerplate by design.
    for (const caption of captions) {
      const blocks = caption.blocks.filter(
        (block) => !block.startsWith("#") && !block.startsWith("追蹤")
      );
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          const a = blocks[i] ?? "";
          const b = blocks[j] ?? "";
          for (let start = 0; start + 6 <= a.length; start += 1) {
            const piece = a.slice(start, start + 6);
            if (/[，。？、｜#]/.test(piece)) continue;
            expect(
              b.includes(piece),
              `${caption.date} slot ${caption.slot} repeats "${piece}"`
            ).toBe(false);
          }
        }
      }
    }
  });

  it("does not open by asking the reader to photograph four things", () => {
    // The first ask was a full view, a detail, an edge and the care label,
    // before any exchange had happened. Thirty days of it produced no
    // inquiries. One photo is the ask; the rest is a reply.
    for (const caption of captions) {
      expect(caption.text).not.toMatch(/先拍完整外觀[、，]局部/);
    }
  });

  it("keeps no filing label or boilerplate tail in the hook", () => {
    // The hook is the first line and most of what survives the fold. In the
    // playbook it carried a category label on 155 of 180 hooks and a fixed
    // tail on 105 of them, leaving about twenty characters that said anything.
    for (const caption of captions) {
      const hook = caption.blocks[0] ?? "";
      expect(hook).not.toMatch(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/);
      expect(hook).not.toContain("重點不是急著洗");
      expect(hook).not.toContain("用 15 秒看懂材質與狀況判斷");
    }
  });

  it("keeps one caption about one object", () => {
    // shoe-bag-care covers shoes and bags, and each block is picked from its
    // own list by the same day number. Lists that alternated object differently
    // produced a caption that observed a shoe and then asked about a handbag.
    const shoeOnly = (text: string) => /鞋/.test(text) && !/包/.test(text);
    const bagOnly = (text: string) => /包/.test(text) && !/鞋/.test(text);

    for (const caption of captions) {
      const body = caption.blocks.filter(
        (block) => !block.startsWith("#") && !block.startsWith("追蹤")
      );
      const hasShoe = body.some(shoeOnly);
      const hasBag = body.some(bagOnly);
      expect(
        hasShoe && hasBag,
        `${caption.date} slot ${caption.slot} mixes shoes and bags:\n${body.join("\n")}`
      ).toBe(false);
    }
  });

  it("routes Instagram readers to a direct message, never to the profile link", () => {
    // Thirty days of account insights recorded zero profile-link taps.
    for (const caption of captions) {
      expect(caption.text).not.toContain("點個人檔案連結");
    }
  });
});
