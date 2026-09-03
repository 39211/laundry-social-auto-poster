import { access, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  generatePublicSite,
  publicAcceptedIndexGrowthCount,
  publicSourceBaselineUrlCount,
  publicSupportPages
} from "../src/generatePublicSite";
import { canonicalSeoSyncPage, buildDailyContent } from "../src/contentPlan";
import { getConfig } from "../src/config";
import { guideLinkFor } from "../src/postYouTube";
import {
  INDEX_GROWTH_CATALOG,
  INDEX_GROWTH_REJECTED_CANDIDATES,
  PROTECTED_LIVE_COHORT_HASHES,
  PROTECTED_LIVE_COHORT_SLUGS,
  protectedSupportContentHash,
  resolveAcceptedIndexGrowthPages
} from "../src/indexGrowthPages";
import { PRODUCTION_PUBLIC_SITE_BASE_URL } from "../src/publicSiteTypes";
import {
  REQUIRED_SEARCH_CONTENT_EVENTS,
  assertSearchContentAnalyticsScript,
  buildSearchContentAnalyticsScript
} from "../src/searchContentAnalytics";

async function writeCalendar(root: string, date: string, options: { carouselSlot1?: boolean } = {}): Promise<void> {
  await Promise.all([
    mkdir(join(root, "data", "content-calendar"), { recursive: true }),
    mkdir(join(root, "docs", "content-calendar"), { recursive: true })
  ]);
  const calendar = `${JSON.stringify(
    {
      date,
      timezone: "Asia/Taipei",
      generated_at: `${date}T00:00:00.000Z`,
      slots: [
        {
          slot: 1,
          time: "11:30",
          category: "knowledge",
          topic: "Sneaker edge inspection",
          instagram_caption: "IG caption #test",
          facebook_caption: "FB caption #test",
          image_prompt: "photo prompt",
          ...(options.carouselSlot1
            ? {
                media_type: "carousel",
                carousel_items: [
                  {
                    slide: 3,
                    image_prompt: "slide 3 prompt",
                    local_image_path: `docs/assets/${date}/slot-01-slide-03.png`,
                    public_image_url: ""
                  },
                  {
                    slide: 1,
                    image_prompt: "slide 1 prompt",
                    local_image_path: `docs/assets/${date}/slot-01.png`,
                    public_image_url: ""
                  },
                  {
                    slide: 2,
                    image_prompt: "slide 2 prompt",
                    local_image_path: `docs/assets/${date}/slot-01-slide-02.png`,
                    public_image_url: ""
                  }
                ]
              }
            : {}),
          visual_route: "shop-inspection",
          traffic_route: "object-proof",
          search_intent: "problem-diagnosis",
          target_queries: ["台中洗鞋店", "白鞋泛黃怎麼辦"],
          evidence_type: "first-party-inspection",
          local_image_path: `docs/assets/${date}/slot-01.png`,
          public_image_url: "",
          status: "pending"
        },
        {
          slot: 2,
          time: "19:30",
          category: "situation",
          topic: "Bag corner care",
          instagram_caption: "IG caption 2 #test",
          facebook_caption: "FB caption 2 #test",
          image_prompt: "photo prompt 2",
          visual_route: "macro-detail",
          traffic_route: "value-prop-lead",
          search_intent: "trust-proof",
          target_queries: ["台中洗包包", "洗包包會不會掉色"],
          evidence_type: "real-case-photo",
          local_image_path: `docs/assets/${date}/slot-02.png`,
          public_image_url: "",
          status: "pending"
        }
      ]
    },
    null,
    2
  )}\n`;

  await Promise.all([
    writeFile(join(root, "data", "content-calendar", `${date}.json`), calendar, "utf8"),
    writeFile(join(root, "docs", "content-calendar", `${date}.json`), calendar, "utf8")
  ]);
}

async function writeApprovalLog(root: string, date: string, slots = [1, 2]): Promise<void> {
  await mkdir(join(root, "data", "approved-log"), { recursive: true });
  const entries = slots.flatMap((slot) =>
    (["facebook", "instagram"] as const).map((platform) => ({
      date,
      slot,
      platform,
      status: "approved",
      approved_by: "Test",
      note: "Approved for public SEO sync",
      created_at: `${date}T02:20:00.000Z`
    }))
  );

  await writeFile(join(root, "data", "approved-log", `${date}.json`), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeBusinessProfile(root: string): Promise<void> {
  await mkdir(join(root, "data"), { recursive: true });
  const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
  await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
}

/** Same algorithm as src/indexingPush.ts textLength; keep in lockstep if that helper moves. */
function pageTextLength(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return stripped.replace(/\s+/g, "").length;
}

function jsonLdGraphs(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].flatMap((match) => {
    const parsed = JSON.parse(match[1] ?? "{}") as { "@graph"?: Array<Record<string, unknown>> };
    return parsed["@graph"] ?? [];
  });
}

/** Canonical copy of contentPlan.ts PRICE_LINES / the SXJ-PRICE-PAGE contract. Independent of the generator. */
const CANONICAL_PRICE_TABLES = [
  {
    heading: "鞋類",
    id: "price-table-shoes",
    rows: [
      ["一般運動鞋", "$250(水洗價)"],
      ["皮類運動鞋", "$300(水洗價)"],
      ["休閒鞋", "$350(水洗價)"],
      ["麂皮鞋", "$400(水洗價)"],
      ["皮鞋", "$400(水洗價)"],
      ["低靴", "$350(水洗價)"],
      ["高靴", "$550(水洗價)"]
    ]
  },
  {
    heading: "包類",
    id: "price-table-bags",
    rows: [
      ["背包清洗", "$500(水洗價)"],
      ["一般包", "$600(水洗價)"],
      ["皮包", "$1000(水洗價)"],
      ["名牌包", "$1500 起(水洗價)"],
      ["特殊類名牌包", "$2500(水洗價)"]
    ]
  },
  {
    heading: "衣物寢具",
    id: "price-table-clothing",
    rows: [
      ["襯衫", "$70(水洗價)"],
      ["整燙", "$50"],
      ["長褲", "$70 / 短褲 $60(水洗價)"],
      ["西裝背心", "$80(水洗價)"],
      ["長大衣", "$300(水洗價，乾洗另計)"],
      ["羽絨外套", "$280(水洗價)"],
      ["皮衣", "$1200 / 特殊皮衣 $2000(發霉另計)"],
      ["棉被單人", "$350 / 雙人 $500(水洗價)"],
      ["床組四件套", "$300(水洗價)"],
      ["羽絨羊毛被", "$800(水洗價)"],
      ["窗簾、地毯", "依尺寸報價，LINE 傳照片先估"],
      ["絨毛娃娃", "依大小報價，LINE 傳照片先估"]
    ]
  }
] as const;

const PRICE_LIST_DISCLAIMER =
  "水洗價，乾洗柔洗另計；發霉、特殊污漬與特殊材質另行報價，以實際檢視為準";

function tableRows(html: string, tableId: string): Array<[string, string]> {
  const tableMatch = html.match(new RegExp(`<table class="comparison-table" id="${tableId}">([\\s\\S]*?)</table>`, "u"));
  if (!tableMatch) return [];
  return [...(tableMatch[1] ?? "").matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gu)].map(
    (match) => [(match[1] ?? "").replace(/<[^>]+>/g, "").trim(), (match[2] ?? "").replace(/<[^>]+>/g, "").trim()]
  );
}

function jsonLdTypes(html: string): string[] {
  const types: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") types.push(type);
    else if (Array.isArray(type)) types.push(...type.filter((item): item is string => typeof item === "string"));
    Object.values(record).forEach(walk);
  };
  jsonLdGraphs(html).forEach(walk);
  return types;
}

function visiblePageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function firstAnswerParagraph(answer: string): string {
  return (answer.split(/\n+/)[0] ?? "").trim();
}

function articleBodyHtml(html: string): string {
  const main = html.match(/<main\b[\s\S]*<\/main>/i)?.[0] ?? "";
  return main
    .replace(/<header\b[\s\S]*?<\/header>/gi, "")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, "");
}

function thematicAnchorsTo(html: string, hrefNeedle: string): string[] {
  const withoutNav = html.replace(/<nav class="nav"[\s\S]*?<\/nav>/gi, "");
  return [...withoutNav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((match) => (match[1] ?? "").includes(hrefNeedle))
    .map((match) => (match[2] ?? "").replace(/<[^>]+>/g, "").trim());
}

function bodyAnchorsTo(html: string, hrefNeedle: string): string[] {
  return thematicAnchorsTo(articleBodyHtml(html), hrefNeedle);
}

function sitemapLocs(sitemap: string): string[] {
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "");
}

