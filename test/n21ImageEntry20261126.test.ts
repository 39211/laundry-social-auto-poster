import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/**
 * N21（2026-11-26）Google 圖片／Lens 入口：9 頁主題示意圖＋首頁 12 張描述型 alt。
 * 工程CEO 裁定：換 body 圖、og:image、twitter:image、頁面主題節點
 * （WebPage.primaryImageOfPage、HowTo.image）；DryCleaningOrLaundry 店家圖陣列不動；
 * sitemap 不加 image:image、generator 不動；dateModified 不動。
 */
const ROOT = repoRootFromHere();
const SEO = join(ROOT, "seo-overrides");
const SITE = "https://sixiangjialaundry.com";
const CAPTION = "示意圖（AI 生成），不代表特定客件成果。";

type Entry = {
  page: string;
  file: string;
  width: number;
  height: number;
  alt: string;
  howto: boolean;
  dateModified: string;
};

const ENTRIES: Entry[] = [
  { page: "guides/plush-doll-cleaning", file: "plush-doll-seam-inspection-taichung.webp", width: 1200, height: 900, alt: "淺棕色絨毛泰迪熊坐在木桌上，一隻手捏起手臂的絨毛查看", howto: true, dateModified: "2026-10-15" },
  { page: "services/ironing-pressing", file: "dress-shirt-collar-ironing-taichung.webp", width: 1200, height: 900, alt: "淺藍色棉質襯衫平放在燙衣板上，用蒸氣熨斗整燙領子", howto: false, dateModified: "2026-10-26" },
  { page: "guides/blanket-washing", file: "fleece-blanket-thickness-check.webp", width: 1200, height: 900, alt: "一條摺好的灰色刷毛毛毯放在木桌上，用手捏起邊角看厚度", howto: false, dateModified: "2026-11-02" },
  { page: "guides/pu-leather-peeling", file: "pu-leather-bag-handle-peeling.webp", width: 1200, height: 900, alt: "黑色合成皮手提包的提把表層龜裂掉屑，碎屑落在木桌上", howto: false, dateModified: "2026-10-26" },
  { page: "guides/down-jacket-cleaning", file: "down-jacket-stitching-check.webp", width: 1200, height: 900, alt: "深藍色羽絨外套平放在木桌上，用手翻起袖口查看車縫線", howto: true, dateModified: "2026-10-22" },
  { page: "guides/suede-jacket-cleaning", file: "suede-jacket-nap-brushing.webp", width: 1200, height: 900, alt: "深棕色麂皮外套平放在木桌上，用軟毛刷順著毛流刷袖子", howto: false, dateModified: "2026-11-05" },
  { page: "guides/birkenstock-care", file: "cork-footbed-sandal-inspection.webp", width: 1200, height: 900, alt: "深棕色麂皮鞋帶的軟木鞋床涼鞋，手指著腳跟處發黑的鞋床", howto: true, dateModified: "2026-11-15" },
  { page: "guides/leather-jacket-care", file: "leather-jacket-mildew-spots-check.webp", width: 824, height: 618, alt: "深咖啡色皮衣的肩背縫線上有幾處淡淡的灰白霉點", howto: true, dateModified: "2026-09-29" },
  { page: "guides/new-shoe-dye-ruboff", file: "dark-sneaker-dye-transfer-sock.webp", width: 1200, height: 900, alt: "深藍色帆布鞋旁放著淺灰色襪子，襪底腳跟沾到藍色染料", howto: false, dateModified: "2026-10-27" },
];

/** 這 9 頁原本用的共用主圖；換完後只允許留在店家節點與既有 Service 節點。 */
const OLD_SHARED = [
  "fabric-storage-inspection",
  "fabric-storage-hero-product",
  "white-shoe-cleaning-hero",
  "shoe-bag-care-hero-product",
  "premium-laundry-depth",
];

