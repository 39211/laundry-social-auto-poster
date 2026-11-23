import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";
import { OFFER_CATALOG_AREA_SERVED, OFFER_CATALOG_COPY } from "../src/offerCatalogCopy";

/**
 * N19（2026-11-22）：#business 共用服務目錄（#offer-catalog）與 7 個價格頁的 #reference-prices。
 * 文案是行銷經理 11/22 裁定逐字句；條件是工程CEO 11/22 准做。
 */
const ROOT = repoRootFromHere();
const OVERRIDES = join(ROOT, "seo-overrides");
const BASE = "https://sixiangjialaundry.com/";
const CATALOG_ID = `${BASE}#offer-catalog`;
const CATALOG_NAME = "私享家洗衣店服務目錄";
const SLUG_ORDER = [
  "shoe-bag-care",
  "white-shoe-cleaning",
  "fabric-storage",
  "taichung-xitun-laundry",
  "business-bulk-laundry",
  "taichung-citywide-laundry-pickup",
  "taichung-laundry-price-list"
] as const;
const FORBIDDEN_TYPES = ["Product", "Review", "AggregateRating"];
const FORBIDDEN_KEYS = ["availability", "priceValidUntil", "aggregateRating", "review"];
const BANNED_WORDS = ["保證", "全新", "恢復原色", "除臭", "殺菌", "除蟎", "防水", "賠", "退單", "不下水", "100%", "如新", "陰乾", "本店實拍"];

const PRICE_PAGES = {
  "guides/jacket-cleaning-price": { leather: false, count: 8 },
  "guides/leather-garment-cleaning-price": { leather: true, count: 2 },
  "guides/leather-shoe-cleaning-price": { leather: true, count: 1 },
  "guides/luxury-garment-cleaning-price": { leather: false, count: 3 },
  "services/shoe-bag-care": { leather: false, count: 3 },
  "guides/bag-cleaning-price": { leather: false, count: 5 },
  "guides/taichung-shoe-cleaning-price": { leather: false, count: 5 }
} as const;
const LEATHER_ITEMS = new Set(["皮衣", "特殊皮衣", "皮鞋", "麂皮鞋", "皮包", "名牌包", "特殊類名牌包"]);

type Json = Record<string, unknown>;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((m) => JSON.parse(m[1] ?? ""));
}

function walk(value: unknown, visit: (node: Json, key: string | undefined) => void, key?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key);
    return;
  }
  if (value && typeof value === "object") {
    visit(value as Json, key);
    for (const [k, v] of Object.entries(value as Json)) walk(v, visit, k);
  }
}

function visibleText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/u)?.[1] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gu, "")
    .replace(/<style[\s\S]*?<\/style>/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replace(/\s+/gu, " ");
}

function expectedCatalog(): Json {
  return {
    "@type": "OfferCatalog",
    "@id": CATALOG_ID,
    name: CATALOG_NAME,
    itemListElement: SLUG_ORDER.map((slug) => ({ slug, ...OFFER_CATALOG_COPY[slug] }))
  };
}

const files = htmlFiles(OVERRIDES);
const pages = files.map((file) => ({ rel: relative(OVERRIDES, file), html: readFileSync(file, "utf8") }));

