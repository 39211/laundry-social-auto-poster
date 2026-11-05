import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  dailySlotFromPlaybook,
  isDateBoundSlotCopy,
  playbookSlotForPausedEvening,
  resolveSlot1AgainstAired,
  SLOT_VARIANT_OFFSET_START_DATE,
  withSharedCaptionRules
} from "../src/contentPlan";
import type { GrowthPlaybookSlot } from "../src/growthPlaybook";

// A-CAPTION audit regressions. Only in-memory fake playbook rows; no network.

const SITE = "https://sixiangjialaundry.com";
const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_SITE_BASE_URL: SITE,
  PUBLIC_IMAGE_BASE_URL: SITE,
  META_ACCESS_TOKEN: "x",
  FB_PAGE_ID: "x",
  IG_USER_ID: "x"
});

function fakeSlot(over: Partial<GrowthPlaybookSlot>): GrowthPlaybookSlot {
  return {
    date: "2026-11-10",
    day: 1,
    slot: 1,
    time: "07:30",
    format: "image-post",
    topic: "衣櫃收納前的味道",
    hook: "衣櫃一打開就有味道",
    follow_cta: "追蹤私享家洗衣店，每天一則洗護小知識",
    hashtags: ["#私享家洗衣店"],
    seo_sync_page: "/services/fabric-storage.html",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    image_or_reel_direction: "門市隨手拍，物件放在櫃台上。",
    content_role: "reach-answer",
    ...over
  } as unknown as GrowthPlaybookSlot;
}