const HOME_ALTS: Array<[string, string]> = [
  ["cx-item-clothing", "兩件米白色麻花針織毛衣摺好疊放在白色背景上"],
  ["cx-item-shoes", "一雙綁帶皮革休閒鞋並排擺放在淺色背景上"],
  ["cx-item-bag", "一個咖啡色荔枝紋皮革托特包，雙提把立起擺放"],
  ["cx-item-leather", "一件棕色皮革夾克，翻領拉鍊款平整展示在白色背景上"],
  ["cx-item-bedding", "一顆白色枕頭疊在摺好的白色羽絨被上"],
  ["cx-item-baby", "一張深灰色布面兒童汽車安全座椅，附五點式安全帶"],
  ["carousel-01-clothing-alt-02", "米色針織衫、白襯衫和駝色大衣摺好放在木桌上"],
  ["carousel-02-shoes", "木桌上排成一列的休閒鞋、麂皮短靴和棕色皮鞋，旁邊放著鞋刷"],
  ["carousel-03-luxury", "深咖啡色皮革手提包旁放著白色手套和灰色毛呢大衣"],
  ["cx-hero-luxury", "戴白手套的雙手捧著焦糖色皮革手提包檢查包身"],
  ["camp-newyear", "窗邊木桌上疊放摺好的白色羽絨被，旁邊有一盆水仙花"],
  ["post-06-baby-stroller", "洗護空間一角，收合的嬰兒推車停在布品收納推車旁"],
];

const BANNED = ["白鞋", "本店實拍", "實拍", "膠邊", "恢復原色", "保證", "如新", "煥然一新"];

function read(rel: string): string {
  return readFileSync(join(SEO, rel), "utf8");
}

type Node = Record<string, unknown>;

function graph(html: string): Node[] {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m, "JSON-LD block").not.toBeNull();
  return (JSON.parse(m![1]!) as { "@graph": Node[] })["@graph"];
}

function meta(html: string, attr: "property" | "name", key: string): string | undefined {
  const re = new RegExp(`<meta ${attr}="${key.replace(/[:]/g, "\\:")}" content="([^"]*)"`);
  return html.match(re)?.[1];
}

/** VP8（lossy）webp 的寬高。 */
function webpSize(buf: Buffer): { width: number; height: number; chunk: string } {
  expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buf.toString("ascii", 8, 12)).toBe("WEBP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, chunk };
  }
  if (chunk === "VP8X") {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), chunk };
  }
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), chunk };
  }
  throw new Error(`unknown webp chunk ${chunk}`);
}

describe("N21 圖檔：seo-overrides/assets/guides 只放 9 張 webp", () => {
  for (const e of ENTRIES) {
    it(`${e.file} 存在、小於 200KB、尺寸 ${e.width}×${e.height}`, () => {
      const path = join(SEO, "assets", "guides", e.file);
      const size = statSync(path).size;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(200 * 1024);
      const dims = webpSize(readFileSync(path));
      expect([dims.width, dims.height]).toEqual([e.width, e.height]);
    });
  }
});

describe("N21 C5-1：9 頁 figure 用新圖，alt 與圖說逐字相同", () => {
  for (const e of ENTRIES) {
    it(e.page, () => {
      const html = read(`${e.page}.html`);
      const url = `${SITE}/assets/guides/${e.file}`;
      const figures = html.match(/<figure class="service-photo">[\s\S]*?<\/figure>/g) ?? [];
      expect(figures).toHaveLength(1);
      const fig = figures[0] ?? "";
      expect(fig).not.toContain("<picture");
      expect(fig).not.toContain("<source");
      const imgs = fig.match(/<img\b[^>]*>/g) ?? [];
      expect(imgs).toHaveLength(1);
      const img = imgs[0] ?? "";
      expect(img).toContain(`src="${url}"`);
      expect(img).toContain(`alt="${e.alt}"`);
      expect(img).toContain(`width="${e.width}"`);
      expect(img).toContain(`height="${e.height}"`);
      // 主圖在首屏的 .hero-visual 裡，不加 lazy。
      expect(img).not.toContain('loading="lazy"');
      expect(fig).toContain(`<figcaption>${CAPTION}</figcaption>`);
      // figure 位在 .hero-visual 的「直接答案」之後。
      const heroAt = html.indexOf('<div class="hero-visual">');
      const answerAt = html.indexOf('<span class="eyebrow">直接答案</span>', heroAt);
      expect(heroAt).toBeGreaterThan(0);
      expect(answerAt).toBeGreaterThan(heroAt);
      expect(html.indexOf(fig)).toBeGreaterThan(answerAt);

      expect(meta(html, "property", "og:image")).toBe(url);
      expect(meta(html, "property", "og:image:width")).toBe(String(e.width));
      expect(meta(html, "property", "og:image:height")).toBe(String(e.height));
      expect(meta(html, "property", "og:image:alt")).toBe(e.alt);
      expect(meta(html, "name", "twitter:image")).toBe(url);
      expect(meta(html, "name", "twitter:image:alt")).toBe(e.alt);

      const nodes = graph(html);
      const expected = { "@type": "ImageObject", contentUrl: url, caption: e.alt, width: e.width, height: e.height };
      const webpage = nodes.find((n) => n["@type"] === "WebPage" && n["@id"] === `${SITE}/${e.page}.html#webpage`);
      expect(webpage?.primaryImageOfPage).toEqual(expected);
      const howto = nodes.find((n) => n["@type"] === "HowTo" && String(n["@id"]).startsWith(`${SITE}/${e.page}.html#`));
      if (e.howto) {
        expect(howto?.image).toEqual(expected);
      } else if (howto) {
        expect(howto.image).toBeUndefined();
      }
    });
  }
});