describe("N19 #offer-catalog 全站一份", () => {
  it("所有 override HTML 的 JSON-LD 都能 parse", () => {
    for (const page of pages) expect(() => jsonLdBlocks(page.html), page.rel).not.toThrow();
  });

  it("文案表剛好 7 格，對應 7 個服務頁", () => {
    expect(Object.keys(OFFER_CATALOG_COPY).sort()).toEqual([...SLUG_ORDER].sort());
    expect(OFFER_CATALOG_AREA_SERVED).toEqual({ "@type": "AdministrativeArea", name: "台中市" });
  });

  it("168 頁嵌的目錄都是同一份：@id、7 句文案、areaServed 台中市，與 generator 文案表一致", () => {
    const expected = expectedCatalog();
    let pagesWithCatalog = 0;
    for (const page of pages) {
      const catalogs: Json[] = [];
      const idNodes: Json[] = [];
      for (const block of jsonLdBlocks(page.html)) {
        walk(block, (node, key) => {
          if (key === "hasOfferCatalog" && node.name === CATALOG_NAME) catalogs.push(node);
          if (node["@id"] === CATALOG_ID) idNodes.push(node);
          if (node.name === CATALOG_NAME && key !== "hasOfferCatalog") throw new Error(`${page.rel} 目錄不在 hasOfferCatalog 下`);
        });
      }
      if (catalogs.length === 0) {
        expect(idNodes, page.rel).toHaveLength(0);
        continue;
      }
      pagesWithCatalog += 1;
      expect(catalogs, page.rel).toHaveLength(1);
      expect(idNodes, page.rel).toHaveLength(1);
      const catalog = catalogs[0]!;
      expect(catalog["@id"], page.rel).toBe(expected["@id"]);
      const items = catalog.itemListElement as Json[];
      expect(items, page.rel).toHaveLength(7);
      SLUG_ORDER.forEach((slug, i) => {
        const offer = items[i]!;
        const service = offer.itemOffered as Json;
        const copy = OFFER_CATALOG_COPY[slug]!;
        expect(service.url, page.rel).toBe(`${BASE}services/${slug}.html`);
        expect(service.description, `${page.rel} ${slug}`).toBe(copy.description);
        expect(service.areaServed, `${page.rel} ${slug}`).toEqual({ "@type": "AdministrativeArea", name: "台中市" });
        if (copy.offer) {
          expect(offer.name, page.rel).toBe(copy.offer.name);
          expect(offer.description, page.rel).toBe(copy.offer.description);
        } else {
          expect(offer.name, page.rel).toBeUndefined();
          expect(offer.description, page.rel).toBeUndefined();
        }
        expect("price" in offer, page.rel).toBe(false);
      });
    }
    expect(pagesWithCatalog).toBe(206);
  });

  it("西屯只留在西屯洗衣店那格與收送那格的門市地址；areaServed 沒有西屯", () => {
    for (const [slug, copy] of Object.entries(OFFER_CATALOG_COPY)) {
      if (slug === "taichung-xitun-laundry" || slug === "taichung-citywide-laundry-pickup") continue;
      expect(copy.description, slug).not.toContain("西屯");
      expect(copy.description, slug).not.toContain("逢甲");
    }
    // 收送那格維持線上原文（行銷：不動），只有門市地址與「不限西屯一區」提到西屯。
    expect(OFFER_CATALOG_COPY["taichung-citywide-laundry-pickup"]?.description).toContain("門市在西屯區青海路二段365號");
  });

  it("目錄文案沒有禁字，也不寫「皆為水洗參考價」", () => {
    for (const [slug, copy] of Object.entries(OFFER_CATALOG_COPY)) {
      const text = `${copy.description}${copy.offer?.description ?? ""}`;
      for (const word of BANNED_WORDS) expect(text, `${slug} ${word}`).not.toContain(word);
      expect(text, slug).not.toContain("皆為水洗參考價");
    }
  });
});

