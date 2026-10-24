import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  HASHTAG_TRIM_MAX,
  HASHTAG_TRIM_START_DATE,
  buildDailyContent,
  hashtagTrimActive,
  upgradeHashtags
} from "../src/contentPlan";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com",
  PUBLIC_IMAGE_BASE_URL: "https://sixiangjialaundry.com",
  META_ACCESS_TOKEN: "x",
  FB_PAGE_ID: "x",
  IG_USER_ID: "x"
});

function tagsOf(caption: string): string[] {
  return caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

const SEED_TAGS = ["#私享家洗衣店", "#台中西屯洗衣店", "#白鞋清潔", "#鞋子保養"];

describe("hashtag ladder trim from 2026-09-17", () => {
  it("pins the start date: 09-13..09-16 belong to the free-headline knife alone", () => {
    expect(HASHTAG_TRIM_START_DATE).toBe("2026-09-17");
    expect(hashtagTrimActive("2026-09-16")).toBe(false);
    expect(hashtagTrimActive("2026-09-17")).toBe(true);
    expect(hashtagTrimActive(undefined)).toBe(false);
  });

  it("keeps the eleven-tag ladder before the date and cuts to at most six from it", () => {
    const before = upgradeHashtags(SEED_TAGS, "白鞋鞋邊泛灰", "2026-09-16");
    const after = upgradeHashtags(SEED_TAGS, "白鞋鞋邊泛灰", "2026-09-17");
    expect(before).toHaveLength(11);
    expect(after).toEqual(["#私享家洗衣店", "#台中西屯洗衣店", "#白鞋清潔", "#鞋子保養", "#台中洗鞋", "#台中洗衣店"]);
    expect(after.length).toBeLessThanOrEqual(HASHTAG_TRIM_MAX);
    // the dropped rungs, by name
    for (const tag of ["#洗鞋推薦", "#球鞋清洗", "#西屯", "#逢甲", "#台中"]) expect(after).not.toContain(tag);
  });

  it("still carries one intent tag and the one local tag a small account can rank on", () => {
    expect(upgradeHashtags(SEED_TAGS.slice(0, 2), "棉被收納前的濕氣", "2026-09-20")).toEqual([
      "#私享家洗衣店",
      "#台中西屯洗衣店",
      "#棉被送洗",
      "#台中洗衣店"
    ]);
    // a topic with no intent match keeps brand + seed + local only
    expect(upgradeHashtags(["#私享家洗衣店", "#台中西屯洗衣店", "#私享家觀察", "#洗護日常"], "門市十天洗護觀察", "2026-09-26")).toEqual([
      "#私享家洗衣店",
      "#台中西屯洗衣店",
      "#私享家觀察",
      "#洗護日常",
      "#台中洗衣店"
    ]);
  });

  it("applies to every generated caption from the date, on both platforms and both slots", () => {
    for (const date of ["2026-09-17", "2026-09-19", "2026-09-27", "2026-10-03"]) {
      const content = buildDailyContent(date, config, { today: "2026-09-06" });
      for (const slot of content.slots.filter((item) => item.slot <= 2)) {
        for (const caption of [slot.facebook_caption, slot.instagram_caption]) {
          const tags = tagsOf(caption);
          expect(tags.length, `${date} s${slot.slot}`).toBeLessThanOrEqual(HASHTAG_TRIM_MAX);
          expect(tags.length, `${date} s${slot.slot}`).toBeGreaterThanOrEqual(4);
          expect(tags, `${date} s${slot.slot}`).toContain("#私享家洗衣店");
          expect(tags, `${date} s${slot.slot}`).toContain("#台中洗衣店");
          expect(tags, `${date} s${slot.slot}`).not.toContain("#台中");
        }
      }
    }
  });

  it("leaves the day before the date on the old ladder (the 72h comparison needs an untouched control)", () => {
    const content = buildDailyContent("2026-09-16", config, { today: "2026-09-06" });
    for (const slot of content.slots.filter((item) => item.slot <= 2)) {
      expect(tagsOf(slot.instagram_caption).length, `s${slot.slot}`).toBeGreaterThanOrEqual(8);
    }
  });
});
