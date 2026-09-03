import { describe, expect, it } from "vitest";
import { searchVisibilityForContent } from "../src/searchVisibilityStrategy";
import { buildGrowthPlaybook, flattenGrowthPlaybook } from "../src/growthPlaybook";

describe("growth playbook", () => {
  it("assigns six distinct bag prompts to a bag topic before shared shoe terms", () => {
    const assignment = searchVisibilityForContent("shoe-bag", 1, "包包提把髒了怎麼辦");

    expect(assignment.target_queries).toEqual([
      "台中洗包包",
      "西屯洗包包",
      "台中洗包",
      "包包提把清潔",
      "包包發霉怎麼辦",
      "皮革包包清潔"
    ]);
    expect(new Set(assignment.target_queries).size).toBe(6);
  });

  it("assigns six distinct shoe prompts to a shoe topic before shared bag terms", () => {
    const assignment = searchVisibilityForContent("shoe-bag", 1, "白鞋泛黃怎麼辦");

    expect(assignment.target_queries).toEqual([
      "台中洗鞋",
      "西屯洗鞋",
      "逢甲洗鞋",
      "台中洗鞋店",
      "台中白鞋清潔",
      "球鞋清洗台中"
    ]);
  });

  it("assigns three shoe and three bag prompts to a mixed shoe-and-bag topic", () => {
    const assignment = searchVisibilityForContent("shoe-bag", 1, "白鞋和皮革包一起送洗前怎麼拍");

    expect(assignment.target_queries).toEqual([
      "台中洗鞋",
      "西屯洗鞋",
      "逢甲洗鞋",
      "台中洗包包",
      "西屯洗包包",
      "台中洗包"
    ]);
  });

  it("keeps expanded prompts within the confirmed shoe, bag, clothing, bedding, and pickup services", () => {
    const assignments = [
      searchVisibilityForContent("white-shoe", 1, "白鞋泛黃怎麼辦"),
      searchVisibilityForContent("shoe-bag", 1, "皮革包包發霉怎麼辦"),
      searchVisibilityForContent("fabric-storage", 1, "羽絨被收納前要送洗嗎"),
      searchVisibilityForContent("pickup-delivery", 1, "台中床被收送怎麼預約")
    ];

    for (const assignment of assignments) {
      expect(assignment.target_queries).toHaveLength(6);
      expect(assignment.target_queries.join(" ")).not.toMatch(/窗簾|地毯|行李箱|企業洗衣/u);
    }
  });

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
      expect(row.content_role).toBe(row.slot === 1 ? "reach-answer" : "evidence-conversion");
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
      expect(row.search_intent).toMatch(
        /^(local-discovery|problem-diagnosis|service-comparison|trust-proof|pickup-logistics|aftercare)$/
      );
      expect(row.target_queries.length).toBeGreaterThanOrEqual(3);
      expect(row.target_queries.length).toBeLessThanOrEqual(6);
      expect(new Set(row.target_queries).size).toBe(row.target_queries.length);
      expect(row.evidence_type).toMatch(
        /^(verified-business-fact|first-party-inspection|real-case-photo|service-boundary|customer-question|pickup-logistics)$/
      );
      expect(row.ten_day_review_metric.length).toBeGreaterThan(20);
    }

    expect(playbook.search_intent_clusters.map((cluster) => cluster.id)).toEqual([
      "local-discovery",
      "problem-diagnosis",
      "service-comparison",
      "trust-proof",
      "pickup-logistics",
      "aftercare"
    ]);
    expect(playbook.ai_visibility_review_28d.checkpoints.map((checkpoint) => checkpoint.day)).toEqual([0, 7, 28]);
    expect(playbook.ai_visibility_review_28d.engines).toContain("chatgpt-search");
    expect(playbook.ai_visibility_review_28d.engines).toContain("grok-search");
    expect(playbook.community_practice_sources.some((source) => source.platform === "X")).toBe(true);
    expect(playbook.community_practice_sources.some((source) => source.platform === "GitHub")).toBe(true);
  });

  it("enforces one reach-answer and one evidence-conversion role on every day", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);

    for (const day of playbook.days) {
      expect(day.slots.map((slot) => slot.content_role), day.date).toEqual([
        "reach-answer",
        "evidence-conversion"
      ]);
    }
  });

  it("adds the unpublished four-image plus companion-video package from 2026-07-29 onward", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);
    const before = playbook.days.find((day) => day.date === "2026-07-28");
    const after = playbook.days.filter((day) => day.date >= "2026-07-29");

    expect(before?.slots.every((slot) => slot.media_package === undefined)).toBe(true);
    expect(after.length).toBeGreaterThan(0);
    for (const day of after) {
      for (const slot of day.slots) {
        expect(slot.media_package).toMatchObject({
          image_count: 4,
          companion_video_required: true,
          publish_authorized: false,
          included_in_kpi: false
        });
        expect(slot.video_candidate?.memory_hook.length).toBeGreaterThanOrEqual(6);
        // 10s floor since 2026-08-25 (owner: Reels at least 10 seconds);
        // dated specials written earlier legitimately carry 12.
        expect(slot.video_candidate?.duration_seconds).toBeGreaterThanOrEqual(10);
      }
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

  it("keeps final targets within reach of the measured rate and includes major poster nodes", () => {
    const playbook = buildGrowthPlaybook("2026-07-11", 90);
    const rows = flattenGrowthPlaybook(playbook);

    // The measured rate is 0.18 new followers a day. A closing target of 35,
    // as the plan originally carried, is sixty times that and makes every
    // reading on the dashboard meaningless. Reels are assumed to lift it to a
    // few a day at best, which for a single-city service account is good.
    expect(playbook.days.at(-1)?.daily_follower_target).toBeLessThanOrEqual(5);
    expect(playbook.days.at(-1)?.daily_views_target).toBeLessThanOrEqual(600);
    expect(playbook.days.at(-1)?.daily_follower_target).toBeGreaterThan(
      playbook.days[0]?.daily_follower_target ?? 0
    );
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