describe("N19 價格頁 #reference-prices", () => {
  for (const [rel, spec] of Object.entries(PRICE_PAGES)) {
    it(`${rel}：只放可見參考價，起價用 minPrice，沒有禁用欄位`, () => {
      const html = readFileSync(join(OVERRIDES, `${rel}.html`), "utf8");
      const visible = visibleText(html);
      const url = `${BASE}${rel}.html`;
      const nodes: Json[] = [];
      for (const block of jsonLdBlocks(html)) {
        walk(block, (node, key) => {
          if (node["@id"] === `${url}#reference-prices` && node["@type"] === "OfferCatalog") nodes.push(node);
          if (typeof node["@type"] === "string") expect(FORBIDDEN_TYPES, `${rel} @type`).not.toContain(node["@type"]);
          for (const k of FORBIDDEN_KEYS) expect(k in node, `${rel} ${k}`).toBe(false);
          void key;
        });
      }
      expect(nodes, rel).toHaveLength(1);
      const catalog = nodes[0]!;
      const offers = catalog.itemListElement as Json[];
      expect(offers, rel).toHaveLength(spec.count);
      const description = String(catalog.description);
      expect(description, rel).toContain("參考價");
      expect(description, rel).toContain("看過實品再報價");
      for (const word of BANNED_WORDS) expect(description, `${rel} ${word}`).not.toContain(word);
      if (spec.leather) expect(JSON.stringify(catalog), rel).not.toContain("水洗");
      for (const offer of offers) {
        const name = String(offer.name);
        expect(offer["@type"]).toBe("Offer");
        expect(offer.priceCurrency, `${rel} ${name}`).toBe("TWD");
        expect(offer.description, `${rel} ${name}`).toBe(description);
        expect((offer.itemOffered as Json).provider, `${rel} ${name}`).toEqual({ "@id": `${BASE}#business` });
        if (LEATHER_ITEMS.has(name)) expect(String(offer.description), `${rel} ${name}`).not.toContain("水洗");
        const spec2 = offer.priceSpecification as Json | undefined;
        if (spec2) {
          expect("price" in offer, `${rel} ${name}`).toBe(false);
          expect(spec2.priceCurrency).toBe("TWD");
          const min = Number(spec2.minPrice);
          // 「起」的價：可見正文要有「品項 … $N 起」。
          expect(visible, `${rel} ${name} $${min} 起`).toMatch(new RegExp(`${name}[^$。；]{0,12}\\$${min} 起`, "u"));
          expect(description, `${rel} ${name}`).toContain(`$${min} 起`);
        } else {
          const price = Number(offer.price);
          expect(Number.isInteger(price) && price > 0, `${rel} ${name}`).toBe(true);
          // 品項名稱後面 12 字內接著該價格，且不是「起」價。
          expect(visible, `${rel} ${name} $${price}`).toMatch(new RegExp(`${name}[^$。；]{0,12}\\$${price}(?![0-9])(?! 起)`, "u"));
        }
      }
    });
  }

  it("名牌包不寫死 price:1500", () => {
    const html = readFileSync(join(OVERRIDES, "guides/bag-cleaning-price.html"), "utf8");
    expect(html).not.toMatch(/"name":"名牌包","description":"[^"]*","priceCurrency":"TWD","price":1500/u);
  });

  it("價目表 #price-catalog 仍是 110 筆，且每筆品名與金額完全對齊 data/prices.json，皮類不寫水洗", () => {
    const html = readFileSync(join(OVERRIDES, "services/taichung-laundry-price-list.html"), "utf8");
    const pricesJson = JSON.parse(readFileSync(join(ROOT, "data/prices.json"), "utf8")) as Record<
      string,
      Record<string, number | string>
    >;
    const flatPrices = new Map<string, number | string>();
    for (const [cat, group] of Object.entries(pricesJson)) {
      if (cat === "note" || typeof group !== "object" || !group) continue;
      for (const [itemName, val] of Object.entries(group)) {
        flatPrices.set(itemName, val);
        if (itemName === "修改") flatPrices.set("改衣", val);
      }
    }

    const catalogOffers: Json[] = [];
    for (const block of jsonLdBlocks(html)) {
      walk(block, (node) => {
        if (node["@id"] === `${BASE}services/taichung-laundry-price-list.html#price-catalog` && Array.isArray(node.itemListElement)) {
          walk(node.itemListElement, (child) => {
            if (child["@type"] === "Offer") catalogOffers.push(child);
          });
        }
      });
    }
    expect(catalogOffers).toHaveLength(110);

    const leatherInPriceList = new Set([
      "皮類運動鞋",
      "麂皮鞋",
      "名牌鞋",
      "皮鞋",
      "名牌包",
      "特殊類名牌包",
      "皮衣",
      "特殊皮衣",
      "皮背心",
      "皮褲",
      "皮裙",
      "皮短褲",
      "皮帽子",
      "皮帶"
    ]);

    for (const offer of catalogOffers) {
      const name = String(offer.name);
      const expected = flatPrices.get(name);
      expect(expected, `data/prices.json missing ${name}`).toBeDefined();
      const desc = String(offer.description ?? "");
      if (leatherInPriceList.has(name)) {
        expect(desc, `#price-catalog ${name}`).not.toContain("水洗");
        expect(desc, `#price-catalog ${name}`).toContain("清潔參考價");
      }
      if (name === "名牌包") {
        expect("price" in offer).toBe(false);
        expect((offer.priceSpecification as Json)?.minPrice).toBe(1500);
      } else if (name === "改衣") {
        expect("price" in offer).toBe(false);
        expect((offer.priceSpecification as Json)?.minPrice).toBe(60);
      } else {
        expect(offer.price, name).toBe(expected);
      }
    }
  });

  it("皮鞋與皮衣價格頁 #reference-prices 補齊乾洗柔洗、發霉、特殊污漬與修繕另計條件，且全頁無「水洗」", () => {
    const shoeHtml = readFileSync(join(OVERRIDES, "guides/leather-shoe-cleaning-price.html"), "utf8");
    expect(shoeHtml).not.toContain("水洗");
    const shoeNode = jsonLdBlocks(shoeHtml)
      .flatMap((block) => ((block as Json)["@graph"] as Json[] | undefined) ?? [])
      .find((n) => n["@id"] === `${BASE}guides/leather-shoe-cleaning-price.html#reference-prices`);
    expect(shoeNode?.description).toBe(
      "皮鞋清潔參考價 $400；乾洗、柔洗另計，發霉、特殊污漬與特殊材質要看過實品再報價；補色、修補另計，屬修繕，不包含在清潔內。"
    );

    const garmentHtml = readFileSync(join(OVERRIDES, "guides/leather-garment-cleaning-price.html"), "utf8");
    expect(garmentHtml).not.toContain("水洗");
    const garmentNode = jsonLdBlocks(garmentHtml)
      .flatMap((block) => ((block as Json)["@graph"] as Json[] | undefined) ?? [])
      .find((n) => n["@id"] === `${BASE}guides/leather-garment-cleaning-price.html#reference-prices`);
    expect(garmentNode?.description).toBe(
      "皮衣清潔參考價 $1200、特殊皮衣 $2000；乾洗、柔洗另計，皮革發霉與特殊污漬要看過實品再報價。"
    );
  });
});