function pathFromUrl(url: string, baseUrl: string): string {
  const prefix = `${baseUrl.replace(/\/+$/u, "")}/`;
  if (url === `${baseUrl.replace(/\/+$/u, "")}/` || url === baseUrl) return "/";
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

async function pngPixelSize(filePath: string): Promise<{ width: number; height: number }> {
  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (bytesRead !== 24 || header.readUInt32BE(12) !== 0x49484452) {
      throw new Error(`invalid PNG header: ${filePath}`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

describe("generatePublicSite", () => {
  it("writes AI-readable public indexes with absolute URLs when a base URL is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02", { carouselSlot1: true });
    await writeApprovalLog(root, "2026-07-02");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const businessProfile = JSON.parse(await readFile(join(root, "docs", "business-profile.json"), "utf8"));
    const latest = JSON.parse(await readFile(join(root, "docs", "latest.json"), "utf8"));
    const services = JSON.parse(await readFile(join(root, "docs", "services.json"), "utf8"));
    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8"));
    const geoTargets = JSON.parse(await readFile(join(root, "docs", "geo-targets.json"), "utf8"));
    const searchVisibility = JSON.parse(await readFile(join(root, "docs", "search-visibility.json"), "utf8"));
    const feed = JSON.parse(await readFile(join(root, "docs", "feed.json"), "utf8"));
    const knowledgeGraph = JSON.parse(await readFile(join(root, "docs", "knowledge-graph.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const wellKnownAi = JSON.parse(await readFile(join(root, "docs", ".well-known", "ai.json"), "utf8"));
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const llmsLite = await readFile(join(root, "docs", "llms-lite.txt"), "utf8");
    const llmsFull = await readFile(join(root, "docs", "llms-full.txt"), "utf8");
    const llmsJsonl = await readFile(join(root, "docs", "llms.jsonl"), "utf8");
    const wellKnownLlms = await readFile(join(root, "docs", ".well-known", "llms.txt"), "utf8");
    const robots = await readFile(join(root, "docs", "robots.txt"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");
    const firstPostHtml = await readFile(join(root, "docs", "posts", "2026-07-02-slot-01.html"), "utf8");
    const html = await readFile(join(root, "docs", "index.html"), "utf8");
    const notFoundHtml = await readFile(join(root, "docs", "404.html"), "utf8");
    const compatibilityDocsHtml = await readFile(join(root, "docs", "docs", "index.html"), "utf8");
    const shoeBagCareHtml = await readFile(join(root, "docs", "services", "shoe-bag-care.html"), "utf8");
    const whiteShoeCleaningHtml = await readFile(join(root, "docs", "services", "white-shoe-cleaning.html"), "utf8");
    const fabricStorageHtml = await readFile(join(root, "docs", "services", "fabric-storage.html"), "utf8");
    const taichungXitunLaundryHtml = await readFile(
      join(root, "docs", "services", "taichung-xitun-laundry.html"),
      "utf8"
    );
    const taichungCitywidePickupHtml = await readFile(
      join(root, "docs", "services", "taichung-citywide-laundry-pickup.html"),
      "utf8"
    );

    expect(index.base_url_configured).toBe(true);
    expect(index.canonical_url).toBe("https://example.com/laundry-social-auto-poster/");
    expect(index.open_graph).toMatchObject({
      title: "私享家洗衣店｜台中免費收送・逢甲洗鞋・西屯洗鞋",
      type: "website",
      url: "https://example.com/laundry-social-auto-poster/",
      site_name: "私享家洗衣店",
      image: "https://example.com/laundry-social-auto-poster/assets/services/fabric-storage-hero-product.png",
      image_alt: "外套、寢具與布品收納前產品級檢查主圖｜私享家洗衣店",
      locale: "zh_TW"
    });
    expect(index.posts).toHaveLength(2);
    expect(index.article_posts).toHaveLength(2);
    expect(index.posts[0].article_url).toBe("https://example.com/laundry-social-auto-poster/posts/2026-07-02-slot-01.html");
    expect(index.entrypoints.llms_lite).toBe("https://example.com/laundry-social-auto-poster/llms-lite.txt");
    expect(index.entrypoints.llms_full).toBe("https://example.com/laundry-social-auto-poster/llms-full.txt");
    expect(index.entrypoints.feed).toBe("https://example.com/laundry-social-auto-poster/feed.json");
    expect(index.entrypoints.business_profile).toBe("https://example.com/laundry-social-auto-poster/business-profile.json");
    expect(index.entrypoints.services).toBe("https://example.com/laundry-social-auto-poster/services.json");
    expect(index.entrypoints.answers).toBe("https://example.com/laundry-social-auto-poster/answers.json");
    expect(index.entrypoints.geo_targets).toBe("https://example.com/laundry-social-auto-poster/geo-targets.json");
    expect(index.entrypoints.search_visibility).toBe(
      "https://example.com/laundry-social-auto-poster/search-visibility.json"
    );
    expect(index.entrypoints.llms_jsonl).toBe("https://example.com/laundry-social-auto-poster/llms.jsonl");
    expect(index.entrypoints.service_pages).toEqual({
      "shoe-bag-care": "https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html",
      "white-shoe-cleaning": "https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html",
      "fabric-storage": "https://example.com/laundry-social-auto-poster/services/fabric-storage.html",
      "taichung-xitun-laundry": "https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html",
      "business-bulk-laundry":
        "https://example.com/laundry-social-auto-poster/services/business-bulk-laundry.html",
      "taichung-citywide-laundry-pickup":
        "https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html",
      "taichung-laundry-price-list":
        "https://example.com/laundry-social-auto-poster/services/taichung-laundry-price-list.html"
    });
    expect(index.entrypoints.knowledge_graph).toBe("https://example.com/laundry-social-auto-poster/knowledge-graph.json");
    expect(index.entrypoints.well_known_ai).toBe("https://example.com/laundry-social-auto-poster/.well-known/ai.json");
    expect(notFoundHtml).toContain('name="robots" content="noindex, follow"');
    expect(notFoundHtml).toContain('http-equiv="refresh" content="0; url=https://example.com/laundry-social-auto-poster/"');
    expect(notFoundHtml).toContain('window.location.replace("https://example.com/laundry-social-auto-poster/")');
    expect(compatibilityDocsHtml).toContain('http-equiv="refresh" content="0; url=https://example.com/laundry-social-auto-poster/"');
    expect(index.posts[0].image_url).toBe("https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01.png");
    expect(index.posts[0].image_urls).toEqual([
      "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01.png",
      "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01-slide-02.png",
      "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01-slide-03.png"
    ]);
    expect(index.posts[0].carousel_items).toEqual([
      {
        slide: 1,
        image_prompt: "slide 1 prompt",
        local_image_path: "docs/assets/2026-07-02/slot-01.png",
        public_image_url: "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01.png"
      },
      {
        slide: 2,
        image_prompt: "slide 2 prompt",
        local_image_path: "docs/assets/2026-07-02/slot-01-slide-02.png",
        public_image_url: "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01-slide-02.png"
      },
      {
        slide: 3,
        image_prompt: "slide 3 prompt",
        local_image_path: "docs/assets/2026-07-02/slot-01-slide-03.png",
        public_image_url: "https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01-slide-03.png"
      }
    ]);
    expect(latest.posts[0].carousel_items).toEqual(index.posts[0].carousel_items);
    expect(discovery.latest_posts.find((post: { slot: number }) => post.slot === 1).carousel_items).toEqual(
      index.posts[0].carousel_items
    );
    const socialPostRecord = llmsJsonl
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((record) => record.type === "social_post" && record.id.endsWith("#post-2026-07-02-slot-01"));
    expect(socialPostRecord.carousel_items).toEqual(index.posts[0].carousel_items);
    expect(index.posts[0].hashtags).toEqual(["#test"]);
    expect(index.posts[0]).toMatchObject({
      id: "https://example.com/laundry-social-auto-poster/content-calendar/2026-07-02.json#post-2026-07-02-slot-01",
      date_published: "2026-07-02T11:30:00+08:00",
      platforms: ["facebook", "instagram"],
      in_language: "zh-Hant",
      search_intent: "problem-diagnosis",
      target_queries: ["台中洗鞋店", "白鞋泛黃怎麼辦"],
      evidence_type: "first-party-inspection"
    });
    expect(socialPostRecord).toMatchObject({
      search_intent: "problem-diagnosis",
      target_queries: ["台中洗鞋店", "白鞋泛黃怎麼辦"],
      evidence_type: "first-party-inspection"
    });
    expect(latest.canonical_url).toBe("https://example.com/laundry-social-auto-poster/");
    expect(latest.date).toBe("2026-07-02");
    expect(latest.posts[0].hashtags).toEqual(["#test"]);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.title).toBe("私享家洗衣店｜台中免費收送・逢甲洗鞋・西屯洗鞋");
    expect(feed.items[0].tags).toEqual(["test"]);
    expect(businessProfile.line_url).toBe("https://line.me/ti/p/4m-rA6hxf6");
    expect(businessProfile.google_maps_cid).toBe("0x41f4295a6302e177");
    expect(knowledgeGraph["@graph"].some((item: { "@type"?: string }) => item["@type"] === "Dataset")).toBe(true);
    expect(knowledgeGraph["@graph"].some((item: { "@type"?: string }) => item["@type"] === "SocialMediaPosting")).toBe(true);
    expect(knowledgeGraph["@graph"].some((item: { "@type"?: string; name?: string }) => item["@type"] === "Service" && item.name === "布品收納")).toBe(true);
    const knowledgeDataset = knowledgeGraph["@graph"].find(
      (item: { "@type"?: string }) => item["@type"] === "Dataset"
    );
    expect(knowledgeDataset.dateModified).toBe("2026-07-02");
    expect(knowledgeDataset.dateModified).not.toBe(index.generated_at);
    const knowledgeBusiness = knowledgeGraph["@graph"].find(
      (item: { "@type"?: string }) => item["@type"] === "DryCleaningOrLaundry"
    );
    expect(knowledgeBusiness["@context"]).toBeUndefined();
    expect(services.services).toHaveLength(7);
    expect(services.services[2]).toMatchObject({
      slug: "fabric-storage",
      image_url: "https://example.com/laundry-social-auto-poster/assets/services/fabric-storage-hero-product.png",
      image_alt: "外套、寢具與布品收納前檢查主圖",
      image_source_type: "generated-product-image",
      image_source_note: "ai-generated premium product hero image",
      source_post_id: "",
      answer_summary: "台中西屯布品收納建議先確認衣物、外套、寢具、被套與厚棉布品是否乾燥，有無汗味、悶味、黃痕或局部髒污，再決定是否清潔後收納。",
      case_story: {
        label: "換季前的布品與衣物檢查"
      }
    });
    expect(answers.answers.some((item: { question: string }) => item.question === "台中西屯布品收納要怎麼判斷？")).toBe(true);
    expect(answers.answers.some((item: { question: string }) => item.question === "台中西屯洗衣店要怎麼判斷？")).toBe(true);
    expect(
      answers.answers.some((item: { question: string }) => item.question === "搜尋台中西屯洗衣店時，私享家洗衣店提供哪些服務？")
    ).toBe(true);
    expect(answers.answers.some((item: { question: string }) => item.question === "私享家洗衣店可以處理哪些物件？")).toBe(true);
    expect(geoTargets.primary_local_queries.some((item: { query: string }) => item.query === "洗衣店")).toBe(true);
    expect(geoTargets.primary_local_queries.some((item: { query: string }) => item.query === "台中西屯洗衣店")).toBe(true);
    expect(geoTargets.primary_local_queries.some((item: { query: string }) => item.query === "青海路洗衣店")).toBe(true);
    expect(geoTargets.local_intents.some((item: { query: string }) => item.query === "台中西屯 布品收納")).toBe(true);
    expect(geoTargets.local_intents.some((item: { query: string }) => item.query === "台中西屯 洗衣店")).toBe(true);
    expect(geoTargets.discovery_groups.some((group: { heading: string }) => group.heading === "依情境找服務")).toBe(true);
    expect(searchVisibility.query_clusters.map((cluster: { id: string }) => cluster.id)).toEqual([
      "local-discovery",
      "problem-diagnosis",
      "service-comparison",
      "trust-proof",
      "pickup-logistics",
      "aftercare"
    ]);
    expect(searchVisibility.prompt_panel.unbranded_customer_queries).toHaveLength(18);
    expect(searchVisibility.review_28_days.checkpoints.map((item: { day: number }) => item.day)).toEqual([0, 7, 28]);
    expect(searchVisibility.review_28_days.metrics.map((item: { id: string }) => item.id)).toContain(
      "linked_citation"
    );
    expect(
      searchVisibility.community_practice_sources.some((source: { platform: string }) => source.platform === "X")
    ).toBe(true);
    expect(llmsJsonl.split(/\r?\n/).filter(Boolean).some((line) => JSON.parse(line).type === "service")).toBe(true);
    expect(discovery.entrypoints.social_posts).toBe("https://example.com/laundry-social-auto-poster/social-posts.json");
    expect(discovery.website.url).toBe("https://example.com/laundry-social-auto-poster/");
    expect(discovery.open_graph.site_name).toBe("私享家洗衣店");
    expect(discovery.local_search_targets.primary_queries).toContain("台中西屯洗衣店");
    expect(discovery.local_search_targets.primary_queries).toContain("青海路洗衣店");
    expect(discovery.structured_data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "DryCleaningOrLaundry",
      "@id": "https://example.com/laundry-social-auto-poster/#business",
      name: "私享家洗衣店",
      alternateName: ["私享家 旗艦總店", "私享家 旗艦店", "私享家精品洗護"],
      url: "https://example.com/laundry-social-auto-poster/",
      telephone: "+886-4-2452-7411",
      hasMap: "https://maps.app.goo.gl/kUREPkWDXYNTkpct7",
      // Entity consolidation: every owned profile, so the site, Maps listing,
      // YouTube channel and socials read as one business.
      sameAs: [
        "https://www.facebook.com/100083194756904/",
        "https://www.instagram.com/si_xiang_jia/",
        "https://www.youtube.com/channel/UCcVDFN7Ve-cD9duxRdM5VXQ",
        "https://maps.app.goo.gl/kUREPkWDXYNTkpct7"
      ],
      openingHours: ["Mo-Fr 10:00-20:00", "Sa 12:00-18:00"],
      address: {
        "@type": "PostalAddress",
        postalCode: "407",
        addressRegion: "臺中市",
        addressLocality: "西屯區",
        streetAddress: "至善里青海路二段365號",
        addressCountry: "TW"
      }
    });
    expect(discovery.structured_data.identifier).toEqual([
      {
        "@type": "PropertyValue",
        propertyID: "Google Maps CID",
        value: "0x41f4295a6302e177"
      }
    ]);
    expect(discovery.structured_data.specialOpeningHoursSpecification).toBeUndefined();
    expect(discovery.structured_data.contactPoint).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ areaServed: { "@type": "AdministrativeArea", name: "台中市" } })
      ])
    );
    expect(discovery.structured_data.areaServed).not.toContainEqual(
      expect.objectContaining({ "@type": "Country", name: "Taiwan" })
    );
    expect(discovery.website.map_url).toBe("https://maps.app.goo.gl/kUREPkWDXYNTkpct7");
    expect(discovery.website.google_maps_feature_id).toBe("0x34691713872dd6f5:0x41f4295a6302e177");
    expect(discovery.website.google_maps_cid).toBe("0x41f4295a6302e177");
    expect(discovery.website.google_place_id).toBeNull();
    expect(discovery.website.facebook_url).toBe("https://www.facebook.com/100083194756904/");
    expect(discovery.website.facebook_share_url).toBe("https://www.facebook.com/share/1BZF4VnihJ/");
    expect(discovery.website.instagram_url).toBe("https://www.instagram.com/si_xiang_jia/");
    expect(discovery.website.line_url).toBe("https://line.me/ti/p/4m-rA6hxf6");
    expect(discovery.business_profile).toMatchObject({
      google_business_profile_name: "私享家 旗艦總店",
      address_text: "407 臺中市西屯區至善里青海路二段365號",
      google_maps_cid: "0x41f4295a6302e177",
      google_place_id: null,
      line_url: "https://line.me/ti/p/4m-rA6hxf6",
      line_id: "0968327653",
      telephone_local: "04-2452-7411",
      mobile_or_line_local: "0968-327-653",
      opening_hours_text: "週一至週五 10:00-20:00；週六 12:00-18:00；週日公休",
      holiday_hours_rule: {
        major_holidays: ["農曆春節", "端午節", "中秋節", "母親節", "父親節"],
        overrides: []
      },
      verification_status: {
        google_place_id: "not_verified_public_maps_url_exposes_feature_id_only",
        official_line_url: "public_facebook_instagram_search_result_cross_check",
        holiday_hours_overrides: "not_configured"
      }
    });
    expect(discovery.content_contract.omitted_until_verified).toEqual(["google_place_id", "holiday_hours_overrides"]);
    expect(discovery.capabilities.supports_full_context).toBe(true);
    expect(discovery.capabilities.supports_search_intent_clusters).toBe(true);
    expect(discovery.capabilities.supports_28_day_ai_visibility_review).toBe(true);
    expect(discovery.service_pages).toHaveLength(7);
    expect(discovery.service_pages[0]).toMatchObject({
      slug: "shoe-bag-care",
      name: "鞋包清潔",
      url: "https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html",
      answer_summary: "逢甲與西屯需要洗鞋，可先把鞋面、鞋底、鞋內與材質照片傳 LINE；私享家門市在青海路二段365號，會先說明清潔方式與可改善範圍，台中市可免費收送。",
      image_url: "https://example.com/laundry-social-auto-poster/assets/services/shoe-bag-care-hero-product.png",
      image_alt: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
      faq_count: 6
    });
    expect(discovery.data_quality.all_posts_have_hashtags).toBe(true);
    expect(discovery.latest_posts[0].hashtags).toEqual(["#test"]);
    expect(wellKnownAi).toEqual(discovery);
    expect(llms).toContain("[Full structured post feed](https://example.com/laundry-social-auto-poster/social-posts.json)");
    expect(llms).toContain("[Business profile](https://example.com/laundry-social-auto-poster/business-profile.json)");
    expect(llms).toContain("[Services JSON](https://example.com/laundry-social-auto-poster/services.json)");
    expect(llms).toContain("[Answers JSON](https://example.com/laundry-social-auto-poster/answers.json)");
    expect(llms).toContain("[Geo targets JSON](https://example.com/laundry-social-auto-poster/geo-targets.json)");
    expect(llms).toContain(
      "[Search visibility JSON](https://example.com/laundry-social-auto-poster/search-visibility.json)"
    );
    expect(llms).toContain("[LLMS JSONL](https://example.com/laundry-social-auto-poster/llms.jsonl)");
    expect(llms).toContain("[鞋包清潔](https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html)");
    expect(llms).toContain("[白鞋清潔](https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html)");
    expect(llms).toContain("[布品收納](https://example.com/laundry-social-auto-poster/services/fabric-storage.html)");
    expect(llms).toContain("[台中西屯洗衣店](https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html)");
    expect(llms).toContain(
      "[台中全市免費洗衣收送](https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html)"
    );
    expect(llms).toContain("Address: 407 臺中市西屯區至善里青海路二段365號");
    expect(llms).toContain("Phone: 04-2452-7411");
    expect(llms).toContain("LINE / mobile estimates: 0968-327-653");
    expect(llms).toContain("LINE: https://line.me/ti/p/4m-rA6hxf6");
    expect(llms).toContain("Google Maps CID: 0x41f4295a6302e177");
    expect(llms).toContain("Google Place ID: (not verified)");
    expect(llms).toContain("Holiday hours rule:");
    expect(llms).toContain("Opening hours: 週一至週五 10:00-20:00；週六 12:00-18:00；週日公休");
    expect(llms).toContain("hashtags: #test");
    expect(llmsLite).toContain("Full context: https://example.com/laundry-social-auto-poster/llms-full.txt");
    expect(llmsFull).toContain("## Business Entity");
    expect(llmsFull).toContain("Facebook caption:");
    expect(wellKnownLlms).toBe(llms);
    expect(robots).toContain("User-agent: GPTBot");
    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(robots).toContain("User-agent: ChatGPT-User");
    expect(robots).toContain("User-agent: Claude-Web");
    // `Allow: /` covers every path; per-file Allow lines are redundant and were removed.
    expect(robots).not.toContain("Allow: /services.json");
    expect(robots).not.toContain("Allow: /llms.jsonl");
    expect(robots).not.toContain("Disallow:");
    expect(robots).toContain("Sitemap: https://example.com/laundry-social-auto-poster/sitemap.xml");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/fabric-storage.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html</loc>");
    expect(sitemap).toContain(
      "<loc>https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html</loc>"
    );
    // Thin near-duplicate caption pages stay published but out of the indexable surface.
    expect(sitemap).not.toContain("/posts/");
    expect(firstPostHtml).toContain('name="robots" content="noindex, follow, max-image-preview:large"');
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(shoeBagCareHtml).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(sitemap).not.toContain("<priority>");
    expect(sitemap).not.toContain("<changefreq>");
    expect(sitemap).not.toContain("index.html");
    expect(sitemap).not.toContain(".json");
    expect(sitemap).not.toContain("llms");
    expect(sitemap).not.toContain("/assets/");
    expect(aiSitemap).toContain("<!-- answer-engine-records -->");
    expect(aiSitemap).toContain("<!-- search-intent-and-ai-visibility-review -->");
    expect(aiSitemap).toContain("<!-- calendar-slot-1 -->");
    expect(aiSitemap).not.toContain("<!-- published-post-1 -->");
    expect(aiSitemap).toContain("<!-- service-image-generated-product-image -->");
    expect(aiSitemap).toContain("<!-- full-context -->");
    expect(aiSitemap).toContain("<!-- business-profile -->");
    expect(aiSitemap).toContain("<!-- service-records -->");
    expect(aiSitemap).toContain("<!-- answer-engine-records -->");
    expect(aiSitemap).toContain("<!-- geo-target-records -->");
    expect(aiSitemap).toContain("<!-- line-delimited-ai-records -->");
    expect(aiSitemap).toContain("<!-- service-page-shoe-bag-care -->");
    expect(aiSitemap).toContain("<!-- service-page-white-shoe-cleaning -->");
    expect(aiSitemap).toContain("<!-- service-page-fabric-storage -->");
    expect(aiSitemap).toContain("<!-- service-page-taichung-xitun-laundry -->");
    expect(aiSitemap).toContain("<!-- service-page-taichung-citywide-laundry-pickup -->");
    expect(aiSitemap).toContain("<!-- service-image-generated-product-image -->");
    expect(aiSitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/knowledge-graph.json</loc>");
    expect(html).toContain('<link rel="canonical" href="https://example.com/laundry-social-auto-poster/"');
    expect(html).toContain('<title>私享家洗衣店｜台中免費收送・逢甲洗鞋・西屯洗鞋</title>');
    expect(html).toContain('name="description" content="找台中免費收送、逢甲洗鞋或西屯洗鞋？');
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain('hreflang="zh-Hant-TW"');
    expect(html).toContain('property="og:title" content="私享家洗衣店｜台中免費收送・逢甲洗鞋・西屯洗鞋"');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('property="og:url" content="https://example.com/laundry-social-auto-poster/"');
    expect(html).toContain('property="og:image" content="https://example.com/laundry-social-auto-poster/assets/services/fabric-storage-hero-product.png"');
    expect(html).toContain('property="og:image:alt" content="外套、寢具與布品收納前產品級檢查主圖｜私享家洗衣店"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('"@type":"WebPage"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"ItemList"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"hasPart":[{"@id":"https://example.com/laundry-social-auto-poster/#homepage-faq"}');
    expect(html).toContain('"@type":"DryCleaningOrLaundry"');
    expect(html).toContain("<h1>台中免費收送，逢甲・西屯洗鞋先看材質</h1>");
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html"');
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html"');
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/services/fabric-storage.html"');
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html"');
    expect(html).toContain(
      'href="https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html"'
    );
    expect(html).toContain("<img ");
    expect(html).toContain("assets/services/fabric-storage-hero-product.png");
    expect(html).toContain('class="service-card-image"');
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/posts/2026-07-02-slot-01.html"');
    expect(firstPostHtml).toContain('rel="canonical" href="https://example.com/laundry-social-auto-poster/posts/2026-07-02-slot-01.html"');
    expect(firstPostHtml).toContain('"@type":"BlogPosting"');
    expect(firstPostHtml).toContain('"@type":"BreadcrumbList"');
    expect(firstPostHtml).toContain('class="breadcrumb"');
    expect(firstPostHtml).toContain("客人常用查詢");
    expect(firstPostHtml).toContain("白鞋泛黃怎麼辦");
    expect(html).toContain("depth-band depth-laundry");
    expect(html).toContain("depth-band depth-shoe-bag");
    expect(html).toContain("depth-band depth-white-shoe");
    expect(html).toContain("depth-band depth-fabric");
    expect(html).toContain("depth-band depth-local-store");
    expect(html).toContain('url("assets/backgrounds/premium-laundry-depth.png")');
    expect(html).toContain('url("assets/backgrounds/shoe-bag-care-depth.png")');
    expect(html).toContain('url("assets/backgrounds/white-shoe-depth.png")');
    expect(html).toContain('url("assets/backgrounds/fabric-storage-depth.png")');
    expect(html).toContain('url("assets/backgrounds/local-store-depth.png")');
    expect(html).toContain("外套、寢具與布品收納前產品級檢查主圖 - 私享家洗衣店布品收納檢查示意圖");
    expect(html).toContain("04-2452-7411");
    expect(html).toContain("0968-327-653");
    expect(html).toContain("https://line.me/ti/p/4m-rA6hxf6");
    expect(html).toContain("節日營業");
    expect(html).toContain("搜尋洗衣店時，讓地區和服務都說清楚。");
    expect(html).toContain("台中西屯洗衣店");
    expect(html).toContain("青海路洗衣店");
    expect(html).toContain("台中西屯洗包");
    expect(html).toContain("週一至週五 10:00-20:00");
    expect(html).toContain("依需求找到服務");
    expect(html).toContain('class="section-header section-header-bottom"');
    expect(html.indexOf('class="discovery-grid"')).toBeLessThan(html.indexOf('class="section-header section-header-bottom"'));
    expect(html).toContain("依物件找服務");
    expect(html).toContain("依地區找服務");
    expect(html).toContain("台中西屯洗衣店");
    expect(html).toContain("雨季通勤後");
    expect(html).toContain("為什麼選私享家");
    expect(html).toContain("不捏造保證與評論");
    expect(html).toContain("送洗前流程");
    expect(html).toContain("送洗前要拍哪裡？");
    expect(html).toContain('rel="llms"');
    expect(html).toContain('href="social-posts.json"');
    expect(html).toContain('href="business-profile.json"');
    expect(html).toContain(">店家資料</a>");
    expect(html).toContain('href="services.json"');
    expect(html).toContain('href="answers.json"');
    expect(html).toContain('href="geo-targets.json"');
    expect(html).toContain('href="llms.jsonl"');
    expect(html).toContain('href="knowledge-graph.json"');
    expect(html).toContain('href=".well-known/ai.json"');
    expect(html).toContain('class="machine-details"');
    expect(html).toContain('class="caption-details"');
    expect(shoeBagCareHtml).toContain("<title>逢甲洗鞋・西屯洗鞋｜鞋包清潔先看材質｜私享家洗衣店</title>");
    expect(shoeBagCareHtml).toContain("<h1>逢甲洗鞋・西屯洗鞋</h1>");
    expect(shoeBagCareHtml).toContain(">店家資料</a>");
    expect(shoeBagCareHtml).toContain("店家資訊");
    expect(shoeBagCareHtml).toContain("常見問題");
    expect(shoeBagCareHtml).toContain("逢甲與西屯需要洗鞋，可先把鞋面、鞋底、鞋內與材質照片傳 LINE");
    expect(shoeBagCareHtml).toContain("雨季通勤後的鞋包狀況");
    expect(shoeBagCareHtml).toContain("不是特定客戶成果，也不代表效果保證");
    expect(shoeBagCareHtml).toContain("材質與風險判斷");
    expect(shoeBagCareHtml).toContain("處理前要先說清楚");
    expect(shoeBagCareHtml).toContain('"@type":"FAQPage"');
    expect(shoeBagCareHtml).toContain('"@type":"Service"');
    expect(shoeBagCareHtml).toContain('"@type":"DryCleaningOrLaundry"');
    expect(shoeBagCareHtml).toContain("相關送洗指南");
    expect(shoeBagCareHtml).toContain("guides/rainy-shoe-care.html");
    expect(shoeBagCareHtml).toContain('class="breadcrumb"');
    expect(shoeBagCareHtml).toContain("https://example.com/laundry-social-auto-poster/assets/services/shoe-bag-care-hero-product.png");
    expect(shoeBagCareHtml).toContain("鞋包清潔前的包角、鞋面與皮革檢查主圖");
    expect(shoeBagCareHtml).toContain("AI 生成的高擬真產品風格主圖");
    expect(whiteShoeCleaningHtml).toContain("<title>白鞋清潔｜台中西屯白鞋泛黃、鞋邊與內裡整理｜私享家洗衣店</title>");
    expect(whiteShoeCleaningHtml).toContain("<h1>白鞋清潔</h1>");
    expect(whiteShoeCleaningHtml).toContain("白鞋泛黃可以完全變回全新嗎？");
    expect(whiteShoeCleaningHtml).toContain("膠邊氧化");
    expect(whiteShoeCleaningHtml).toContain(
      "https://example.com/laundry-social-auto-poster/assets/services/white-shoe-cleaning-hero-product.png"
    );
    expect(whiteShoeCleaningHtml).toContain("白鞋清潔前的鞋邊、縫線與內裡檢查主圖");
    expect(whiteShoeCleaningHtml).toContain("AI 生成的高擬真產品風格主圖");
    expect(fabricStorageHtml).toContain("<title>布品收納｜台中西屯換季衣物、外套與寢具整理｜私享家洗衣店</title>");
    expect(fabricStorageHtml).toContain("<h1>布品收納</h1>");
    expect(fabricStorageHtml).toContain("布品收納前一定要清洗嗎？");
    expect(fabricStorageHtml).toContain("換季前的布品與衣物檢查");
    expect(fabricStorageHtml).toContain("寢具接觸皮膚處");
    expect(fabricStorageHtml).toContain("https://example.com/laundry-social-auto-poster/assets/services/fabric-storage-hero-product.png");
    expect(fabricStorageHtml).toContain("外套、寢具與布品收納前檢查主圖");
    expect(fabricStorageHtml).toContain("AI 生成的高擬真產品風格主圖");
    expect(taichungXitunLaundryHtml).toContain("<title>台中西屯洗衣店｜青海路衣物、洗鞋洗包與布品收納｜私享家洗衣店</title>");
    expect(taichungXitunLaundryHtml).toContain("<h1>台中西屯洗衣店</h1>");
    expect(taichungXitunLaundryHtml).toContain("台中市西屯區青海路二段365號");
    expect(taichungXitunLaundryHtml).toContain("LINE 先傳照片詢問");
    expect(taichungXitunLaundryHtml).toContain('"@type":"FAQPage"');
    expect(taichungXitunLaundryHtml).toContain('class="service-photo"');
    expect(taichungXitunLaundryHtml).toContain(
      "https://example.com/laundry-social-auto-poster/assets/services/fabric-storage-inspection.png"
    );
    expect(taichungCitywidePickupHtml).toContain("<title>台中免費收送洗衣｜全市到府、LINE 預約｜私享家洗衣店</title>");
    expect(taichungCitywidePickupHtml).toContain("<h1>台中免費收送洗衣</h1>");
    expect(taichungCitywidePickupHtml).toContain("台中市");
    expect(taichungCitywidePickupHtml).toContain("收送本身免費");
    expect(taichungCitywidePickupHtml).toContain("https://line.me/ti/p/4m-rA6hxf6");
    expect(taichungCitywidePickupHtml).toContain("青海路二段365號");
    expect(taichungCitywidePickupHtml).toContain("收送免費不代表清潔免費");
    expect(taichungCitywidePickupHtml).toContain('"@type":"Service"');
    expect(taichungCitywidePickupHtml).toContain('"name":"台中市"');
    expect(taichungCitywidePickupHtml).not.toContain('"price":0');
    expect(taichungCitywidePickupHtml).not.toContain('"price":"0"');
  });

  it("can use GitHub Pages as the public site while images stay on a separate asset host", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-split-base-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02", [1]);

    await generatePublicSite({
      root,
      siteBaseUrl: "https://tester.github.io/laundry-social-auto-poster",
      imageBaseUrl: "https://assets.example.net/laundry",
      now: "2026-07-02T01:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const services = JSON.parse(await readFile(join(root, "docs", "services.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const html = await readFile(join(root, "docs", "index.html"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");

    expect(index.canonical_url).toBe("https://tester.github.io/laundry-social-auto-poster/");
    expect(index.base_url).toBe("https://tester.github.io/laundry-social-auto-poster");
    expect(index.image_base_url).toBe("https://assets.example.net/laundry");
    expect(index.entrypoints.services).toBe("https://tester.github.io/laundry-social-auto-poster/services.json");
    expect(index.posts[0].calendar_url).toBe(
      "https://tester.github.io/laundry-social-auto-poster/content-calendar/2026-07-02.json"
    );
    expect(index.posts[0].image_url).toBe("https://assets.example.net/laundry/assets/2026-07-02/slot-01.png");
    expect(services.services[0].url).toBe(
      "https://tester.github.io/laundry-social-auto-poster/services/shoe-bag-care.html"
    );
    expect(services.services[0].image_url).toBe(
      "https://assets.example.net/laundry/assets/services/shoe-bag-care-hero-product.png"
    );
    expect(discovery.website.url).toBe("https://tester.github.io/laundry-social-auto-poster/");
    expect(discovery.service_pages[0].image_url).toBe(
      "https://assets.example.net/laundry/assets/services/shoe-bag-care-hero-product.png"
    );
    expect(html).toContain('href="https://tester.github.io/laundry-social-auto-poster/"');
    expect(html).toContain('content="https://assets.example.net/laundry/assets/services/fabric-storage-hero-product.png"');
    expect(sitemap).toContain("<loc>https://tester.github.io/laundry-social-auto-poster/</loc>");
    expect(sitemap).not.toContain("https://assets.example.net/laundry/assets/services/fabric-storage-hero-product.png");
  });

  it("writes guide and local support pages into SEO and AI indexes", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-support-pages-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const services = JSON.parse(await readFile(join(root, "docs", "services.json"), "utf8"));
    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8"));
    const geoTargets = JSON.parse(await readFile(join(root, "docs", "geo-targets.json"), "utf8"));
    const searchVisibility = JSON.parse(await readFile(join(root, "docs", "search-visibility.json"), "utf8"));
    const knowledgeGraph = JSON.parse(await readFile(join(root, "docs", "knowledge-graph.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const llmsLite = await readFile(join(root, "docs", "llms-lite.txt"), "utf8");
    const llmsJsonl = await readFile(join(root, "docs", "llms.jsonl"), "utf8");
    const robots = await readFile(join(root, "docs", "robots.txt"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");
    const html = await readFile(join(root, "docs", "index.html"), "utf8");
    const photoGuideHtml = await readFile(join(root, "docs", "guides", "photo-before-laundry.html"), "utf8");
    const whiteShoeGuideHtml = await readFile(join(root, "docs", "guides", "white-shoe-yellowing.html"), "utf8");
    const serviceSearchGuideHtml = await readFile(
      join(root, "docs", "guides", "taichung-laundry-service-search.html"),
      "utf8"
    );
    const localShoePageHtml = await readFile(join(root, "docs", "local", "qinghai-road-shoe-cleaning.html"), "utf8");
    const jsonlTypes = llmsJsonl
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).type);

    expect(index.entrypoints.support_pages).toMatchObject({
      "photo-before-laundry": "https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html",
      "white-shoe-yellowing": "https://example.com/laundry-social-auto-poster/guides/white-shoe-yellowing.html",
      "shirt-suit-dry-cleaning": "https://example.com/laundry-social-auto-poster/guides/shirt-suit-dry-cleaning.html",
      "bedding-duvet-cleaning": "https://example.com/laundry-social-auto-poster/guides/bedding-duvet-cleaning.html",
      "plush-doll-cleaning": "https://example.com/laundry-social-auto-poster/guides/plush-doll-cleaning.html",
      "luxury-dry-cleaning": "https://example.com/laundry-social-auto-poster/guides/luxury-dry-cleaning.html",
      "taichung-laundry-service-search":
        "https://example.com/laundry-social-auto-poster/guides/taichung-laundry-service-search.html",
      "qinghai-road-shoe-cleaning": "https://example.com/laundry-social-auto-poster/local/qinghai-road-shoe-cleaning.html"
    });
    expect(
      services.services
        .find((service: { slug: string }) => service.slug === "fabric-storage")
        .related_support_pages.map((page: { slug: string }) => page.slug)
    ).toEqual(expect.arrayContaining(["bedding-storage-check", "bedding-duvet-cleaning"]));
    const supportPages = publicSupportPages();
    expect(
      services.services
        .find((service: { slug: string }) => service.slug === "shoe-bag-care")
        .related_support_pages.map((page: { slug: string }) => page.slug)
        .sort()
    ).toEqual(
      supportPages
        .filter((page) => page.service_slug === "shoe-bag-care")
        .map((page) => page.slug)
        .sort()
    );
    expect(
      services.services
        .find((service: { slug: string }) => service.slug === "white-shoe-cleaning")
        .related_support_pages.map((page: { slug: string }) => page.slug)
        .sort()
    ).toEqual(
      supportPages
        .filter((page) => page.service_slug === "white-shoe-cleaning")
        .map((page) => page.slug)
        .sort()
    );
    expect(services.services.every((service: { case_studies?: unknown[] }) => service.case_studies?.length === 3)).toBe(true);
    expect(answers.answers.some((answer: { source_url: string }) => answer.source_url.endsWith("/guides/photo-before-laundry.html"))).toBe(true);
    expect(answers.answers.some((answer: { source_url: string }) => answer.source_url.endsWith("/local/qinghai-road-shoe-cleaning.html"))).toBe(true);
    expect(
      answers.answers.some((answer: { source_url: string }) =>
        answer.source_url.endsWith("/guides/taichung-laundry-service-search.html")
      )
    ).toBe(true);
    expect(answers.answer_engine_optimization.citation_ready_summary).toContain("私享家洗衣店");
    expect(answers.answer_engine_optimization.do_not_infer_rules).toContain("Do not infer pricing.");
    expect(answers.answer_engine_optimization.best_source_pages).toContainEqual({
      label: "Photo-before-laundry guide",
      url: "https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html"
    });
    expect(
      answers.answers.every(
        (answer: { confidence?: string; citation_guidance?: string; do_not_infer?: string[] }) =>
          answer.confidence === "business-owned-source" &&
          answer.citation_guidance === "Use the answer as short factual context and cite source_url." &&
          answer.do_not_infer?.includes("Do not infer pricing.")
      )
    ).toBe(true);
    expect(
      geoTargets.local_intents.some((intent: { url: string }) =>
        intent.url.endsWith("/local/qinghai-road-shoe-cleaning.html")
      )
    ).toBe(true);
    expect(discovery.capabilities.supports_support_pages).toBe(true);
    expect(discovery.support_pages).toHaveLength(publicSupportPages().length);
    expect(discovery.support_pages).toHaveLength(
      publicSourceBaselineUrlCount() - 1 - 7 + publicAcceptedIndexGrowthCount()
    );
    expect(searchVisibility.query_clusters).toHaveLength(6);
    expect(discovery.support_pages[0]).toMatchObject({
      slug: "photo-before-laundry",
      category: "guide",
      step_count: 4,
      faq_count: 2
    });
    expect(llms).toContain("https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html");
    expect(llms).toContain("## Citation-ready summary");
    expect(llms).toContain("## Best source pages");
    expect(llms).toContain("## Do not infer");
    expect(llms).toContain("Do not guarantee that white shoes can be fully whitened.");
    expect(llmsLite).toContain("https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html");
    expect(llmsLite).toContain("Do not infer: pricing, guaranteed whitening");
    expect(jsonlTypes).toContain("support_page");
    expect(jsonlTypes).toContain("support_answer");
    expect(
      llmsJsonl
        .split(/\r?\n/)
        .filter(Boolean)
        .some((line) => {
          const record = JSON.parse(line);
          return record.type === "support_answer" && record.do_not_infer?.includes("Do not infer pricing.");
        })
    ).toBe(true);
    expect(robots).toContain("Allow: /");
    expect(robots).not.toContain("Disallow:");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/shirt-suit-dry-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/bedding-duvet-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/plush-doll-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/luxury-dry-cleaning.html</loc>");
    expect(sitemap).toContain(
      "<loc>https://example.com/laundry-social-auto-poster/guides/taichung-laundry-service-search.html</loc>"
    );
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/local/qinghai-road-shoe-cleaning.html</loc>");
    expect(aiSitemap).toContain("<!-- guide-page-photo-before-laundry -->");
    expect(aiSitemap).toContain("<!-- guide-page-taichung-laundry-service-search -->");
    expect(aiSitemap).toContain("<!-- local-page-qinghai-road-shoe-cleaning -->");
    expect(
      knowledgeGraph["@graph"].some(
        (item: { "@type"?: string; "@id"?: string }) =>
          item["@type"] === "HowTo" &&
          item["@id"] === "https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html#howto"
      )
    ).toBe(true);
    expect(html).toContain('href="https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html"');
    expect(photoGuideHtml).toContain('<link rel="canonical" href="https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html"');
    expect(photoGuideHtml).toContain('"@type":"HowTo"');
    expect(photoGuideHtml).toContain('"@type":"FAQPage"');
    expect(photoGuideHtml).toContain('<html lang="zh-Hant-TW">');
    expect(photoGuideHtml).toContain('class="breadcrumb"');
    expect(photoGuideHtml).toContain('class="answer-box"');
    expect(photoGuideHtml).toContain('"mainEntityOfPage":{"@id":"https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html#webpage"}');
    expect(whiteShoeGuideHtml).toContain("white-shoe-cleaning.html");
    expect(serviceSearchGuideHtml).toContain("台中洗衣、洗鞋、洗包與免費收送怎麼找？");
    expect(serviceSearchGuideHtml).toContain("台中洗衣免費收送");
    expect(localShoePageHtml).toContain("shoe-bag-care.html");
    expect(localShoePageHtml).toContain("https://example.com/laundry-social-auto-poster/#business");
  });

  it("thickens the Fengjia/Xitun shoe local page and adds thematic internal links", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-local-shoe-thicken-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-08-17T01:00:00.000Z"
    });

    const localHtml = await readFile(join(root, "docs", "local", "qinghai-road-shoe-cleaning.html"), "utf8");
    const homepage = await readFile(join(root, "docs", "index.html"), "utf8");
    const shoeBagCareHtml = await readFile(join(root, "docs", "services", "shoe-bag-care.html"), "utf8");
    const whiteShoeHtml = await readFile(join(root, "docs", "services", "white-shoe-cleaning.html"), "utf8");
    const textLength = pageTextLength(localHtml);
    const graph = jsonLdGraphs(localHtml);
    const faqNode = graph.find((node) => node["@type"] === "FAQPage") as
      | { mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> }
      | undefined;
    const faqs = faqNode?.mainEntity ?? [];
    const faqNames = faqs.map((faq) => faq.name ?? "");

    // Mutation gates: stubbing the three local sections drops visible text
    // to ~1518; the ticket floor is 1200, but chrome+steps+FAQ already exceed
    // that, so 1800 is the discriminating thicken gate. Dropping the
    // homepage / shoe-bag-care narrative anchors must also turn this red.
    expect(textLength).toBeGreaterThanOrEqual(1200);
    expect(textLength).toBeGreaterThanOrEqual(1800);
    expect(localHtml).toContain("逢甲");
    expect(localHtml).toContain("西屯");
    expect(localHtml).toContain("至善國中");
    expect(localHtml).toContain("從逢甲過來");
    expect(localHtml).toContain("收送邊界");
    expect(localHtml).toContain("至善國中對面");
    expect(localHtml).toContain("青海路二段365號");
    expect(localHtml).toContain("台中市全市");
    expect(localHtml).toContain("麂皮");
    expect(localHtml).toContain("帆布");
    expect(localHtml).toContain("膠氧化");
    expect(localHtml).toContain("不保證變全新");
    expect(localHtml).not.toContain("十分鐘");
    expect(localHtml).not.toMatch(/[0-9]+\s*分鐘/u);
    expect(localHtml).not.toContain("當天可約");
    expect(localHtml).not.toContain("隔日內");

    expect(graph.some((node) => node["@type"] === "HowTo")).toBe(true);
    expect(graph.some((node) => node["@type"] === "FAQPage")).toBe(true);
    expect(graph.some((node) => node["@type"] === "DryCleaningOrLaundry")).toBe(true);
    expect(graph.some((node) => node["@type"] === "WebPage")).toBe(true);

    expect(localHtml).toContain('id="faq"');
    expect(faqs.length).toBeGreaterThanOrEqual(3);
    expect(faqs.length).toBeLessThanOrEqual(5);
    expect(faqNames.some((name) => name.includes("球鞋"))).toBe(true);
    expect(faqNames.some((name) => name.includes("白鞋"))).toBe(true);
    expect(faqNames.some((name) => name.includes("麂皮"))).toBe(true);
    expect(faqNames.some((name) => name.includes("多久"))).toBe(true);
    expect(faqNames.some((name) => name.includes("多少錢"))).toBe(true);
    for (const faq of faqs) {
      const first = firstAnswerParagraph(faq.acceptedAnswer?.text ?? "");
      expect(first.length).toBeGreaterThan(0);
      expect(first.length).toBeLessThanOrEqual(50);
    }

    expect(localHtml).toContain("/go/line.html?source=local-qinghai-road-shoe-cleaning-cta");

    const homepageAnchors = thematicAnchorsTo(homepage, "qinghai-road-shoe-cleaning");
    expect(homepageAnchors.length).toBeGreaterThanOrEqual(1);
    expect(homepageAnchors.some((text) => text.includes("逢甲洗鞋") || text.includes("西屯洗鞋"))).toBe(true);
    expect(homepage).toContain("<strong>逢甲洗鞋・西屯洗鞋</strong>");
    expect(homepage).toContain("從逢甲或西屯找洗鞋，可先看");

    const serviceAnchors = thematicAnchorsTo(shoeBagCareHtml, "qinghai-road-shoe-cleaning");
    expect(serviceAnchors.length).toBeGreaterThanOrEqual(1);
    expect(serviceAnchors.some((text) => text.includes("逢甲洗鞋") || text.includes("西屯洗鞋"))).toBe(true);
    expect(shoeBagCareHtml).toContain("逢甲洗鞋與西屯洗鞋的門市位置、案例界線與收送方式");

    expect(whiteShoeHtml).not.toContain("qinghai-road-shoe-cleaning");
  });

  it("keeps every approved daily post visible in the public site and AI discovery index", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-approved-history-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeCalendar(root, "2026-07-03");
    await writeApprovalLog(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-03");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-03T03:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const latest = JSON.parse(await readFile(join(root, "docs", "latest.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const html = await readFile(join(root, "docs", "index.html"), "utf8");
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");

    expect(index.posts).toHaveLength(4);
    expect(index.article_posts).toHaveLength(2);
    expect(index.latest_date).toBe("2026-07-03");
    expect(latest.date).toBe("2026-07-03");
    expect(latest.posts).toHaveLength(2);
    expect(discovery.data_quality.post_count).toBe(4);
    expect(discovery.latest_posts).toHaveLength(2);
    expect(discovery.recent_posts).toHaveLength(4);
    expect(discovery.published_posts).toHaveLength(4);
    expect(discovery.recent_posts[0]).toMatchObject({ date: "2026-07-03", slot: 2 });
    expect(discovery.published_posts[0]).toMatchObject({ date: "2026-07-02", slot: 1 });
    expect(discovery.published_posts[0].facebook_caption).toBe("FB caption #test");
    expect((html.match(/class="post-tile post-card"/g) ?? [])).toHaveLength(4);
    expect(html).toContain("2026-07-02 11:30");
    expect(html).toContain("2026-07-03 19:30");
    expect(html).toContain("FB caption #test");
    expect(llms).toContain("## Published Posts");
    expect(llms).toContain("2026-07-02 11:30 Sneaker edge inspection");
    expect(llms).toContain("2026-07-03 19:30 Bag corner care");
    // Post pages remain generated and reader-facing, but never enter the sitemap.
    expect(await exists(join(root, "docs", "posts", "2026-07-02-slot-01.html"))).toBe(true);
    expect(sitemap).not.toContain("posts/2026-07-02-slot-01.html");
    expect(sitemap).not.toContain("posts/2026-07-03-slot-01.html");
    expect(await exists(join(root, "docs", "posts", "2026-07-03-slot-01.html"))).toBe(false);
  });

  it("publishes approved content through today in Taipei but removes future public calendars", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-future-calendar-"));
    const today = "2026-08-30";
    const tomorrow = "2026-08-31";
    await writeBusinessProfile(root);
    await writeCalendar(root, today);
    await writeCalendar(root, tomorrow);
    await writeApprovalLog(root, today);
    await writeApprovalLog(root, tomorrow);

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      // Still 2026-08-29 in UTC, but already 2026-08-30 in Asia/Taipei.
      now: "2026-08-29T16:30:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const latest = JSON.parse(await readFile(join(root, "docs", "latest.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const homepage = await readFile(join(root, "docs", "index.html"), "utf8");
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");

    expect(index.posts.map((post: { date: string }) => post.date)).toEqual([today, today]);
    expect(index.latest_date).toBe(today);
    expect(latest.date).toBe(today);
    expect(latest.posts.map((post: { date: string }) => post.date)).toEqual([today, today]);
    expect(homepage).toContain(`${today} 11:30`);
    expect(homepage).not.toContain(tomorrow);
    expect(jsonLdGraphs(homepage).find((graph) => graph["@type"] === "WebPage")?.dateModified).toBe("2026-09-03");
    expect(llms).not.toContain(tomorrow);
    expect(sitemap).not.toContain(`content-calendar/${tomorrow}.json`);
    expect(sitemap).not.toContain(`<lastmod>${tomorrow}</lastmod>`);
    expect(discovery.published_posts.map((post: { date: string }) => post.date)).toEqual([today, today]);
    expect(await exists(join(root, "docs", "content-calendar", `${today}.json`))).toBe(true);
    expect(await exists(join(root, "docs", "content-calendar", `${tomorrow}.json`))).toBe(false);
    expect(await exists(join(root, "data", "content-calendar", `${tomorrow}.json`))).toBe(true);
  });

  it("rejects a private calendar whose embedded date does not match its filename", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-calendar-date-mismatch-"));
    const filenameDate = "2026-08-30";
    const embeddedDate = "2026-08-31";
    await writeBusinessProfile(root);
    await writeCalendar(root, filenameDate);
    const privatePath = join(root, "data", "content-calendar", `${filenameDate}.json`);
    const calendar = JSON.parse(await readFile(privatePath, "utf8"));
    calendar.date = embeddedDate;
    await writeFile(privatePath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");

    await expect(
      generatePublicSite({
        root,
        baseUrl: "https://example.com/laundry-social-auto-poster",
        now: "2026-08-29T16:30:00.000Z"
      })
    ).rejects.toThrow(
      `Content calendar date mismatch: filename ${filenameDate} does not match calendar.date ${embeddedDate}.`
    );

    expect(await exists(join(root, "docs", "content-calendar", `${filenameDate}.json`))).toBe(false);
    expect(await exists(privatePath)).toBe(true);
    expect(JSON.parse(await readFile(privatePath, "utf8")).date).toBe(embeddedDate);
  });

  it("rejects a calendar date mismatch even when the filename is in the future", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-future-calendar-date-mismatch-"));
    const filenameDate = "2026-08-31";
    const embeddedDate = "2026-09-01";
    await writeBusinessProfile(root);
    await writeCalendar(root, filenameDate);
    const privatePath = join(root, "data", "content-calendar", `${filenameDate}.json`);
    const calendar = JSON.parse(await readFile(privatePath, "utf8"));
    calendar.date = embeddedDate;
    await writeFile(privatePath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");

    await expect(
      generatePublicSite({
        root,
        baseUrl: "https://example.com/laundry-social-auto-poster",
        now: "2026-08-29T16:30:00.000Z"
      })
    ).rejects.toThrow(
      `Content calendar date mismatch: filename ${filenameDate} does not match calendar.date ${embeddedDate}.`
    );

    expect(await exists(join(root, "docs", "content-calendar", `${filenameDate}.json`))).toBe(false);
    expect(await exists(privatePath)).toBe(true);
    expect(JSON.parse(await readFile(privatePath, "utf8")).date).toBe(embeddedDate);
  });

  it("expands recent approved dates on the homepage and collapses older approved posts into an archive", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-approved-archive-"));
    await writeBusinessProfile(root);
    const dates = [
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03"
    ];

    for (const date of dates) {
      await writeCalendar(root, date);
      await writeApprovalLog(root, date);
    }

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-03T03:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));
    const html = await readFile(join(root, "docs", "index.html"), "utf8");
    const [expandedHtml = "", archiveHtml = ""] = html.split('<details class="post-archive">');

    expect(index.posts).toHaveLength(16);
    expect(discovery.published_posts).toHaveLength(16);
    expect(discovery.content_contract.homepage_archive_policy).toMatchObject({
      expanded_recent_days: 7
    });
    expect((expandedHtml.match(/class="post-tile post-card"/g) ?? [])).toHaveLength(14);
    expect((archiveHtml.match(/class="post-tile post-card"/g) ?? [])).toHaveLength(2);
    expect(expandedHtml).toContain("2026-07-03 19:30");
    expect(expandedHtml).toContain("2026-06-27 11:30");
    expect(expandedHtml).not.toContain("2026-06-26 11:30");
    expect(archiveHtml).toContain("較早內容（1 天，2 篇）");
    expect(archiveHtml).toContain("2026-06-26 11:30");
    expect(archiveHtml).toContain("2026-06-26 19:30");
  });

  it("keeps unapproved scheduled slots out of public SEO and AI feeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-unapproved-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const latest = JSON.parse(await readFile(join(root, "docs", "latest.json"), "utf8"));
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");

    expect(index.posts).toEqual([]);
    expect(index.latest_date).toBe("");
    expect(latest.posts).toEqual([]);
    expect(llms).not.toContain("Sneaker edge inspection");
    expect(sitemap).not.toContain("content-calendar/2026-07-02.json");
    expect(aiSitemap).not.toContain("calendar-slot-1");
    expect(await exists(join(root, "docs", "content-calendar", "2026-07-02.json"))).toBe(false);
  });

  it("falls back to relative URLs before the public base URL is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-relative-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    await generatePublicSite({ root, baseUrl: "", now: "2026-07-02T01:00:00.000Z" });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const robots = await readFile(join(root, "docs", "robots.txt"), "utf8");

    expect(index.base_url_configured).toBe(false);
    expect(index.canonical_url).toBe("index.html");
    expect(index.posts[0].image_url).toBe("assets/2026-07-02/slot-01.png");
    expect(robots).not.toContain("Sitemap: https://");
  });

  it("writes canonical article pages with BlogPosting, breadcrumb, image alt, caption, and a real service link", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-article-metadata-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const firstPostHtml = await readFile(join(root, "docs", "posts", "2026-07-02-slot-01.html"), "utf8");
    const secondPostHtml = await readFile(join(root, "docs", "posts", "2026-07-02-slot-02.html"), "utf8");

    expect(firstPostHtml).toContain('rel="canonical" href="https://example.com/laundry-social-auto-poster/posts/2026-07-02-slot-01.html"');
    expect(firstPostHtml).toContain('property="og:title"');
    expect(firstPostHtml).toContain('property="og:description"');
    expect(firstPostHtml).toContain('property="og:type" content="article"');
    expect(firstPostHtml).toContain('property="og:image" content="https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01.png"');
    expect(firstPostHtml).toContain('property="og:image:alt"');
    expect(firstPostHtml).toMatch(/name="twitter:card" content="summary_large_image"/);
    expect(firstPostHtml).toContain('"@type":"BlogPosting"');
    expect(firstPostHtml).toContain('"@type":"BreadcrumbList"');
    expect(firstPostHtml).toContain('FB caption #test');
    expect(firstPostHtml).toContain('alt="Sneaker edge inspection - 私享家洗衣店"');
    expect(firstPostHtml).toContain('href="https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html"');
    expect(secondPostHtml).toContain('href="https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html"');
    expect(secondPostHtml).toContain('alt="Bag corner care - 私享家洗衣店"');
  });

  it("falls back to an image publicly when an approved reel MP4 is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-missing-reel-"));
    const date = "2026-07-02";
    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await writeBusinessProfile(root);
    await writeCalendar(root, date);
    await writeApprovalLog(root, date);

    const privateCalendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const privateCalendar = JSON.parse(await readFile(privateCalendarPath, "utf8"));
    for (const slot of privateCalendar.slots) {
      slot.media_type = "reel";
      slot.format = "reel";
      slot.local_video_path = `docs/assets/${date}/slot-${String(slot.slot).padStart(2, "0")}.mp4`;
      slot.public_video_url = `${baseUrl}/assets/${date}/slot-${String(slot.slot).padStart(2, "0")}.mp4`;
    }
    await writeFile(privateCalendarPath, `${JSON.stringify(privateCalendar, null, 2)}\n`, "utf8");

    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    const pngFixture = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    await Promise.all([
      writeFile(join(root, "docs", "assets", date, "slot-01.png"), pngFixture),
      writeFile(join(root, "docs", "assets", date, "slot-02.png"), pngFixture),
      writeFile(join(root, "docs", "assets", date, "slot-02.mp4"), "existing reel", "utf8")
    ]);

    const outputs = await generatePublicSite({ root, baseUrl, now: "2026-07-02T01:00:00.000Z" });
    const socialPosts = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const missingVideoPost = socialPosts.posts.find((post: { slot: number }) => post.slot === 1);
    const existingVideoPost = socialPosts.posts.find((post: { slot: number }) => post.slot === 2);
    const publicCalendar = JSON.parse(
      await readFile(join(root, "docs", "content-calendar", `${date}.json`), "utf8")
    );
    const missingVideoSlot = publicCalendar.slots.find((slot: { slot: number }) => slot.slot === 1);
    const existingVideoSlot = publicCalendar.slots.find((slot: { slot: number }) => slot.slot === 2);
    const missingVideoHtml = await readFile(join(root, "docs", "posts", `${date}-slot-01.html`), "utf8");
    const existingVideoHtml = await readFile(join(root, "docs", "posts", `${date}-slot-02.html`), "utf8");
    const missingVideoPath = `assets/${date}/slot-01.mp4`;
    const publicOutputText = (
      await Promise.all([...outputs, join(root, "docs", "content-calendar", `${date}.json`)].map((path) => readFile(path, "utf8")))
    ).join("\n");

    expect(missingVideoPost).toMatchObject({
      media_type: "image",
      image_path: `assets/${date}/slot-01.png`,
      video_path: "",
      video_url: "",
      facebook_caption: "FB caption #test",
      instagram_caption: "IG caption #test"
    });
    expect(missingVideoSlot).toMatchObject({ media_type: "image", format: "image-post" });
    expect(missingVideoSlot).not.toHaveProperty("local_video_path");
    expect(missingVideoSlot).not.toHaveProperty("public_video_url");
    expect(await exists(join(root, "docs", "assets", date, "slot-01.png"))).toBe(true);
    expect(await exists(join(root, "docs", "assets", date, "slot-01.webp"))).toBe(true);
    expect(missingVideoHtml).toContain("<picture");
    expect(missingVideoHtml).toContain(`${baseUrl}/assets/${date}/slot-01.png`);
    expect(missingVideoHtml).toContain("FB caption #test");
    expect(missingVideoHtml).not.toContain("<video");
    expect(missingVideoHtml).not.toContain("og:video");
    expect(missingVideoHtml).not.toContain("VideoObject");
    expect(publicOutputText).not.toContain(missingVideoPath);

    expect(existingVideoPost).toMatchObject({
      media_type: "reel",
      video_path: `assets/${date}/slot-02.mp4`,
      video_url: `${baseUrl}/assets/${date}/slot-02.mp4`
    });
    expect(existingVideoSlot).toMatchObject({
      media_type: "reel",
      format: "reel",
      local_video_path: `docs/assets/${date}/slot-02.mp4`,
      public_video_url: `${baseUrl}/assets/${date}/slot-02.mp4`
    });
    expect(existingVideoHtml).toContain(`<video src="${baseUrl}/assets/${date}/slot-02.mp4"`);
    expect(existingVideoHtml).toContain("og:video");
    expect(existingVideoHtml).toContain("VideoObject");

    const unchangedPrivateCalendar = JSON.parse(await readFile(privateCalendarPath, "utf8"));
    expect(unchangedPrivateCalendar.slots[0]).toMatchObject({
      media_type: "reel",
      local_video_path: `docs/assets/${date}/slot-01.mp4`,
      public_video_url: `${baseUrl}/assets/${date}/slot-01.mp4`
    });
  });

  it("removes stale video fields from approved non-video slots", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-stale-video-fields-"));
    const date = "2026-07-02";
    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await writeBusinessProfile(root);
    await writeCalendar(root, date);
    await writeApprovalLog(root, date, [1]);

    const privateCalendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const privateCalendar = JSON.parse(await readFile(privateCalendarPath, "utf8"));
    privateCalendar.slots[0].media_type = "image";
    privateCalendar.slots[0].format = "image-post";
    privateCalendar.slots[0].local_video_path = `docs/assets/${date}/slot-01.mp4`;
    privateCalendar.slots[0].public_video_url = `${baseUrl}/assets/${date}/slot-01.mp4`;
    await writeFile(privateCalendarPath, `${JSON.stringify(privateCalendar, null, 2)}\n`, "utf8");

    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(
      join(root, "docs", "assets", date, "slot-01.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      )
    );

    const outputs = await generatePublicSite({ root, baseUrl, now: "2026-07-02T01:00:00.000Z" });
    const publicCalendar = JSON.parse(
      await readFile(join(root, "docs", "content-calendar", `${date}.json`), "utf8")
    );
    const socialPosts = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const publicSlot = publicCalendar.slots.find((slot: { slot: number }) => slot.slot === 1);
    const publicPost = socialPosts.posts.find((post: { slot: number }) => post.slot === 1);
    const publicOutputText = (
      await Promise.all([...outputs, join(root, "docs", "content-calendar", `${date}.json`)].map((path) => readFile(path, "utf8")))
    ).join("\n");

    expect(publicSlot).toMatchObject({ media_type: "image", format: "image-post" });
    expect(publicSlot).not.toHaveProperty("local_video_path");
    expect(publicSlot).not.toHaveProperty("public_video_url");
    expect(publicPost).toMatchObject({ media_type: "image", video_path: "", video_url: "" });
    expect(publicOutputText).not.toContain(`assets/${date}/slot-01.mp4`);
    expect(JSON.parse(await readFile(privateCalendarPath, "utf8")).slots[0]).toHaveProperty("local_video_path");
  });

  it("fails closed when an approved reel has neither its MP4 nor fallback PNG", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-missing-reel-and-image-"));
    const date = "2026-07-02";
    await writeBusinessProfile(root);
    await writeCalendar(root, date);
    await writeApprovalLog(root, date, [1]);

    const privateCalendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const privateCalendar = JSON.parse(await readFile(privateCalendarPath, "utf8"));
    privateCalendar.slots[0].media_type = "reel";
    privateCalendar.slots[0].format = "reel";
    privateCalendar.slots[0].local_video_path = `docs/assets/${date}/slot-01.mp4`;
    privateCalendar.slots[0].public_video_url = `https://example.com/assets/${date}/slot-01.mp4`;
    await writeFile(privateCalendarPath, `${JSON.stringify(privateCalendar, null, 2)}\n`, "utf8");

    await expect(
      generatePublicSite({ root, baseUrl: "https://example.com", now: "2026-07-02T01:00:00.000Z" })
    ).rejects.toThrow(`Cannot expose approved reel ${date} slot 1: both video and fallback image are missing.`);
    expect(await exists(join(root, "docs", "content-calendar", `${date}.json`))).toBe(false);
    expect(JSON.parse(await readFile(privateCalendarPath, "utf8")).slots[0].media_type).toBe("reel");
  });

  it("rethrows non-ENOENT filesystem errors instead of silently downgrading a reel", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-reel-stat-error-"));
    const date = "2026-07-02";
    await writeBusinessProfile(root);
    await writeCalendar(root, date);
    await writeApprovalLog(root, date, [1]);

    const privateCalendarPath = join(root, "data", "content-calendar", `${date}.json`);
    const privateCalendar = JSON.parse(await readFile(privateCalendarPath, "utf8"));
    privateCalendar.slots[0].media_type = "reel";
    privateCalendar.slots[0].format = "reel";
    await writeFile(privateCalendarPath, `${JSON.stringify(privateCalendar, null, 2)}\n`, "utf8");
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    await writeFile(join(root, "docs", "assets", date, "slot-01.mp4"), "existing reel", "utf8");

    await expect(
      generatePublicSite({
        root,
        baseUrl: "https://example.com",
        now: "2026-07-02T01:00:00.000Z",
        statPublicAsset: (filePath) => {
          if (filePath.endsWith("slot-01.mp4")) {
            const error = new Error("permission denied while reading reel") as NodeJS.ErrnoException;
            error.code = "EACCES";
            throw error;
          }
          return statSync(filePath);
        }
      })
    ).rejects.toThrow("permission denied while reading reel");
    expect(await exists(join(root, "docs", "content-calendar", `${date}.json`))).toBe(false);
  });

  it("does not generate a second article page or sitemap URL when the post caption is a duplicate", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-dedup-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-04");
    await writeCalendar(root, "2026-07-05");
    await writeApprovalLog(root, "2026-07-04");
    await writeApprovalLog(root, "2026-07-05");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-05T03:00:00.000Z"
    });

    const index = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8"));
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");
    const html = await readFile(join(root, "docs", "index.html"), "utf8");

    expect(index.posts).toHaveLength(4);
    expect(index.article_posts).toHaveLength(2);
    // Dedup still decides which post pages exist on disk; none of them enter a sitemap.
    expect(sitemap).not.toContain("/posts/");
    expect(aiSitemap).not.toContain("/posts/");
    expect(sitemap).not.toContain("posts/2026-07-05-slot-01.html");
    expect(sitemap).not.toContain("posts/2026-07-05-slot-02.html");
    expect(aiSitemap).not.toContain("posts/2026-07-05-slot-01.html");
    expect(aiSitemap).not.toContain("posts/2026-07-05-slot-02.html");
    expect(await exists(join(root, "docs", "posts", "2026-07-04-slot-01.html"))).toBe(true);
    expect(await exists(join(root, "docs", "posts", "2026-07-04-slot-02.html"))).toBe(true);
    expect(await exists(join(root, "docs", "posts", "2026-07-05-slot-01.html"))).toBe(false);
    expect(await exists(join(root, "docs", "posts", "2026-07-05-slot-02.html"))).toBe(false);
    expect((html.match(/class="post-tile post-card"/g) ?? [])).toHaveLength(4);
    expect(html).toContain("posts/2026-07-04-slot-01.html");
    // A duplicate-caption post has no article of its own, but "read full post" must still
    // reach the article that owns that caption — never the raw calendar JSON.
    const readFullPostHrefs = [...html.matchAll(/<a href="([^"]*)">read full post<\/a>/gu)].map(
      (match) => match[1]
    );
    expect(readFullPostHrefs).toHaveLength(4);
    expect(readFullPostHrefs.every((href) => href?.includes("/posts/"))).toBe(true);
    expect(readFullPostHrefs.some((href) => href?.includes(".json"))).toBe(false);
  });

  it("publishes the IndexNow key file as ${INDEXNOW_KEY}.txt and removes the legacy indexnow-key.txt", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-indexnow-key-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "indexnow-key.txt"), "stale-legacy-key\n", "utf8");
    await writeFile(join(root, "docs", "stale-indexnow-key-2025.txt"), "stale-indexnow-key-2025\n", "utf8");

    const previousKey = process.env.INDEXNOW_KEY;
    process.env.INDEXNOW_KEY = "laundry-test-key-2026";
    try {
      await generatePublicSite({
        root,
        baseUrl: "https://example.com/laundry-social-auto-poster",
        now: "2026-07-02T01:00:00.000Z"
      });
    } finally {
      if (previousKey === undefined) delete process.env.INDEXNOW_KEY;
      else process.env.INDEXNOW_KEY = previousKey;
    }

    expect(await exists(join(root, "docs", "laundry-test-key-2026.txt"))).toBe(true);
    expect(await exists(join(root, "docs", "indexnow-key.txt"))).toBe(false);
    expect(await exists(join(root, "docs", "stale-indexnow-key-2025.txt"))).toBe(false);
    const keyFile = await readFile(join(root, "docs", "laundry-test-key-2026.txt"), "utf8");
    expect(keyFile).toBe("laundry-test-key-2026\n");
  });

  it("allows OAI-SearchBot to crawl the same AI entry points as other bot agents", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-oai-searchbot-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-02T01:00:00.000Z"
    });

    const robots = await readFile(join(root, "docs", "robots.txt"), "utf8");

    // OAI-SearchBot must sit in a group whose rule allows the whole site. The per-file Allow
    // list it used to carry was redundant under `Allow: /`.
    expect(robots).toContain("User-agent: OAI-SearchBot");
    const afterOai = robots.split("User-agent: OAI-SearchBot").at(1) ?? "";
    expect(afterOai).toMatch(/^\n(?:User-agent: [^\n]+\n)*Allow: \/\n/u);
    expect(robots).not.toContain("Disallow:");
    for (const crawler of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      expect(robots).toContain(`User-agent: ${crawler}`);
    }
  });

  it("publishes citywide free pickup page with internal links, schema, sitemap, and stable lastmod", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-citywide-pickup-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    const pickupPath = "services/taichung-citywide-laundry-pickup.html";
    const pickupUrl = `${baseUrl}/${pickupPath}`;
    const businessBulkPath = "services/business-bulk-laundry.html";
    const businessBulkUrl = `${baseUrl}/${businessBulkPath}`;

    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-07-10T03:00:00.000Z"
    });

    const homepage = await readFile(join(root, "docs", "index.html"), "utf8");
    const pickupHtml = await readFile(join(root, "docs", pickupPath), "utf8");
    const businessBulkHtml = await readFile(join(root, "docs", businessBulkPath), "utf8");
    const sitemap1 = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const services = JSON.parse(await readFile(join(root, "docs", "services.json"), "utf8"));
    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8"));
    const geoTargets = JSON.parse(await readFile(join(root, "docs", "geo-targets.json"), "utf8"));
    const knowledgeGraph = JSON.parse(await readFile(join(root, "docs", "knowledge-graph.json"), "utf8"));
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8"));

    expect(homepage).toContain(`href="${pickupUrl}"`);
    expect(homepage).toContain("台中全市免費洗衣收送");
    expect(homepage).toContain("id=\"citywide-pickup\"");
    expect(homepage).toContain("台中洗衣收送");
    expect(homepage).toContain("台中免費收送");
    expect(homepage).toContain('"@type":"DryCleaningOrLaundry"');
    expect(homepage).toContain('"@type":"FAQPage"');
    expect(homepage).toContain('id="homepage-faq"');
    expect(homepage).toContain("台中洗衣與免費收送常見問題");
    expect(homepage).toContain("收送免費等於清潔免費嗎？");
    expect(homepage).toContain('<html lang="zh-Hant-TW">');
    expect(homepage).toContain('<time datetime="2026-09-03">2026-09-03</time>');
    expect(homepage).toContain("台中免費收送，逢甲・西屯洗鞋先看材質");
    expect(homepage).toContain(`${baseUrl}/go/line.html?source=home-cta`);
    expect(homepage).toContain(`${baseUrl}/go/line.html?source=footer`);
    expect(homepage).toContain('"name":"台中市"');
    expect(homepage).not.toContain('"price":0');
    expect(homepage).not.toContain('"price":"0"');

    expect(pickupHtml).toContain("<h1>台中免費收送洗衣</h1>");
    expect(pickupHtml).toContain("收送範圍為台中市");
    expect(pickupHtml).toContain("收送本身免費");
    expect(pickupHtml).toContain("https://line.me/ti/p/4m-rA6hxf6");
    expect(pickupHtml).toContain("西屯區青海路二段365號");
    expect(pickupHtml).toContain('"@type":"Service"');
    expect(pickupHtml).toContain('"@type":"AdministrativeArea"');
    expect(pickupHtml).toContain('"name":"台中市"');
    expect(pickupHtml).toContain('"mainEntityOfPage":"' + pickupUrl + '"');
    expect(pickupHtml).toContain('class="breadcrumb"');
    expect(pickupHtml).toContain('<time datetime="2026-07-22">2026-07-22</time>');
    expect(pickupHtml).toContain("相關送洗指南");
    expect(pickupHtml).toContain(`${baseUrl}/guides/photo-before-laundry.html`);
    expect(pickupHtml).not.toContain('"price":0');
    expect(pickupHtml).not.toContain('"price":"0"');

    // The free-pickup differentiator must read as an affirmative fact an answer engine can
    // quote ("there is no minimum"), never as a refusal to state one ("we do not commit to
    // a minimum") — the latter reads as "we won't say" and cannot be cited.
    expect(pickupHtml).toContain("收送沒有最低消費門檻");
    expect(pickupHtml).toContain("不以單次洗滌滿額作為收送條件");
    expect(pickupHtml).toContain("免費收送有最低消費門檻嗎？");
    expect(pickupHtml).not.toContain("未在此承諾處理天數、最低消費金額");
    expect(homepage).toContain("沒有最低消費門檻");
    // Still honest about what "no threshold" does not cover.
    expect(pickupHtml).toContain("收送免費不代表清潔免費");

    expect(homepage).toContain(`href="${businessBulkUrl}"`);
    expect(homepage).toContain("店家與公司大量送洗");
    expect(businessBulkHtml).toContain("<h1>台中店家・公司大量衣物送洗</h1>");
    expect(businessBulkHtml).toContain("台中市全區免費收送");
    expect(businessBulkHtml).toContain("清潔與洗護費用另依實際物件判斷");
    expect(businessBulkHtml).toContain('"@type":"Service"');
    expect(businessBulkHtml).toContain('"@type":"AdministrativeArea"');
    expect(businessBulkHtml).toContain('"name":"台中市"');
    expect(businessBulkHtml).not.toContain('"price":0');
    expect(businessBulkHtml).not.toContain('"price":"0"');

    expect(sitemap1).toContain(`<loc>${pickupUrl}</loc>`);
    expect(sitemap1).toContain(`<loc>${businessBulkUrl}</loc>`);
    expect(sitemap1).toMatch(
      new RegExp(
        `<loc>${businessBulkUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}</loc><lastmod>2026-08-23</lastmod>`
      )
    );
    // Money pages are the indexable surface; caption/post pages are out of the
    // sitemap entirely (rescued 190d063 design). Date is ours: the static
    // The knowledge navigation and compact featured-answer sections changed on 2026-09-03.
    expect(sitemap1).not.toContain("/posts/");
    expect(sitemap1).toContain("<lastmod>2026-09-03</lastmod>");
    expect(sitemap1).not.toContain("<lastmod>2026-07-10T03:00:00.000Z</lastmod>");
    expect(sitemap1).toMatch(
      new RegExp(
        `<loc>${baseUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/</loc><lastmod>2026-09-03</lastmod>`
      )
    );
    expect(sitemap1).toMatch(
      new RegExp(
        `<loc>${pickupUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}</loc><lastmod>2026-07-22</lastmod>`
      )
    );
    // Intentionally updated service pages carry their stable content lastmod.
    const shoeBagEntry =
      sitemap1.match(
        new RegExp(
          `<url><loc>${baseUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/services/shoe-bag-care\\.html</loc>(.*?)</url>`,
          "u"
        )
      )?.[1] ?? "";
    expect(shoeBagEntry).toContain("<lastmod>2026-08-17</lastmod>");
    expect(shoeBagEntry).not.toContain("<changefreq>");
    expect(sitemap1).not.toContain("<priority>");

    expect(
      answers.answers.some(
        (item: { question: string; local_intent?: string }) =>
          item.question === "台中市全區免費洗衣收送怎麼預約？" &&
          item.local_intent === "台中市 洗衣免費收送 LINE 預約"
      )
    ).toBe(true);
    expect(
      answers.answers.some(
        (item: { question: string; local_intent?: string; source_url?: string }) =>
          item.question === "台中店家或公司有大量衣物可以預約收送嗎？" &&
          item.local_intent === "台中市 店家 公司 大量衣物 送洗 收送" &&
          item.source_url === businessBulkUrl
      )
    ).toBe(true);
    expect(
      answers.answers.some((item: { question: string }) => item.question.includes("台中西屯台中洗衣收送"))
    ).toBe(false);
    expect(geoTargets.service_areas).toContainEqual(
      expect.objectContaining({ label: "台中市", type: "municipality" })
    );
    expect(geoTargets.coverage_boundaries.pickup_delivery).toMatchObject({
      area: "台中市",
      pickup_delivery_fee: "free",
      cleaning_fee: "quoted separately after item review",
      booking_channel: "LINE"
    });
    expect(
      geoTargets.local_intents.some(
        (item: { query: string; area: string; url: string }) =>
          item.query === "台中市 洗衣免費收送" && item.area === "台中市" && item.url === pickupUrl
      )
    ).toBe(true);
    expect(
      geoTargets.local_intents.some(
        (item: { query: string; area: string; url: string }) =>
          item.query === "台中市 公司大量衣物送洗" &&
          item.area === "台中市" &&
          item.url === businessBulkUrl
      )
    ).toBe(true);
    expect(
      geoTargets.local_intents.some((item: { query: string }) => item.query.includes("台中西屯 台中西屯"))
    ).toBe(false);

    const extractJsonLdBlocks = (html: string): unknown[] =>
      [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((match) =>
        JSON.parse(match[1] ?? "{}")
      );

    const findWebPageDateModified = (html: string): string | undefined => {
      for (const block of extractJsonLdBlocks(html)) {
        const graph = (block as { "@graph"?: Array<Record<string, unknown>> })["@graph"];
        if (!Array.isArray(graph)) continue;
        const webpage = graph.find((node) => node["@type"] === "WebPage");
        if (webpage && typeof webpage.dateModified === "string") return webpage.dateModified;
      }
      return undefined;
    };

    const findArticleDateModified = (html: string): string | undefined => {
      for (const block of extractJsonLdBlocks(html)) {
        const graph = (block as { "@graph"?: Array<Record<string, unknown>> })["@graph"];
        if (!Array.isArray(graph)) continue;
        const article = graph.find(
          (node) => node["@type"] === "BlogPosting" || node["@type"] === "Article"
        );
        if (article && typeof article.dateModified === "string") return article.dateModified;
      }
      return undefined;
    };

    const homepageDateModified1 = findWebPageDateModified(homepage);
    const pickupDateModified1 = findWebPageDateModified(pickupHtml);
    const shoeBagHtml1 = await readFile(join(root, "docs", "services", "shoe-bag-care.html"), "utf8");
    const shoeBagDateModified1 = findWebPageDateModified(shoeBagHtml1);
    const guideHtml1 = await readFile(join(root, "docs", "guides", "photo-before-laundry.html"), "utf8");
    const guideDateModified1 = findWebPageDateModified(guideHtml1);
    const postHtml1 = await readFile(join(root, "docs", "posts", "2026-07-02-slot-01.html"), "utf8");
    const postDateModified1 = findArticleDateModified(postHtml1);

    expect(homepageDateModified1).toBe("2026-09-03");
    expect(pickupDateModified1).toBe("2026-07-22");
    expect(shoeBagDateModified1).toBe("2026-08-17");
    expect(guideDateModified1).toBe("2026-08-23");
    expect(postDateModified1).toBe("2026-07-02T11:30:00+08:00");
    expect(homepage).not.toContain(`"dateModified":"2026-07-10T03:00:00.000Z"`);
    expect(pickupHtml).not.toContain(`"dateModified":"2026-07-10T03:00:00.000Z"`);
    expect(shoeBagHtml1).not.toContain(`"dateModified":"2026-07-10T03:00:00.000Z"`);
    expect(postHtml1).not.toContain(`"dateModified":"2026-07-10T03:00:00.000Z"`);

    expect(services.services.some((item: { slug: string }) => item.slug === "taichung-citywide-laundry-pickup")).toBe(
      true
    );
    expect(
      knowledgeGraph["@graph"].some(
        (item: { "@type"?: string; name?: string; areaServed?: { name?: string } }) =>
          item["@type"] === "Service" &&
          item.name === "台中全市免費洗衣收送" &&
          item.areaServed?.name === "台中市"
      )
    ).toBe(true);
    expect(
      discovery.structured_data.areaServed.some(
        (area: { "@type"?: string; name?: string }) =>
          area["@type"] === "AdministrativeArea" && area.name === "台中市"
      )
    ).toBe(true);
    expect(JSON.stringify(discovery.structured_data)).not.toContain('"price":0');
    expect(JSON.stringify(discovery.structured_data)).not.toContain('"price":"0"');

    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-07-18T12:00:00.000Z"
    });
    const sitemap2 = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const homepage2 = await readFile(join(root, "docs", "index.html"), "utf8");
    const pickupHtml2 = await readFile(join(root, "docs", pickupPath), "utf8");
    const shoeBagHtml2 = await readFile(join(root, "docs", "services", "shoe-bag-care.html"), "utf8");
    const postHtml2 = await readFile(join(root, "docs", "posts", "2026-07-02-slot-01.html"), "utf8");

    // Rebuild with a later now must not rewrite sitemap lastmod or page schema dateModified.
    expect(sitemap2).toBe(sitemap1);
    expect(findWebPageDateModified(homepage2)).toBe(homepageDateModified1);
    expect(findWebPageDateModified(pickupHtml2)).toBe(pickupDateModified1);
    expect(findWebPageDateModified(shoeBagHtml2)).toBe("2026-08-17");
    expect(findArticleDateModified(postHtml2)).toBe(postDateModified1);
    expect(sitemap2).not.toContain("<lastmod>2026-07-18T12:00:00.000Z</lastmod>");
    expect(sitemap2).not.toContain("<lastmod>2026-07-18</lastmod>");
    expect(homepage2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);
    expect(pickupHtml2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);
    expect(postHtml2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);

    const serviceLastmodsWithDate = [
      ...sitemap2.matchAll(/services\/[^<]+<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/gu)
    ].map((match) => match[1]);
    expect(serviceLastmodsWithDate.sort()).toEqual([
      "2026-07-22",
      "2026-08-17",
      "2026-08-23",
      "2026-08-23",
      "2026-08-23",
      // 2026-08-25: D03 — the Xitun local page gained 逢甲/route/pickup
      // sections, so its content_lastmod moved off 2026-07-20.
      "2026-08-25",
      "2026-08-26"
    ]);
  });

  it("thickens the eight thin guides with AEO first answers and syncs D05/D12", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-guide-thicken-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-08-17T01:00:00.000Z"
    });

    const thinGuideAnswers: Array<{ slug: string; answer: string; serviceNeedle: string }> = [
      {
        slug: "rainy-shoe-care",
        answer: "雨天鞋子進水後先通風、取出鞋墊；不要高溫烘或悶進鞋櫃。",
        serviceNeedle: "shoe-bag-care.html"
      },
      {
        slug: "bag-handle-cleaning",
        answer: "行李箱收進櫃子前先看輪子；輪子與底板灰收進去，下次打開就是味道。",
        serviceNeedle: "shoe-bag-care.html"
      },
      {
        slug: "bedding-storage-check",
        answer: "寢具收納前先聞潮味；摸起來乾、中間層不一定乾，帶濕氣封存會悶出味道。",
        serviceNeedle: "fabric-storage.html"
      },
      {
        slug: "white-shoe-yellowing",
        answer: "白鞋灰多半是髒、可清；黃在膠邊是氧化，只能淡化，不保證回白。",
        serviceNeedle: "white-shoe-cleaning.html"
      },
      {
        slug: "photo-before-laundry",
        answer: "送洗前拍整體、局部、材質與最在意痕跡，照片比只問價錢更能判斷。",
        serviceNeedle: "taichung-xitun-laundry.html"
      },
      {
        slug: "bedding-duvet-cleaning",
        answer: "棉被送洗先看填充、潮氣與異味；沒乾透就收納，下一季打開就是味道。",
        serviceNeedle: "fabric-storage.html"
      },
      {
        slug: "plush-doll-cleaning",
        answer: "娃娃可以洗，但不能亂洗；怕的是脫水結塊與五官脫落，要先固定再手洗。",
        serviceNeedle: "taichung-xitun-laundry.html"
      },
      {
        slug: "luxury-dry-cleaning",
        answer: "精品送洗先看材質與飾件，不因品牌保證全新；邊角磨損只能維持。",
        serviceNeedle: "taichung-xitun-laundry.html"
      }
    ];

    for (const page of thinGuideAnswers) {
      const html = await readFile(join(root, "docs", "guides", `${page.slug}.html`), "utf8");
      const lead = html.match(/<p class="lead">([\s\S]*?)<\/p>/u)?.[1]?.trim() ?? "";
      const answerBox = html.match(/<div class="answer-box">\s*<p>([\s\S]*?)<\/p>/u)?.[1]?.trim() ?? "";
      expect(pageTextLength(html), page.slug).toBeGreaterThanOrEqual(1200);
      expect(lead, `${page.slug} lead`).toBe(page.answer);
      expect(lead.length, `${page.slug} lead length`).toBeLessThanOrEqual(50);
      expect(answerBox, `${page.slug} answer-box`).toBe(page.answer);
      expect(thematicAnchorsTo(html, page.serviceNeedle).length, `${page.slug} service link`).toBeGreaterThan(0);
    }

    const bagHandleHtml = await readFile(join(root, "docs", "guides", "bag-handle-cleaning.html"), "utf8");
    expect(bagHandleHtml).toContain("行李箱輪子");
    expect(bagHandleHtml).toContain("輪子和底板");

    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8")) as {
      answer_engine_optimization: {
        citation_ready_summary: string;
        best_source_pages: Array<{ label: string; url: string }>;
      };
      answers: Array<{ id: string; question: string; answer: string; source_url: string }>;
    };
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const threeAnswers = [
      "娃娃可以洗，但不能亂洗；怕的是脫水結塊與五官脫落，要先固定再手洗。",
      "白鞋灰多半是髒、可清；黃在膠邊是氧化，只能淡化，不保證回白。",
      "行李箱收進櫃子前先看輪子；輪子與底板灰收進去，下次打開就是味道。"
    ];
    for (const answer of threeAnswers) {
      expect(answers.answer_engine_optimization.citation_ready_summary).toContain(answer);
      expect(llms).toContain(answer);
    }
    expect(answers.answer_engine_optimization.best_source_pages).toContainEqual({
      label: "Plush doll wash boundary",
      url: `${baseUrl}/guides/plush-doll-cleaning.html`
    });
    expect(answers.answer_engine_optimization.best_source_pages).toContainEqual({
      label: "White shoe grey vs yellow",
      url: `${baseUrl}/guides/white-shoe-yellowing.html`
    });
    expect(answers.answer_engine_optimization.best_source_pages).toContainEqual({
      label: "Luggage wheel and bag handle",
      url: `${baseUrl}/guides/bag-handle-cleaning.html`
    });
    expect(
      answers.answers.some(
        (item) =>
          item.id === "plush-doll-cleaning-summary" &&
          item.answer === threeAnswers[0] &&
          item.source_url.endsWith("/guides/plush-doll-cleaning.html")
      )
    ).toBe(true);
    expect(
      answers.answers.some(
        (item) =>
          item.id === "white-shoe-yellowing-summary" &&
          item.answer === threeAnswers[1] &&
          item.source_url.endsWith("/guides/white-shoe-yellowing.html")
      )
    ).toBe(true);
    expect(
      answers.answers.some(
        (item) =>
          item.id === "bag-handle-cleaning-summary" &&
          item.answer === threeAnswers[2] &&
          item.source_url.endsWith("/guides/bag-handle-cleaning.html")
      )
    ).toBe(true);

    expect(canonicalSeoSyncPage("/services/bag-care.html")).toBe("/services/shoe-bag-care.html");
    expect(canonicalSeoSyncPage("/services/shoe-bag-care.html")).toBe("/services/shoe-bag-care.html");

    const config = getConfig({
      ...process.env,
      DRY_RUN: "true",
      PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
    });
    const knownPages = new Set([
      "/services/white-shoe-cleaning.html",
      "/services/shoe-bag-care.html",
      "/services/fabric-storage.html",
      "/services/taichung-xitun-laundry.html",
      "/services/taichung-citywide-laundry-pickup.html",
      "/guides/photo-before-laundry.html",
      "/guides/shirt-suit-dry-cleaning.html",
      "/guides/bedding-duvet-cleaning.html",
      "/guides/plush-doll-cleaning.html",
      "/guides/luxury-dry-cleaning.html"
    ]);
    for (const date of ["2026-07-22", "2026-08-14", "2026-08-25"]) {
      const content = buildDailyContent(date, config);
      for (const slot of content.slots) {
        if (!slot.seo_sync_page) continue;
        expect(slot.seo_sync_page, `${date} slot ${slot.slot}`).not.toBe("/services/bag-care.html");
        expect(knownPages.has(slot.seo_sync_page), `${date} ${slot.seo_sync_page}`).toBe(true);
      }
    }

    expect(guideLinkFor("行李箱收進櫃子前，先看輪子")).toBe(
      "https://sixiangjialaundry.com/guides/bag-handle-cleaning.html"
    );
    expect(guideLinkFor("行李輪子灰塵")).toBe("https://sixiangjialaundry.com/guides/bag-handle-cleaning.html");
  });

  it("publishes the Taichung laundry price list page with canonical reference prices", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-price-list-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-08-26T01:00:00.000Z"
    });

    const pagePath = "services/taichung-laundry-price-list.html";
    const html = await readFile(join(root, "docs", pagePath), "utf8");
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");
    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8")) as {
      answers: Array<{ question: string; answer: string; source_url: string }>;
    };
    const shoeBagCareHtml = await readFile(join(root, "docs", "services", "shoe-bag-care.html"), "utf8");
    const xitunHtml = await readFile(join(root, "docs", "services", "taichung-xitun-laundry.html"), "utf8");
    const whiteShoeHtml = await readFile(join(root, "docs", "services", "white-shoe-cleaning.html"), "utf8");

    // R6① path + title target words
    expect(html).toContain("<title>台中洗衣價目表｜台中洗鞋價格・洗包包多少錢｜西屯洗衣店價格｜私享家洗衣店</title>");
    expect(html).toContain("<h1>台中洗衣價目表</h1>");
    expect(html).toContain("台中洗鞋價格");
    expect(html).toContain("洗包包多少錢");
    expect(html).toContain("西屯洗衣店價格");

    // R2① first 60 chars of the opening answer carry a numeric range
    const lead = (html.match(/<p class="lead">([\s\S]*?)<\/p>/u)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const answerBox = (html.match(/<div class="answer-box">\s*<p>([\s\S]*?)<\/p>/u)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .trim();
    expect(lead.slice(0, 60)).toMatch(/\$70/);
    expect(lead.slice(0, 60)).toMatch(/\$2500/);
    expect(answerBox.slice(0, 60)).toMatch(/\$70/);
    expect(answerBox.slice(0, 60)).toMatch(/\$2500/);
    expect(lead).toContain("參考價");
    expect(lead).toContain("不是固定價");

    // R6② three real tables, every canonical row — not a sample
    expect(html).toContain("<table");
    expect(html).not.toMatch(/<ul[\s\S]*id="price-table-/u);
    for (const table of CANONICAL_PRICE_TABLES) {
      expect(html, table.id).toContain(`id="${table.id}"`);
      expect(html, table.heading).toContain(`<h3>${table.heading}</h3>`);
      const rows = tableRows(html, table.id);
      expect(rows, table.id).toEqual(table.rows.map((row) => [row[0], row[1]]));
    }

    // The tables above are pinned row by row, but the prose is where a wrong
    // price actually ships: changing 名牌包 $1500 起 to $1400 in the opening
    // answer left every assertion green when this was first written. Every
    // amount anywhere in the visible copy — lead, answer box, FAQ answers,
    // storage-credit lines — must be a figure the canon actually contains.
    const canonicalAmounts = new Set<string>([
      ...CANONICAL_PRICE_TABLES.flatMap((table) =>
        table.rows.flatMap((row) => row[1]!.match(/\$\d+/gu) ?? [])
      ),
      // Storage-credit figures are written as bare numerals, not $ amounts, so
      // they never reach this scan; the exact strings are asserted below.
      "$70",
      "$2500"
    ]);
    const pageAmounts = new Set(visiblePageText(html).match(/\$\d+/gu) ?? []);
    expect(pageAmounts.size).toBeGreaterThan(5);
    for (const amount of pageAmounts) {
      expect(canonicalAmounts, `${amount} is not a canonical price`).toContain(amount);
    }

    // R2 order of required blocks
    const requiredOrder = [
      "id=\"price-list\"",
      "<h3>價格怎麼決定</h3>",
      "<h3>儲值優惠</h3>",
      "<h3>免費收送範圍與怎麼預約</h3>",
      "<h3>門市地址與 LINE</h3>",
      "<h2>常見問題</h2>"
    ];
    let lastIndex = -1;
    for (const heading of requiredOrder) {
      const index = html.indexOf(heading);
      expect(index, heading).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
    expect(html).toContain("滿 1000 送 100");
    expect(html).toContain("儲 3000 送 400");
    expect(html).toContain("儲 6000 送 1000");
    expect(html).toContain("台中市全區免費到府收送");
    expect(html).toContain("台中市西屯區青海路二段365號");
    expect(html).toContain("至善國中對面");
    expect(html).toContain("0968327653");

    // R6⑤ disclaimer on each price block
    expect(html.split(PRICE_LIST_DISCLAIMER).length).toBeGreaterThan(3);

    // R6③ FAQPage JSON-LD matches visible FAQ text
    const graph = jsonLdGraphs(html);
    const faqNode = graph.find((node) => node["@type"] === "FAQPage") as
      | { mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> }
      | undefined;
    const faqs = faqNode?.mainEntity ?? [];
    expect(faqs.length).toBeGreaterThanOrEqual(4);
    expect(graph.some((node) => node["@type"] === "BreadcrumbList")).toBe(true);
    for (const faq of faqs) {
      expect(html, faq.name).toContain(`<h3>${faq.name ?? ""}</h3>`);
      expect(html, faq.acceptedAnswer?.text).toContain(`<p>${faq.acceptedAnswer?.text ?? ""}</p>`);
    }
    expect(faqs.map((faq) => faq.name)).toEqual(
      expect.arrayContaining([
        "台中洗鞋大概多少錢?",
        "名牌包清洗多少錢?",
        "洗衣有到府收送嗎?要多少錢?",
        "乾洗跟水洗價格差在哪?"
      ])
    );

    // We sell a service and have no ratings data of our own, so Product and
    // AggregateRating must never appear. The shared #business node's service
    // catalogue (Offer) stays: it is on every other page under the same @id,
    // and publishing two different property sets for one entity is the worse
    // failure. A price page is also exactly where a service catalogue belongs.
    const types = jsonLdTypes(html);
    expect(types).not.toContain("Product");
    expect(types).not.toContain("AggregateRating");
    expect(html).not.toContain('"@type":"Product"');
    expect(html).not.toContain('"@type":"AggregateRating"');
    expect(types).toContain("OfferCatalog");

    // R7 claim gate on visible copy
    const visible = visiblePageText(html);
    for (const banned of ["100%", "永久", "完全去除", "恢復全新", "一定洗白", "保證"]) {
      expect(visible, banned).not.toContain(banned);
    }

    // R6⑥ sitemap + existing AI surfaces
    expect(sitemap).toContain(`<loc>${baseUrl}/${pagePath}</loc>`);
    expect(aiSitemap).toContain("<!-- service-page-taichung-laundry-price-list -->");
    expect(llms).toContain(`[台中洗衣價目表](${baseUrl}/${pagePath})`);
    expect(answers.answers.some((item) => item.source_url.endsWith(`/${pagePath}`))).toBe(true);

    // R4 body interlinks (nav is stripped)
    expect(thematicAnchorsTo(shoeBagCareHtml, "taichung-laundry-price-list.html").length).toBeGreaterThanOrEqual(1);
    expect(thematicAnchorsTo(xitunHtml, "taichung-laundry-price-list.html").length).toBeGreaterThanOrEqual(1);
    expect(thematicAnchorsTo(whiteShoeHtml, "taichung-laundry-price-list.html")).toEqual([]);
  });

  it("publishes accepted index-growth guides into sitemap and AI surfaces with crawlable parent links", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-index-growth-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-07-10T03:00:00.000Z"
    });

    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    const aiSitemap = await readFile(join(root, "docs", "ai-sitemap.xml"), "utf8");
    const answers = JSON.parse(await readFile(join(root, "docs", "answers.json"), "utf8")) as {
      answers: Array<{ id: string; source_url: string }>;
    };
    const discovery = JSON.parse(await readFile(join(root, "docs", "ai-discovery.json"), "utf8")) as {
      support_pages: Array<{ slug: string; path?: string }>;
    };
    const llms = await readFile(join(root, "docs", "llms.txt"), "utf8");
    const knowledgeGraph = JSON.parse(await readFile(join(root, "docs", "knowledge-graph.json"), "utf8")) as {
      "@graph": Array<{ "@id"?: string }>;
    };
    const homepage = await readFile(join(root, "docs", "index.html"), "utf8");
    const locs = sitemapLocs(sitemap);
    const acceptedCount = publicAcceptedIndexGrowthCount();
    const baseline = publicSourceBaselineUrlCount();
    expect(baseline).toBe(32);
    expect(locs).toHaveLength(baseline + acceptedCount + 1);
    expect(locs.some((url) => url.includes("/posts/"))).toBe(false);
    expect(locs.some((url) => url.endsWith(".json"))).toBe(false);
    expect(locs.some((url) => url.includes("/assets/"))).toBe(false);
    expect(homepage).toContain("id=\"guide-hub\"");
    expect(homepage).toContain("id=\"guide-hub-shoes\"");
    expect(homepage).toContain("id=\"guide-hub-bags\"");
    expect(homepage).toContain("id=\"guide-hub-textiles\"");
    expect(homepage).toContain("id=\"guide-hub-decisions\"");
    expect(existsSync(join(root, "data", ".calendar-hmac-key"))).toBe(false);

    const acceptedPages = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: "2026-09-03" });
    const acceptedPaths = new Set(acceptedPages.map((page) => page.path));
    const publicPaths = new Set(publicSupportPages().map((page) => page.path));
    const sitemapPaths = new Set(locs.map((url) => pathFromUrl(url, baseUrl)));
    const answerPaths = new Set(
      answers.answers.map((item) => item.source_url.replace(`${baseUrl}/`, "")).filter((path) => path !== `${baseUrl}/` && !path.startsWith("services/"))
    );
    const discoveryPaths = new Set(
      discovery.support_pages.map((page) => page.path ?? publicSupportPages().find((item) => item.slug === page.slug)?.path ?? "")
    );
    for (const path of acceptedPaths) {
      expect(sitemapPaths.has(path), path).toBe(true);
      expect(publicPaths.has(path), path).toBe(true);
    }

    for (const page of acceptedPages) {
      const html = await readFile(join(root, "docs", page.path), "utf8");
      const parentService = page.service_slug ?? "";
      const body = articleBodyHtml(html);
      // This is a regression floor below the current shortest accepted body,
      // not a ranking claim. Structural/provenance gates carry the quality
      // decision; padding pages to a round 1,000 characters would make them worse.
      expect(visiblePageText(body).replace(/\s+/gu, "").length, `${page.slug} body chars`).toBeGreaterThanOrEqual(950);
      expect(sitemap).toContain(`<loc>${baseUrl}/${page.path}</loc>`);
      expect(sitemap).toContain(`<lastmod>${page.content_lastmod}</lastmod>`);
      expect(html).not.toContain("2026-07-10T03:00:00.000Z");
      expect(html).toContain(`<p>${page.citation_answer}</p>`);
      expect(body).toContain(`data-parent-service`);
      expect(bodyAnchorsTo(html, `${parentService}.html`), `${page.slug} parent`).toHaveLength(1);
      expect(html).toContain("data-related-guides");
      const related = page.related_slugs ?? [];
      expect(related.length).toBeGreaterThanOrEqual(2);
      const relatedHits = related.filter((slug) => body.includes(`${slug}.html`));
      expect(relatedHits.length, `${page.slug} related guides`).toBeGreaterThanOrEqual(2);
      expect(body).toContain("taichung-citywide-laundry-pickup.html");
      expect(body).toContain("taichung-laundry-price-list.html");
      expect(answers.answers.some((item) => item.id === `${page.slug}-summary`)).toBe(true);
      expect(discovery.support_pages.some((item) => item.slug === page.slug)).toBe(true);
      expect(aiSitemap).toContain(`<!-- guide-page-${page.slug} -->`);
      expect(llms).toContain(`${baseUrl}/${page.path}`);
      expect(knowledgeGraph["@graph"].some((item) => item["@id"]?.includes(page.path))).toBe(true);
    }

    for (const candidate of INDEX_GROWTH_REJECTED_CANDIDATES) {
      expect(sitemap).not.toContain(candidate.slug);
      expect(aiSitemap).not.toContain(candidate.slug);
      expect(llms).not.toContain(candidate.slug);
      expect(discovery.support_pages.some((item) => item.slug === candidate.slug)).toBe(false);
      expect(answers.answers.some((item) => item.id.startsWith(`${candidate.slug}-`))).toBe(false);
    }
  });

  it("accepted guide body has exactly one crawlable parent-service target", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-index-growth-parent-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-10T03:00:00.000Z"
    });
    const sample = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: "2026-09-03" })[0];
    if (!sample?.service_slug) throw new Error("missing accepted page");
    const html = await readFile(join(root, "docs", sample.path), "utf8");
    expect(
      bodyAnchorsTo(html, `${sample.service_slug}.html`),
      "accepted page body parent-service target"
    ).toHaveLength(1);
  });

  it("body parent-link assertion fails after removing the article parent while nav remains", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-index-growth-mutation-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await generatePublicSite({
      root,
      baseUrl: "https://example.com/laundry-social-auto-poster",
      now: "2026-07-10T03:00:00.000Z"
    });

    const sample = resolveAcceptedIndexGrowthPages(INDEX_GROWTH_CATALOG, { today: "2026-09-03" })[0];
    if (!sample?.service_slug) throw new Error("missing accepted page");
    const htmlPath = join(root, "docs", sample.path);
    const original = await readFile(htmlPath, "utf8");
    expect(bodyAnchorsTo(original, `${sample.service_slug}.html`)).toHaveLength(1);
    expect(original).toContain(`<nav class="nav"`);
    expect(original).toMatch(new RegExp(`<nav class="nav"[\\s\\S]*${sample.service_slug}\\.html`));

    const withoutBodyParent = original.replace(/\s*<a href="[^"]+" data-parent-service>[\s\S]*?<\/a>/u, "");
    expect(withoutBodyParent).toContain(`<nav class="nav"`);
    expect(withoutBodyParent).toMatch(new RegExp(`<nav class="nav"[\\s\\S]*${sample.service_slug}\\.html`));
    expect(
      bodyAnchorsTo(withoutBodyParent, `${sample.service_slug}.html`),
      "accepted page body parent-service target"
    ).toHaveLength(0);
  });

  it("fails closed when the deployment path is missing the production base URL", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-index-growth-deploy-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await expect(
      generatePublicSite({
        root,
        baseUrl: "https://example.com/laundry-social-auto-poster",
        now: "2026-07-10T03:00:00.000Z",
        deployment: true
      })
    ).rejects.toThrow(/production public site base URL must be https:\/\/sixiangjialaundry.com/);
    await expect(
      generatePublicSite({
        root,
        baseUrl: "",
        now: "2026-07-10T03:00:00.000Z",
        deployment: true
      })
    ).rejects.toThrow(/production public site base URL must be https:\/\/sixiangjialaundry.com/);
    await generatePublicSite({
      root,
      baseUrl: PRODUCTION_PUBLIC_SITE_BASE_URL,
      now: "2026-07-10T03:00:00.000Z",
      deployment: true
    });
    const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
    expect(sitemap).toContain(`<loc>${PRODUCTION_PUBLIC_SITE_BASE_URL}/</loc>`);
  });

  it("protects the six live cohort source fields with frozen content hashes", async () => {
    const pages = publicSupportPages();
    const hashes = Object.fromEntries(
      PROTECTED_LIVE_COHORT_SLUGS.map((slug) => {
        const page = pages.find((item) => item.slug === slug);
        if (!page) throw new Error(`missing protected cohort page ${slug}`);
        return [slug, protectedSupportContentHash(page)];
      })
    );
    expect(hashes).toEqual(PROTECTED_LIVE_COHORT_HASHES);
    for (const slug of PROTECTED_LIVE_COHORT_SLUGS) {
      const page = pages.find((item) => item.slug === slug);
      if (!page) throw new Error(`missing ${slug}`);
      expect(protectedSupportContentHash({ ...page, title: `${page.title}x` })).not.toBe(hashes[slug]);
    }
  });

  it("publishes one crawlable knowledge hub and a non-duplicating GA4 search funnel", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-knowledge-funnel-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    const baseUrl = "https://example.com/laundry-social-auto-poster";
    await generatePublicSite({ root, baseUrl, now: "2026-07-10T03:00:00.000Z" });

    const docsRoot = join(root, "docs");
    const [sitemap, aiSitemap, home, hub, service, answer, analytics] = await Promise.all([
      readFile(join(docsRoot, "sitemap.xml"), "utf8"),
      readFile(join(docsRoot, "ai-sitemap.xml"), "utf8"),
      readFile(join(docsRoot, "index.html"), "utf8"),
      readFile(join(docsRoot, "knowledge", "index.html"), "utf8"),
      readFile(join(docsRoot, "services", "shoe-bag-care.html"), "utf8"),
      readFile(join(docsRoot, "guides", "shoe-odor-source.html"), "utf8"),
      readFile(join(docsRoot, "scripts", "search-content-analytics.js"), "utf8")
    ]);

    const knowledgeUrl = `${baseUrl}/knowledge/`;
    expect(sitemapLocs(sitemap).filter((url) => url === knowledgeUrl)).toHaveLength(1);
    const hubLastmod = sitemap.match(
      new RegExp(`<loc>${knowledgeUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}</loc><lastmod>([^<]+)</lastmod>`, "u")
    )?.[1];
    const visibleChildLastmods = [...sitemap.matchAll(
      /<loc>[^<]+\/(?:services|guides|local)\/[^<]+<\/loc><lastmod>([^<]+)<\/lastmod>/gu
    )].map((match) => match[1] ?? "");
    expect(hubLastmod).toBeDefined();
    expect(hubLastmod).toBe([...visibleChildLastmods, "2026-09-03"].sort().at(-1));
    expect(sitemap).not.toContain("/posts/");
    expect(aiSitemap).toContain("<!-- knowledge-hub -->");
    expect(hub).toContain(`<link rel="canonical" href="${knowledgeUrl}"`);
    expect(hub).toContain("<title>洗鞋洗包與衣物收送知識庫｜私享家洗衣店</title>");
    expect(hub).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(hub).toContain('"@type":"CollectionPage"');
    expect(hub).toContain('"@type":"ItemList"');
    expect(hub).toContain('data-analytics-page-type="knowledge_hub"');
    expect(hub).toContain("source=guide-knowledge-hub-cta");

    for (const page of publicSupportPages()) {
      expect(hub, page.path).toContain(`${baseUrl}/${page.path}`);
    }
    expect(home).toContain('data-analytics-page-type="home" data-analytics-content-id="home"');
    expect(home).toContain(`${knowledgeUrl}#knowledge-shoes`);
    expect(home).not.toContain(`${baseUrl}/guides/wool-knit-shrink-risk.html`);
    expect(hub).toContain(`${baseUrl}/guides/wool-knit-shrink-risk.html`);
    expect(service).toContain('data-analytics-page-type="service" data-analytics-content-id="shoe-bag-care"');
    expect(answer).toContain('data-analytics-page-type="answer" data-analytics-content-id="shoe-odor-source"');
    for (const html of [home, hub, service, answer]) {
      expect(html).toContain(`${baseUrl}/scripts/search-content-analytics.js`);
    }

    expect(() => assertSearchContentAnalyticsScript(analytics)).not.toThrow();
    for (const eventName of REQUIRED_SEARCH_CONTENT_EVENTS) {
      expect(analytics).toContain(`send("${eventName}"`);
    }
    expect(analytics).not.toContain('send("line_click"');
    expect(analytics).not.toContain('send("generate_lead"');
  });

  it("fails closed when any required search-funnel event is removed or a lead event is duplicated", () => {
    const clean = buildSearchContentAnalyticsScript();
    expect(() => assertSearchContentAnalyticsScript(clean)).not.toThrow();

    for (const eventName of REQUIRED_SEARCH_CONTENT_EVENTS) {
      const mutated = clean.replace(`send("${eventName}"`, `removed("${eventName}"`);
      expect(() => assertSearchContentAnalyticsScript(mutated), eventName).toThrow(
        `search-content analytics is missing required event: ${eventName}`
      );
    }

    expect(() => assertSearchContentAnalyticsScript(`${clean}\nsend("line_click");`)).toThrow(/must not duplicate/);
    expect(() => assertSearchContentAnalyticsScript(`${clean}\nsend("generate_lead");`)).toThrow(/confirmed conversion/);

    const disabledSender = clean.replace(
      'const send = (eventName, extra = {}) => {',
      'const send = (eventName, extra = {}) => { return;'
    );
    expect(() => assertSearchContentAnalyticsScript(disabledSender)).toThrow(/not reachable at runtime/);

    const missingPageType = clean.replace("page_type: pageType", "page_kind: pageType");
    expect(() => assertSearchContentAnalyticsScript(missingPageType)).toThrow(/missing runtime parameter: page_type/);
    const missingServiceId = clean.replace("service_id: targetUrl.pathname", "service_key: targetUrl.pathname");
    expect(() => assertSearchContentAnalyticsScript(missingServiceId)).toThrow(/missing runtime parameter: service_id/);
  });

  it("keeps knowledge-hub links correct when generated without a public base URL", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-knowledge-relative-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");
    await generatePublicSite({
      root,
      siteBaseUrl: "",
      imageBaseUrl: "",
      now: "2026-07-10T03:00:00.000Z"
    });

    const hub = await readFile(join(root, "docs", "knowledge", "index.html"), "utf8");
    expect(hub).toContain('href="../services/shoe-bag-care.html"');
    expect(hub).toContain('href="../guides/shoe-odor-source.html"');
    expect(hub).not.toMatch(/href="(?:services|guides|local)\//u);
  });

  it("keeps checked-in public feeds, calendars, HTML, and image metadata consistent", async () => {
    const docsRoot = join(process.cwd(), "docs");
    const [social, discovery, sitemap, imageMetadata] = await Promise.all([
      readFile(join(docsRoot, "social-posts.json"), "utf8").then((text) => JSON.parse(text)) as Promise<{
        posts: Array<{
          date: string;
          slot: number;
          topic: string;
          facebook_caption: string;
          instagram_caption: string;
          image_path: string;
          image_url: string;
        }>;
      }>,
      readFile(join(docsRoot, "ai-discovery.json"), "utf8").then((text) => JSON.parse(text)) as Promise<{
        generated_at: string;
        published_posts: Array<{
          date: string;
          slot: number;
          topic: string;
          facebook_caption: string;
          instagram_caption: string;
          image_url: string;
        }>;
      }>,
      readFile(join(docsRoot, "sitemap.xml"), "utf8"),
      readFile(join(process.cwd(), "docs-internal", "public-image-metadata.json"), "utf8")
        .then((text) => JSON.parse(text)) as Promise<{
          schema_version: number;
          images: Record<string, { width: number; height: number; webp_path: string }>;
        }>
    ]);

    const generatedParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(discovery.generated_at));
    const generatedDay = ["year", "month", "day"]
      .map((type) => generatedParts.find((part) => part.type === type)?.value ?? "")
      .join("-");
    const latestContentLastmod = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/gu)]
      .map((match) => match[1] ?? "")
      .sort()
      .at(-1);
    expect(generatedDay >= (latestContentLastmod ?? ""), "generated_at must not predate public content").toBe(true);

    const discoveryByKey = new Map(discovery.published_posts.map((post) => [`${post.date}-${post.slot}`, post]));
    expect(discoveryByKey.size).toBe(social.posts.length);
    const calendars = new Map<string, { slots: Array<Record<string, unknown>> }>();
    for (const post of social.posts) {
      const key = `${post.date}-${post.slot}`;
      expect(discoveryByKey.get(key), key).toMatchObject({
        topic: post.topic,
        facebook_caption: post.facebook_caption,
        instagram_caption: post.instagram_caption,
        image_url: post.image_url
      });
      if (!calendars.has(post.date)) {
        calendars.set(
          post.date,
          JSON.parse(await readFile(join(docsRoot, "content-calendar", `${post.date}.json`), "utf8")) as {
            slots: Array<Record<string, unknown>>;
          }
        );
      }
      const slot = calendars.get(post.date)?.slots.find((item) => item.slot === post.slot);
      expect(slot, key).toBeDefined();
      expect(slot?.topic, key).toBe(post.topic);
      expect(slot?.facebook_caption, key).toBe(post.facebook_caption);
      expect(slot?.instagram_caption, key).toBe(post.instagram_caption);
      if (slot?.media_type !== "mixed-carousel") {
        expect(String(slot?.local_image_path ?? "").replace(/^docs\//u, ""), key).toBe(post.image_path);
      }
    }

    expect(imageMetadata.schema_version).toBe(1);
    const referencedImages = new Set<string>();
    let binaryCheckedImages = 0;
    for (const loc of sitemapLocs(sitemap)) {
      const pathname = new URL(loc).pathname.replace(/^\//u, "");
      const htmlPath = pathname === "" ? join(docsRoot, "index.html") : pathname.endsWith("/")
        ? join(docsRoot, pathname, "index.html")
        : join(docsRoot, pathname);
      const html = await readFile(htmlPath, "utf8");
      for (const match of html.matchAll(/<img\b([^>]*)>/gu)) {
        const attributes = match[1] ?? "";
        const src = attributes.match(/\bsrc="([^"]+)"/u)?.[1];
        if (!src || !/\.png(?:$|\?)/iu.test(src)) continue;
        const assetPath = decodeURIComponent(new URL(src, "https://sixiangjialaundry.com/").pathname).replace(/^\//u, "");
        const metadata = imageMetadata.images[assetPath];
        expect(metadata, `${pathname} ${assetPath} metadata`).toBeDefined();
        if (!metadata) continue;
        referencedImages.add(assetPath);
        expect(attributes, `${pathname} ${assetPath}`).toContain(`width="${metadata.width}"`);
        expect(attributes, `${pathname} ${assetPath}`).toContain(`height="${metadata.height}"`);
        expect(metadata.webp_path, `${pathname} ${assetPath} webp metadata`).toBe(
          assetPath.replace(/\.png$/iu, ".webp")
        );
        expect(html, `${pathname} ${assetPath} webp source`).toContain(src.replace(/\.png(?=$|\?)/iu, ".webp"));

        const pngPath = join(docsRoot, assetPath);
        if (!(await exists(pngPath))) continue;
        const size = await pngPixelSize(pngPath);
        expect(size, `${pathname} ${assetPath} binary metadata`).toEqual({
          width: metadata.width,
          height: metadata.height
        });
        const webpPath = pngPath.replace(/\.png$/iu, ".webp");
        expect(await exists(webpPath), `${pathname} ${assetPath} webp binary`).toBe(true);
        binaryCheckedImages += 1;
      }
    }
    expect(referencedImages.size).toBeGreaterThan(100);
    expect(Object.keys(imageMetadata.images).sort()).toEqual([...referencedImages].sort());
    expect(binaryCheckedImages).toBeGreaterThan(0);
  });
});
