import { describe, expect, it } from "vitest";
import { buildGrowthPlaybook, flattenGrowthPlaybook } from "../src/growthPlaybook";

describe("growth playbook", () => {
  it("builds a continuous 90-day, 2-slot plan with required growth fields", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);
    const rows = flattenGrowthPlaybook(playbook);

    expect(playbook.start_date).toBe("2026-07-11");
    expect(playbook.end_date).toBe("2026-10-08");
    expect(playbook.days).toHaveLength(90);
    expect(rows).toHaveLength(180);

    const expectedDates = Array.from({ length: 90 }, (_, index) =>
      new Date(Date.parse("2026-07-11T00:00:00.000Z") + index * 86_400_000).toISOString().slice(0, 10)
    );
    expect(playbook.days.map((day) => day.date)).toEqual(expectedDates);

    for (const row of rows) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([1, 2]).toContain(row.slot);
      expect(row.topic.length).toBeGreaterThan(8);
      expect(row.format).toBeTruthy();
      expect(row.visual_route).toBeTruthy();
      expect(row.traffic_route).toBeTruthy();
      expect(row.views_target).toBeGreaterThan(0);
      expect(row.follower_target).toBeGreaterThan(0);
      expect(row.hook).toContain(row.topic);
      expect(row.follow_cta).toContain("追蹤");
      expect(row.caption).toContain("私享家洗衣店");
      expect(row.caption).toContain(row.follow_cta);
      expect(row.hashtags).toContain("#私享家洗衣店");
      expect(row.hashtags).toHaveLength(4);
      expect(row.caption).not.toMatch(/畫面維持|這支內容會用|短影音題|轉詢問題|9:16|主視覺|route|SEO/);
      expect(row.caption).not.toMatch(/保證|百分之百|完全去除|恢復全新|一定洗白/);
      expect(row.image_or_reel_direction.length).toBeGreaterThan(20);
      expect(row.seo_sync_page).toMatch(/^\/(services|guides)\//);
      expect(row.ten_day_review_metric.length).toBeGreaterThan(20);
    }
  });

  it("keeps planned topics unique per slot across 90 days", () => {
    const rows = flattenGrowthPlaybook(buildGrowthPlaybook("2026-07-11", 90));
    for (const slot of [1, 2]) {
      const topics = rows
        .filter((row) => row.slot === slot)
        .map((row) => row.topic.replace(/^(先看懂|今天情境|可收藏|細節拆解|到店前判斷|送洗前先問)：/, ""));
      expect(new Set(topics).size).toBe(topics.length);
    }
  });

  it("does not concentrate both daily slots on the same service after the locked opening dates", () => {
    const days = buildGrowthPlaybook("2026-07-11", 90).days.slice(4);
    for (const day of days) {
      expect(day.slots[0]?.seo_sync_page, day.date).not.toBe(day.slots[1]?.seo_sync_page);
    }
  });

  it("ends with 1000 daily views plus follower growth targets and includes major poster nodes", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);
    const rows = flattenGrowthPlaybook(playbook);

    expect(playbook.days.at(-1)?.daily_views_target).toBe(1000);
    expect(playbook.days.at(-1)?.daily_follower_target).toBe(35);
    expect(rows.filter((row) => row.format === "poster").map((row) => row.date)).toEqual([
      "2026-08-05",
      "2026-08-16",
      "2026-09-18",
      "2026-10-07"
    ]);
    expect(rows.find((row) => row.date === "2026-09-25" && row.slot === 1)?.format).toBe("real-shop-photo");
  });

  it("keeps the first four scheduled days stable while adding all new service search routes", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);
    const rows = flattenGrowthPlaybook(playbook);

    expect(
      playbook.days.slice(0, 4).map((day) =>
        day.slots.map((slot) => ({ topic: slot.topic, seo_sync_page: slot.seo_sync_page }))
      )
    ).toEqual([
      [
        { topic: "先看懂：白鞋鞋邊泛灰前的檢查", seo_sync_page: "/services/white-shoe-cleaning.html" },
        { topic: "今天情境：雨後通勤回家不要直接收鞋", seo_sync_page: "/services/shoe-bag-care.html" }
      ],
      [
        { topic: "先看懂：包包提把手汗與邊油痕", seo_sync_page: "/services/shoe-bag-care.html" },
        { topic: "今天情境：下班最常背的包先看提把", seo_sync_page: "/services/shoe-bag-care.html" }
      ],
      [
        { topic: "先看懂：棉被收納前的濕氣與睡眠味", seo_sync_page: "/services/fabric-storage.html" },
        { topic: "今天情境：週末換季整理先分類布品", seo_sync_page: "/services/fabric-storage.html" }
      ],
      [
        { topic: "先看懂：深色衣服洗久變灰的判斷", seo_sync_page: "/services/fabric-storage.html" },
        { topic: "今天情境：暑假旅行回來先處理外套", seo_sync_page: "/services/fabric-storage.html" }
      ]
    ]);

    const expectedRoutes = [
      "/guides/shirt-suit-dry-cleaning.html",
      "/guides/bedding-duvet-cleaning.html",
      "/guides/plush-doll-cleaning.html",
      "/guides/luxury-dry-cleaning.html"
    ];
    for (const route of expectedRoutes) {
      const matchingRows = rows.filter((row) => row.seo_sync_page === route);
      expect(matchingRows.length).toBeGreaterThanOrEqual(2);
      expect(new Set(matchingRows.map((row) => row.slot))).toEqual(new Set([1, 2]));
      expect(matchingRows.every((row) => row.hashtags.length === 4)).toBe(true);
    }
  });
});