describe("N19 JSON-LD 的「台中全市」只出現在完整核定句", () => {
  const SENTENCE = "台中全市免費收送、沒有最低消費";

  it("所有 override 頁的 ld+json 裡，每個「台中全市」都屬於「台中全市免費收送、沒有最低消費」", () => {
    let sentences = 0;
    for (const page of pages) {
      for (const m of page.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)) {
        const block = m[1] ?? "";
        sentences += block.split(SENTENCE).length - 1;
        expect(block.replaceAll(SENTENCE, ""), page.rel).not.toContain("台中全市");
      }
    }
    // 168 頁 × 目錄裡 3 句（鞋包清潔、台中西屯洗衣店、店家大量）
    expect(sentences).toBeGreaterThanOrEqual(168 * 3);
  });

  it("generator 目錄文案表也只用完整核定句", () => {
    for (const [slug, copy] of Object.entries(OFFER_CATALOG_COPY)) {
      const text = `${copy.description}${copy.offer?.name ?? ""}${copy.offer?.description ?? ""}`;
      expect(text.replaceAll(SENTENCE, ""), slug).not.toContain("台中全市");
    }
  });
});

describe("N19 包包價格頁發霉句", () => {
  it("description 用頁面可見原句，不再寫「發霉、特殊污漬另計」", () => {
    const html = readFileSync(join(OVERRIDES, "guides/bag-cleaning-price.html"), "utf8");
    const clause = "發霉、特殊污漬與特殊材質要看過實品再報價";
    expect(visibleText(html)).toContain(clause);
    const node = jsonLdBlocks(html)
      .flatMap((block) => ((block as Json)["@graph"] as Json[] | undefined) ?? [])
      .find((n) => n["@id"] === `${BASE}guides/bag-cleaning-price.html#reference-prices`);
    expect(node?.description).toBe(
      "包包參考價：背包 $500、一般包 $600、皮包 $1000、名牌包 $1500 起、特殊類名牌包 $2500；乾洗、柔洗另計，發霉、特殊污漬與特殊材質要看過實品再報價。"
    );
    expect(html).not.toContain("發霉、特殊污漬另計");
  });
});
