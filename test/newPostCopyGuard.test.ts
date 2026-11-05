import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { dailySlotFromPlaybook, stampDailyContentWrite } from "../src/contentPlan";
import type { GrowthPlaybookSlot } from "../src/growthPlaybook";
import { publicSupportPages } from "../src/generatePublicSite";
import {
  APPROVED_FREE_PICKUP_PHRASE,
  assertNewPostCopyAllowed,
  newPostCopyViolations
} from "../src/newPostCopyGuard";
import { postCurrentSlot } from "../src/postCurrentSlot";

const NEW_DATE = "2026-11-05";
const OLD_DATE = "2026-10-08";
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

// CI 的 sparse-checkout 不含 docs/.well-known/。該檔已在 commit 裡改成包包發霉，測試只讀 CI 會拉下來的檔。
const LIVE_GUIDE_FILES = [
  "seo-overrides/guides/luxury-bag-mold.html",
  "docs/guides/luxury-bag-mold.html",
  "seo-overrides/answers.json",
  "seo-overrides/ai-discovery.json",
  "docs/answers.json",
  "docs/ai-discovery.json",
  "docs/knowledge-graph.json",
  "docs/geo-targets.json",
  "docs/services.json"
];

function playbookSlot(date: string, topic: string, lead: string): GrowthPlaybookSlot {
  const follow = "追蹤私享家，之後會持續整理送洗前的判斷。";
  const body = `${lead}\n\n${follow}\n\n私享家洗衣店\n\n#私享家洗衣店`;
  return {
    date,
    day: 1,
    slot: 1,
    time: "11:30",
    phase: "test",
    topic,
    format: "image-post",
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    content_role: "reach-answer",
    views_target: 1,
    follower_target: 1,
    hook: lead,
    follow_cta: follow,
    caption: body,
    hashtags: ["#私享家洗衣店"],
    image_or_reel_direction: "門市手機近拍",
    seo_sync_page: "/guides/luxury-bag-mold.html",
    search_intent: "problem-diagnosis",
    target_queries: [],
    evidence_type: "first-party-inspection",
    ten_day_review_metric: "line",
    facebook_caption: body,
    instagram_caption: body
  };
}

describe("新貼文措辭閘門", () => {
  it("除霉、標準以外的防水、標準以外的免費都會失敗", () => {
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, title: "包包除霉" })).toThrow(/除霉/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, body: "門市可以除霉" })).toThrow(/除霉/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, title: "靴子要不要先做防水" })).toThrow(/防水/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, body: "外層有防水塗層" })).toThrow(/防水/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, body: "只有防水透氣，沒有寫成品類全名" })).toThrow(/防水/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, title: "免費收送" })).toThrow(/免費/);
    expect(() => assertNewPostCopyAllowed({ date: NEW_DATE, body: "台中全市免費收送，沒有最低消費" })).toThrow(/免費/);
    expect(() =>
      assertNewPostCopyAllowed({ date: NEW_DATE, body: `${APPROVED_FREE_PICKUP_PHRASE}，另外免費試穿` })
    ).toThrow(/免費/);
    const titled = newPostCopyViolations({ date: NEW_DATE, title: "包包除霉" });
    expect(titled).toEqual([expect.objectContaining({ rule: "除霉", field: "title" })]);
  });

  it("改寫成發霉、防潑水、防水透氣鞋與核准免費句可以過", () => {
    expect(
      newPostCopyViolations({
        date: NEW_DATE,
        title: "包包發霉了先別擦",
        body: `表布防潑水還在。這雙是防水透氣鞋。${APPROVED_FREE_PICKUP_PHRASE}。`
      })
    ).toEqual([]);
    expect(() =>
      assertNewPostCopyAllowed({
        date: NEW_DATE,
        title: "精品包發霉",
        body: APPROVED_FREE_PICKUP_PHRASE
      })
    ).not.toThrow();
  });

  it("2026-11-05 以前的舊貼文不擋；沒有日期就擋", () => {
    expect(
      newPostCopyViolations({
        date: OLD_DATE,
        title: "靴子換季除霉",
        body: "先做防水。免費收送。"
      })
    ).toEqual([]);
    expect(() => assertNewPostCopyAllowed({ title: "包包除霉" })).toThrow(/除霉/);
  });

  it("產生器在新日期拒絕除霉標題，舊日期仍放行", () => {
    const config = getConfig({
      ...process.env,
      PUBLIC_SITE_BASE_URL: "https://example.invalid",
      PUBLIC_IMAGE_BASE_URL: "https://example.invalid"
    });
    expect(() => dailySlotFromPlaybook(playbookSlot(NEW_DATE, "包包除霉", "這則在承諾除霉。"), config)).toThrow(
      /除霉/
    );
    expect(() => dailySlotFromPlaybook(playbookSlot(OLD_DATE, "靴子換季除霉", "這則在承諾除霉。"), config)).not.toThrow();
    const allowed = dailySlotFromPlaybook(
      playbookSlot(NEW_DATE, "包包發霉了先別擦", `先看霉在表面還是吃進皮裡。${APPROVED_FREE_PICKUP_PHRASE}`),
      config
    );
    expect(allowed.topic).toBe("包包發霉了先別擦");
    expect(allowed.facebook_caption).toContain(APPROVED_FREE_PICKUP_PHRASE);
    expect(allowed.facebook_caption).not.toContain("除霉");
  });
});

