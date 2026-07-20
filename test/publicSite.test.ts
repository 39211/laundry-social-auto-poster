import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";

async function writeCalendar(root: string, date: string): Promise<void> {
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
          visual_route: "shop-inspection",
          traffic_route: "object-proof",
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

describe("generatePublicSite", () => {
  it("writes AI-readable public indexes with absolute URLs when a base URL is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
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
      title: "私享家洗衣店｜台中西屯門市・台中全市免費洗衣收送",
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
    expect(index.entrypoints.llms_jsonl).toBe("https://example.com/laundry-social-auto-poster/llms.jsonl");
    expect(index.entrypoints.service_pages).toEqual({
      "shoe-bag-care": "https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html",
      "white-shoe-cleaning": "https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html",
      "fabric-storage": "https://example.com/laundry-social-auto-poster/services/fabric-storage.html",
      "taichung-xitun-laundry": "https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html",
      "taichung-citywide-laundry-pickup":
        "https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html"
    });
    expect(index.entrypoints.knowledge_graph).toBe("https://example.com/laundry-social-auto-poster/knowledge-graph.json");
    expect(index.entrypoints.well_known_ai).toBe("https://example.com/laundry-social-auto-poster/.well-known/ai.json");
    expect(notFoundHtml).toContain('name="robots" content="noindex, follow"');
    expect(notFoundHtml).toContain('http-equiv="refresh" content="0; url=https://example.com/laundry-social-auto-poster/"');
    expect(notFoundHtml).toContain('window.location.replace("https://example.com/laundry-social-auto-poster/")');
    expect(compatibilityDocsHtml).toContain('http-equiv="refresh" content="0; url=https://example.com/laundry-social-auto-poster/"');
    expect(index.posts[0].image_url).toBe("https://example.com/laundry-social-auto-poster/assets/2026-07-02/slot-01.png");
    expect(index.posts[0].hashtags).toEqual(["#test"]);
    expect(index.posts[0]).toMatchObject({
      id: "https://example.com/laundry-social-auto-poster/content-calendar/2026-07-02.json#post-2026-07-02-slot-01",
      date_published: "2026-07-02T11:30:00+08:00",
      platforms: ["facebook", "instagram"],
      in_language: "zh-Hant"
    });
    expect(latest.canonical_url).toBe("https://example.com/laundry-social-auto-poster/");
    expect(latest.date).toBe("2026-07-02");
    expect(latest.posts[0].hashtags).toEqual(["#test"]);
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.title).toBe("私享家洗衣店｜台中西屯門市・台中全市免費洗衣收送");
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
    expect(services.services).toHaveLength(5);
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
      sameAs: [
        "https://www.facebook.com/100083194756904/",
        "https://www.instagram.com/si_xiang_jia/"
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
    expect(discovery.service_pages).toHaveLength(5);
    expect(discovery.service_pages[0]).toMatchObject({
      slug: "shoe-bag-care",
      name: "鞋包清潔",
      url: "https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html",
      answer_summary: "台中西屯洗鞋洗包建議先拍鞋面、鞋底、包角、提把與內裡，私享家會依材質、濕氣、水痕與磨耗程度判斷清潔方式與可改善範圍。",
      image_url: "https://example.com/laundry-social-auto-poster/assets/services/shoe-bag-care-hero-product.png",
      image_alt: "鞋包清潔前的包角、鞋面與皮革檢查主圖",
      faq_count: 4
    });
    expect(discovery.data_quality.all_posts_have_hashtags).toBe(true);
    expect(discovery.latest_posts[0].hashtags).toEqual(["#test"]);
    expect(wellKnownAi).toEqual(discovery);
    expect(llms).toContain("[Full structured post feed](https://example.com/laundry-social-auto-poster/social-posts.json)");
    expect(llms).toContain("[Business profile](https://example.com/laundry-social-auto-poster/business-profile.json)");
    expect(llms).toContain("[Services JSON](https://example.com/laundry-social-auto-poster/services.json)");
    expect(llms).toContain("[Answers JSON](https://example.com/laundry-social-auto-poster/answers.json)");
    expect(llms).toContain("[Geo targets JSON](https://example.com/laundry-social-auto-poster/geo-targets.json)");
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
    expect(robots).toContain("Allow: /services.json");
    expect(robots).toContain("Allow: /answers.json");
    expect(robots).toContain("Allow: /geo-targets.json");
    expect(robots).toContain("Allow: /llms.jsonl");
    expect(robots).toContain("Allow: /llms-full.txt");
    expect(robots).toContain("Sitemap: https://example.com/laundry-social-auto-poster/sitemap.xml");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/shoe-bag-care.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/white-shoe-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/fabric-storage.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/services/taichung-xitun-laundry.html</loc>");
    expect(sitemap).toContain(
      "<loc>https://example.com/laundry-social-auto-poster/services/taichung-citywide-laundry-pickup.html</loc>"
    );
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/posts/2026-07-02-slot-01.html</loc>");
    expect(sitemap).not.toContain("<priority>");
    expect(sitemap).not.toContain("<changefreq>");
    expect(sitemap).not.toContain("index.html");
    expect(sitemap).not.toContain(".json");
    expect(sitemap).not.toContain("llms");
    expect(sitemap).not.toContain("/assets/");
    expect(aiSitemap).toContain("<!-- answer-engine-records -->");
    expect(aiSitemap).toContain("<!-- calendar-slot-1 -->");
    expect(aiSitemap).toContain("<!-- published-post-1 -->");
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
    expect(html).toContain('<title>私享家洗衣店｜台中西屯門市・台中全市免費洗衣收送</title>');
    expect(html).toContain('name="description" content="私享家洗衣店門市在台中市西屯區青海路二段365號');
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain('hreflang="zh-Hant-TW"');
    expect(html).toContain('property="og:title" content="私享家洗衣店｜台中西屯門市・台中全市免費洗衣收送"');
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
    expect(html).toContain("<h1>台中西屯洗衣門市，台中全市免費洗衣收送</h1>");
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
    expect(shoeBagCareHtml).toContain("<title>鞋包清潔｜台中西屯洗鞋、洗包與材質照護｜私享家洗衣店</title>");
    expect(shoeBagCareHtml).toContain("<h1>鞋包清潔</h1>");
    expect(shoeBagCareHtml).toContain(">店家資料</a>");
    expect(shoeBagCareHtml).toContain("店家資訊");
    expect(shoeBagCareHtml).toContain("常見問題");
    expect(shoeBagCareHtml).toContain("台中西屯洗鞋洗包建議先拍鞋面、鞋底、包角、提把與內裡");
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
    expect(taichungXitunLaundryHtml).not.toContain('class="service-photo"');
    expect(taichungCitywidePickupHtml).toContain("<title>台中全市免費洗衣收送｜私享家洗衣店 LINE 預約</title>");
    expect(taichungCitywidePickupHtml).toContain("<h1>台中全市免費洗衣收送</h1>");
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
      "qinghai-road-shoe-cleaning": "https://example.com/laundry-social-auto-poster/local/qinghai-road-shoe-cleaning.html"
    });
    expect(
      services.services
        .find((service: { slug: string }) => service.slug === "fabric-storage")
        .related_support_pages.map((page: { slug: string }) => page.slug)
    ).toEqual(expect.arrayContaining(["bedding-storage-check", "bedding-duvet-cleaning"]));
    expect(services.services.find((service: { slug: string }) => service.slug === "shoe-bag-care").related_support_pages).toHaveLength(3);
    expect(services.services.find((service: { slug: string }) => service.slug === "white-shoe-cleaning").related_support_pages).toHaveLength(1);
    expect(services.services.every((service: { case_studies?: unknown[] }) => service.case_studies?.length === 3)).toBe(true);
    expect(answers.answers.some((answer: { source_url: string }) => answer.source_url.endsWith("/guides/photo-before-laundry.html"))).toBe(true);
    expect(answers.answers.some((answer: { source_url: string }) => answer.source_url.endsWith("/local/qinghai-road-shoe-cleaning.html"))).toBe(true);
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
    expect(discovery.support_pages).toHaveLength(10);
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
    expect(robots).toContain("Allow: /guides/");
    expect(robots).toContain("Allow: /local/");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/photo-before-laundry.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/shirt-suit-dry-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/bedding-duvet-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/plush-doll-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/guides/luxury-dry-cleaning.html</loc>");
    expect(sitemap).toContain("<loc>https://example.com/laundry-social-auto-poster/local/qinghai-road-shoe-cleaning.html</loc>");
    expect(aiSitemap).toContain("<!-- guide-page-photo-before-laundry -->");
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
    expect(localShoePageHtml).toContain("shoe-bag-care.html");
    expect(localShoePageHtml).toContain("https://example.com/laundry-social-auto-poster/#business");
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
    expect(sitemap).toContain("posts/2026-07-02-slot-01.html");
    expect(sitemap).not.toContain("posts/2026-07-03-slot-01.html");
    expect(await exists(join(root, "docs", "posts", "2026-07-03-slot-01.html"))).toBe(false);
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
    expect(sitemap).toContain("posts/2026-07-04-slot-01.html");
    expect(sitemap).toContain("posts/2026-07-04-slot-02.html");
    expect(sitemap).not.toContain("posts/2026-07-05-slot-01.html");
    expect(sitemap).not.toContain("posts/2026-07-05-slot-02.html");
    expect(aiSitemap).toContain("posts/2026-07-04-slot-01.html");
    expect(aiSitemap).toContain("posts/2026-07-04-slot-02.html");
    expect(aiSitemap).not.toContain("posts/2026-07-05-slot-01.html");
    expect(aiSitemap).not.toContain("posts/2026-07-05-slot-02.html");
    expect(await exists(join(root, "docs", "posts", "2026-07-04-slot-01.html"))).toBe(true);
    expect(await exists(join(root, "docs", "posts", "2026-07-04-slot-02.html"))).toBe(true);
    expect(await exists(join(root, "docs", "posts", "2026-07-05-slot-01.html"))).toBe(false);
    expect(await exists(join(root, "docs", "posts", "2026-07-05-slot-02.html"))).toBe(false);
    expect((html.match(/class="post-tile post-card"/g) ?? [])).toHaveLength(4);
    expect(html).toContain("posts/2026-07-04-slot-01.html");
    expect(html).toContain("content-calendar/2026-07-05.json");
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
    const oaiBlock = robots.split("User-agent: OAI-SearchBot").at(1)?.split("User-agent:").at(0) ?? "";

    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(oaiBlock).toContain("Allow: /llms.txt");
    expect(oaiBlock).toContain("Allow: /llms-lite.txt");
    expect(oaiBlock).toContain("Allow: /llms-full.txt");
    expect(oaiBlock).toContain("Allow: /services.json");
    expect(oaiBlock).toContain("Allow: /answers.json");
    expect(oaiBlock).toContain("Allow: /geo-targets.json");
    expect(oaiBlock).toContain("Allow: /llms.jsonl");
    expect(oaiBlock).toContain("Allow: /feed.json");
    expect(oaiBlock).toContain("Allow: /knowledge-graph.json");
    expect(oaiBlock).toContain("Allow: /guides/");
    expect(oaiBlock).toContain("Allow: /local/");
  });

  it("publishes citywide free pickup page with internal links, schema, sitemap, and stable lastmod", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-public-site-citywide-pickup-"));
    await writeBusinessProfile(root);
    await writeCalendar(root, "2026-07-02");
    await writeApprovalLog(root, "2026-07-02");

    const baseUrl = "https://example.com/laundry-social-auto-poster";
    const pickupPath = "services/taichung-citywide-laundry-pickup.html";
    const pickupUrl = `${baseUrl}/${pickupPath}`;

    await generatePublicSite({
      root,
      baseUrl,
      now: "2026-07-10T03:00:00.000Z"
    });

    const homepage = await readFile(join(root, "docs", "index.html"), "utf8");
    const pickupHtml = await readFile(join(root, "docs", pickupPath), "utf8");
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
    expect(homepage).toContain('<time datetime="2026-07-20">2026-07-20</time>');
    expect(homepage).toContain('"name":"台中市"');
    expect(homepage).not.toContain('"price":0');
    expect(homepage).not.toContain('"price":"0"');

    expect(pickupHtml).toContain("<h1>台中全市免費洗衣收送</h1>");
    expect(pickupHtml).toContain("收送範圍為台中市");
    expect(pickupHtml).toContain("收送本身免費");
    expect(pickupHtml).toContain("https://line.me/ti/p/4m-rA6hxf6");
    expect(pickupHtml).toContain("西屯區青海路二段365號");
    expect(pickupHtml).toContain('"@type":"Service"');
    expect(pickupHtml).toContain('"@type":"AdministrativeArea"');
    expect(pickupHtml).toContain('"name":"台中市"');
    expect(pickupHtml).toContain('"mainEntityOfPage":{"@id":"' + pickupUrl + '#webpage"}');
    expect(pickupHtml).toContain('class="breadcrumb"');
    expect(pickupHtml).toContain('<time datetime="2026-07-20">2026-07-20</time>');
    expect(pickupHtml).toContain("相關送洗指南");
    expect(pickupHtml).toContain(`${baseUrl}/guides/photo-before-laundry.html`);
    expect(pickupHtml).not.toContain('"price":0');
    expect(pickupHtml).not.toContain('"price":"0"');

    expect(sitemap1).toContain(`<loc>${pickupUrl}</loc>`);
    // Posts keep publication-day lastmod; intentional content pages keep 2026-07-20.
    expect(sitemap1).toContain("<lastmod>2026-07-02</lastmod>");
    expect(sitemap1).toContain("<lastmod>2026-07-20</lastmod>");
    expect(sitemap1).not.toContain("<lastmod>2026-07-10T03:00:00.000Z</lastmod>");
    expect(sitemap1).toMatch(
      new RegExp(
        `<loc>${baseUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/</loc><lastmod>2026-07-20</lastmod>`
      )
    );
    expect(sitemap1).toMatch(
      new RegExp(
        `<loc>${pickupUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}</loc><lastmod>2026-07-20</lastmod>`
      )
    );
    expect(sitemap1).toMatch(
      /posts\/2026-07-02-slot-01\.html<\/loc><lastmod>2026-07-02<\/lastmod>/
    );

    // Static service pages without explicit content_lastmod must omit lastmod (no invented default).
    const shoeBagEntry =
      sitemap1.match(
        new RegExp(
          `<url><loc>${baseUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/services/shoe-bag-care\\.html</loc>(.*?)</url>`,
          "u"
        )
      )?.[1] ?? "";
    expect(shoeBagEntry).not.toContain("<lastmod>");
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

    expect(homepageDateModified1).toBe("2026-07-20");
    expect(pickupDateModified1).toBe("2026-07-20");
    // Unknown static pages omit dateModified rather than using build generated_at.
    expect(shoeBagDateModified1).toBeUndefined();
    expect(guideDateModified1).toBeUndefined();
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
    expect(findWebPageDateModified(shoeBagHtml2)).toBeUndefined();
    expect(findArticleDateModified(postHtml2)).toBe(postDateModified1);
    expect(sitemap2).not.toContain("<lastmod>2026-07-18T12:00:00.000Z</lastmod>");
    expect(sitemap2).not.toContain("<lastmod>2026-07-18</lastmod>");
    expect(homepage2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);
    expect(pickupHtml2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);
    expect(postHtml2).not.toContain(`"dateModified":"2026-07-18T12:00:00.000Z"`);

    const serviceLastmodsWithDate = [
      ...sitemap2.matchAll(/services\/[^<]+<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/gu)
    ].map((match) => match[1]);
    expect(serviceLastmodsWithDate.every((day) => day === "2026-07-20")).toBe(true);
    expect(serviceLastmodsWithDate.length).toBe(1);
  });
});