function dateSeries(start: string, count: number): string[] {
  const base = Date.parse(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

const tracking = { source: "facebook" as const, campaign: "test", siteBaseUrl: SITE };

describe("F1: no invented comparative claim on luxury posts", () => {
  it("the luxury fold line never says it damages less than ordinary washing", () => {
    let sawNeutralLine = false;
    for (const date of dateSeries("2026-11-10", 6)) {
      const daily = dailySlotFromPlaybook(
        fakeSlot({
          date,
          topic: "精品邊角與五金檢查",
          hook: "精品最先出問題的是邊角",
          seo_sync_page: "/services/luxury-dry-cleaning.html"
        }),
        config
      );
      for (const caption of [daily.facebook_caption, daily.instagram_caption]) {
        expect(caption, date).not.toContain("洗壞的機率");
        expect(caption, date).not.toMatch(/比一般水洗/);
        if (caption.includes("精品要先看材質和五金")) sawNeutralLine = true;
      }
    }
    expect(sawNeutralLine).toBe(true);
  });
});

describe("F3: a price line shows only the object the post is about", () => {
  it("a suit-jacket post does not show the vest price", () => {
    const suit = withSharedCaptionRules("西裝外套不能只看外面。\n\n#私享家洗衣店", "西裝外套肩線與內裡狀態", tracking, "2026-11-10");
    expect(suit).not.toContain("西裝背心");
    expect(suit).not.toContain("$80");
  });

  it("a coat post shows only the coat price and a vest post only the vest price", () => {
    const coat = withSharedCaptionRules("大衣領口先暗。\n\n#私享家洗衣店", "大衣領口暗沉", tracking, "2026-11-10");
    expect(coat).toContain("長大衣 $300");
    expect(coat).not.toContain("$80");

    const vest = withSharedCaptionRules("背心先看領圍。\n\n#私享家洗衣店", "西裝背心領圍汗漬", tracking, "2026-11-10");
    expect(vest).toContain("西裝背心 $80");
    expect(vest).not.toContain("$300");
  });
});

describe("F5: a collision fallback never rebases date-bound copy onto another date", () => {
  const dated1 = fakeSlot({
    date: "2026-08-01",
    topic: "父親節前的西裝肩線",
    hook: "父親節前：西裝肩線先看",
    seo_sync_page: "/services/shirt-suit-dry-cleaning.html"
  });
  const clean1 = fakeSlot({
    date: "2026-08-02",
    topic: "棉被收納前的濕氣",
    hook: "棉被收櫃前先聞一下",
    seo_sync_page: "/services/bedding-duvet-cleaning.html"
  });

  it("isDateBoundSlotCopy spots holiday, season and school-uniform copy", () => {
    expect(isDateBoundSlotCopy(dated1)).toBe(true);
    expect(isDateBoundSlotCopy(fakeSlot({ topic: "梅雨季衣櫃有味道" }))).toBe(true);
    expect(isDateBoundSlotCopy(fakeSlot({ seo_sync_page: "/services/school-uniform-care.html", topic: "制服汗味" }))).toBe(true);
    expect(isDateBoundSlotCopy(clean1)).toBe(false);
  });

  it("slot 1 skips the dated row and takes the next clear one", () => {
    const today = fakeSlot({ date: "2026-11-10", topic: "白鞋泛黃先看中底", hook: "白鞋泛黃先看中底" });
    const resolved = resolveSlot1AgainstAired(today, ["白鞋泛黃怎麼判斷"], { days: [{ slots: [dated1] }, { slots: [clean1] }] });
    expect(resolved.topic).toBe("棉被收納前的濕氣");
    expect(resolved.date).toBe("2026-11-10");
    expect(resolved.hook).not.toContain("父親節");
  });

  it("slot 1 keeps its own row when every other row is date-bound", () => {
    const today = fakeSlot({ date: "2026-11-10", topic: "白鞋泛黃先看中底", hook: "白鞋泛黃先看中底" });
    const resolved = resolveSlot1AgainstAired(today, ["白鞋泛黃怎麼判斷"], { days: [{ slots: [dated1] }] });
    expect(resolved.topic).toBe("白鞋泛黃先看中底");
  });

  it("the paused evening slot skips the dated row as well", () => {
    const today = fakeSlot({ date: "2026-11-10", slot: 2, time: "19:30", topic: "白鞋泛黃先看中底", hook: "白鞋泛黃先看中底" });
    const dated2 = { ...dated1, slot: 2 } as GrowthPlaybookSlot;
    const clean2 = { ...clean1, slot: 2 } as GrowthPlaybookSlot;
    const resolved = playbookSlotForPausedEvening(today, ["白鞋泛黃怎麼判斷"], {
      days: [{ slots: [dated2] }, { slots: [clean2] }]
    });
    expect(resolved.topic).toBe("棉被收納前的濕氣");
    expect(resolved.date).toBe("2026-11-10");
    expect(resolved.hook).not.toContain("父親節");
  });
});

describe("F6: the two posts of one day do not print the same bridge and inspection blocks", () => {
  it("blocks 2 and 3 differ between slot 1 and slot 2 on a shared service page", () => {
    for (const date of dateSeries("2026-11-10", 4)) {
      const morning = dailySlotFromPlaybook(fakeSlot({ date, slot: 1, time: "07:30" }), config);
      const evening = dailySlotFromPlaybook(
        fakeSlot({
          date,
          slot: 2,
          time: "19:30",
          topic: "厚外套收納前的乾燥",
          hook: "厚外套收進衣櫃前先摸一下",
          content_role: "evidence-conversion"
        }),
        config
      );
      const a = morning.facebook_caption.split("\n\n");
      const b = evening.facebook_caption.split("\n\n");
      expect(a[1], `${date} block 2`).not.toBe(b[1]);
      expect(a[2], `${date} block 3`).not.toBe(b[2]);
    }
  });

  it("dates before the cut-over keep the legacy index, so frozen captions stay identical", () => {
    const date = "2026-11-07";
    expect(date < SLOT_VARIANT_OFFSET_START_DATE).toBe(true);
    const morning = dailySlotFromPlaybook(fakeSlot({ date, slot: 1, time: "07:30" }), config);
    const evening = dailySlotFromPlaybook(fakeSlot({ date, slot: 2, time: "19:30" }), config);
    expect(morning.facebook_caption.split("\n\n")[1]).toBe(evening.facebook_caption.split("\n\n")[1]);
  });

  it("one caption still draws all its blocks from the same variant index", () => {
    const daily = dailySlotFromPlaybook(fakeSlot({ date: "2026-11-11", slot: 2, time: "19:30" }), config);
    expect(daily.facebook_caption.split("\n\n").length).toBeGreaterThanOrEqual(3);
  });
});