describe("N21 C5-2：9 頁不再用舊共用圖（店家與 Service 節點除外）", () => {
  for (const e of ENTRIES) {
    it(e.page, () => {
      const html = read(`${e.page}.html`);
      const withoutLd = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
      for (const old of OLD_SHARED) {
        expect(withoutLd, `${old} outside JSON-LD`).not.toContain(old);
      }
      const nodes = graph(html);
      for (const n of nodes) {
        if (n["@type"] === "DryCleaningOrLaundry" || n["@type"] === "Service") continue;
        const text = JSON.stringify(n);
        for (const old of OLD_SHARED) {
          expect(text, `${String(n["@type"])} still uses ${old}`).not.toContain(old);
        }
      }
      // 店家節點的 image 陣列不動，仍是共用店家圖，沒有混入新圖。
      const store = nodes.find((n) => n["@type"] === "DryCleaningOrLaundry");
      expect(Array.isArray(store?.image)).toBe(true);
      expect(JSON.stringify(store?.image)).not.toContain("/assets/guides/");
      expect(JSON.stringify(store?.image)).toContain("/assets/services/shoe-bag-care-hero-product.png");
    });
  }
});

describe("N21：換圖不動日期，文案沒有禁用字", () => {
  for (const e of ENTRIES) {
    it(e.page, () => {
      const html = read(`${e.page}.html`);
      const dates = [...html.matchAll(/"dateModified":"([^"]+)"/g)].map((m) => m[1]);
      expect(dates.length).toBeGreaterThan(0);
      for (const d of dates) expect(d).toBe(e.dateModified);
      for (const word of BANNED) {
        expect(e.alt).not.toContain(word);
      }
      expect(e.file).not.toMatch(/white|birken|moncler|burberry|lv/i);
    });
  }
  it("圖說沒有禁用字", () => {
    for (const word of BANNED) expect(CAPTION).not.toContain(word);
  });
});

describe("N21 C5-3：首頁 12 張描述型 alt，裝飾圖維持 alt=\"\"", () => {
  const html = read("index.html");
  // 只看「想送洗什麼？」選項（width=100）與 .r6-care-tabs 按鈕（width=240）縮圖；
  // 分頁主圖（width=1200）同 src、原本就有 alt，這次不動。
  for (const [key, alt] of HOME_ALTS) {
    it(key, () => {
      const re = new RegExp(`<img alt="([^"]*)" height="\\d+" loading="\\w+" src="/assets/services/sxj-r10-photos-${key}\\.webp" width="(?:100|240)"/>`, "g");
      const hits = [...html.matchAll(re)].map((m) => m[1]);
      expect(hits).toEqual([alt]);
      for (const word of BANNED) expect(alt).not.toContain(word);
    });
  }
  it("只剩 8 張 alt=\"\"：6 張 .r6-lens、1 張彈窗、1 張 .r10-peek", () => {
    const empty = html.match(/<img alt=""[^>]*>/g) ?? [];
    expect(empty).toHaveLength(8);
    expect(empty.filter((t) => t.includes("src="))).toHaveLength(0);
    expect(empty.filter((t) => t.includes("data-modal-image"))).toHaveLength(1);
    const lens = html.match(/class="r6-lens"[^>]*>\s*<img alt=""\/>/g) ?? [];
    expect(lens).toHaveLength(6);
    const peek = html.match(/class="r10-peek"[\s\S]{0,400}?<img alt=""\/>/g) ?? [];
    expect(peek).toHaveLength(1);
    const modal = html.match(/id="r6-post-dialog"[\s\S]*?<img alt="" data-modal-image=""\/>/g) ?? [];
    expect(modal).toHaveLength(1);
  });
});