describe("新貼文不能帶禁用措辭發出去", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "new-post-copy-"));
    process.env.PUBLIC_IMAGE_BASE_URL ||= "https://example.invalid";
    process.env.PUBLIC_SITE_BASE_URL ||= "https://example.invalid";
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seed(topic: string, caption: string): Promise<void> {
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    const slot = (n: number, text: string, title: string) => ({
      slot: n,
      time: n === 1 ? "11:30" : "20:30",
      topic: title,
      format: "image-post",
      media_type: "image" as const,
      instagram_caption: text,
      facebook_caption: text,
      local_image_path: `docs/assets/${NEW_DATE}/slot-0${n}.png`,
      image_prompt: "shop photo",
      visual_route: "shop-inspection" as const,
      traffic_route: "object-proof" as const,
      category: "知識文" as const,
      public_image_url: "https://example.invalid/slot.png",
      status: "pending" as const
    });
    await writeFile(
      join(root, "data", "content-calendar", `${NEW_DATE}.json`),
      JSON.stringify(
        stampDailyContentWrite(
          {
            date: NEW_DATE,
            timezone: "Asia/Taipei",
            generated_at: "2026-11-05T00:00:00.000Z",
            slots: [slot(1, caption, topic), slot(2, "填充檔，只用來湊滿一天。", "填充")]
          } as Parameters<typeof stampDailyContentWrite>[0],
          { root }
        )
      ),
      "utf8"
    );
  }

  it("2026-11-05 的貼文在進 Meta 前就被擋下", async () => {
    await seed("包包除霉", "這則正文在承諾除霉，而且寫了防水噴霧，也寫免費到府。");
    await expect(
      postCurrentSlot({ date: NEW_DATE, slot: 1, root, dryRun: true, now: new Date("2026-11-05T04:00:00.000Z") })
    ).rejects.toThrow(/禁用措辭/);
  });

  it("核准句不會被這道閘門擋下", async () => {
    await seed("包包發霉了先別擦", `先看霉在表面還是吃進皮裡。表布防潑水。防水透氣鞋另看材質。${APPROVED_FREE_PICKUP_PHRASE}`);
    await expect(
      postCurrentSlot({ date: NEW_DATE, slot: 1, root, dryRun: true, now: new Date("2026-11-05T04:00:00.000Z") })
    ).rejects.toThrow(/Image is missing/);
  });
});

describe("精品包發霉指南不再寫包包除霉", () => {
  it("override、已產生的 HTML 與產生器關鍵字都改成包包發霉", () => {
    for (const rel of LIVE_GUIDE_FILES) {
      const text = readFileSync(join(REPO, rel), "utf8");
      expect(text, rel).not.toContain("包包除霉");
      expect(text, rel).not.toContain("名牌包清潔 除霉");
    }
    for (const rel of ["seo-overrides/guides/luxury-bag-mold.html", "docs/guides/luxury-bag-mold.html"]) {
      const html = readFileSync(join(REPO, rel), "utf8");
      expect(html, rel).toContain('<span class="chip">包包發霉</span>');
      expect(html, rel).toContain("台中 精品包發霉 名牌包清潔 包包發霉");
      expect(html, rel).not.toMatch(/除霉/);
    }
    const page = publicSupportPages().find((item) => item.slug === "luxury-bag-mold");
    expect(page?.keywords).toContain("包包發霉");
    expect(page?.keywords.join("\n")).not.toContain("除霉");
    expect(page?.local_intent).toBe("台中 精品包發霉 名牌包清潔 包包發霉");
  });
});
