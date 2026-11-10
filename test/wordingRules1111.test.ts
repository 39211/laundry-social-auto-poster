import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "seo-overrides");

/** 凍結基準頁（雜湊鎖）、首頁與 r10 頁不在本批範圍，待老闆／工程CEO 另行決定。 */
const OUT_OF_SCOPE_SLUGS = new Set(
  "suede-shoe-cleaning canvas-shoe-mud leather-shoe-water-marks shoe-odor-source washing-machine-shoe-risk athletic-shoe-mixed-materials shoe-mold-surface-check shoe-sole-separation-limit bag-color-transfer bag-ink-marks bag-lining-care nylon-bag-care canvas-bag-care backpack-cleaning-check bag-clean-vs-repair wool-coat-dry-clean wool-knit-shrink-risk clothing-mold-airing vacuum-bag-storage-risk oil-vs-water-stain-choice blanket-damp-check post-wash-drying-before-storage synthetic-vs-leather-handle rainy-bag-care luggage-wheel-cleaning curtain-cleaning carpet-cleaning fengjia-laundry-pickup zhongke-office-laundry donghai-laundry-pickup sticky-bag-lining suede-bag-care lambskin-bag-care leather-belt-care shoe-drying-heat-risk".split(
    " "
  )
);
/** 近 72 小時（2026-11-08 起）title 改過或新上的頁：衡量期內不動 title、meta description 與同句正文。2026-11-14 後移除此清單並補處理。 */
const TITLE_FREEZE = new Set([
  "guides/birkenstock-care.html",
  "guides/down-jacket-cleaning.html",
  "guides/down-jacket-feather-leak.html",
  "guides/dress-shirt-starch-risk.html",
  "guides/faux-fur-collar-cleaning.html",
  "guides/fleece-jacket-pilling.html",
  "guides/knit-shoulder-bump-stretch.html",
  "guides/lambskin-bag-care.html",
  "guides/luxury-down-jacket-cleaning.html",
  "guides/new-shoe-dye-ruboff.html",
  "guides/nylon-bag-care.html",
  "guides/plush-doll-cleaning.html",
  "guides/pu-leather-peeling.html",
  "guides/sherpa-teddy-fleece-jacket.html",
  "guides/shoe-drying-heat-risk.html",
  "guides/ski-snow-jacket-cleaning.html",
  "guides/sticky-bag-lining.html",
  "guides/suede-bag-care.html",
  "guides/suede-jacket-cleaning.html",
  "guides/suede-shoe-cleaning.html",
  "guides/taichung-laundry-service-search.html",
  "guides/taichung-shoe-cleaning-how-to-choose.html",
  "index.html",
  "local/fengjia-laundry-pickup.html",
  "local/nantun-shoe-cleaning.html",
  "local/qinghai-road-shoe-cleaning.html",
  "services/ironing-pressing.html",
  "services/shoe-bag-care.html",
  "services/suit-dry-cleaning.html",
  "services/taichung-citywide-laundry-pickup.html",
  "services/taichung-xitun-laundry.html",
  "services/wool-coat-cleaning.html"
]);
const OUT_OF_SCOPE_PREFIX = ["index.html", "campaign/", "journal/", "scripts/", "booking/", "go/", "assets/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|json|txt)$/u.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT)
  .map((p) => ({ rel: p.slice(ROOT.length + 1).replaceAll("\\", "/"), path: p }))
  .filter(
    ({ rel }) =>
      !OUT_OF_SCOPE_PREFIX.some((x) => rel.startsWith(x)) &&
      !(/^(guides|local)\//u.test(rel) && OUT_OF_SCOPE_SLUGS.has(rel.replace(/^.*\//u, "").replace(/\.[a-z]+$/u, "")))
  );

const LEATHER_PAGES = [
  "guides/leather-jacket-care.html",
  "guides/leather-mold-treatment.html",
  "guides/leather-shoe-cleaning-price.html",
  "guides/suede-jacket-cleaning.html",
  "guides/leather-vest-cleaning.html",
  "guides/leather-glove-care.html",
  "guides/leather-pants-skirt.html"
];

describe("2026-11-11 全站用語同步（皮革／麂皮不寫水洗價、起只給名牌包、大件至少 10–14 天）", () => {
  it("共用店家 JSON-LD 句用「皆為清潔參考價」，不再出現「名牌包 $1500 起；皆為水洗參考價」", () => {
    for (const f of files) {
      expect(readFileSync(f.path, "utf8"), f.rel).not.toContain("名牌包 $1500 起；皆為水洗參考價");
    }
  });

  it("皮革／麂皮專頁全頁不寫水洗價、水洗參考價", () => {
    for (const rel of LEATHER_PAGES.filter((x) => !TITLE_FREEZE.has(x))) {
      const s = readFileSync(join(ROOT, rel), "utf8");
      expect(s, rel).not.toMatch(/水洗參考價|水洗價/u);
    }
  });

  it("麂皮鞋的價句不寫成水洗價", () => {
    for (const f of files.filter((x) => !TITLE_FREEZE.has(x.rel))) {
      const s = readFileSync(f.path, "utf8");
      expect(s, f.rel).not.toMatch(/麂皮[^。<>"]*水洗(?:參考)?價/u);
    }
  });

  it("「起」只留名牌包 $1500 起（改衣 60 元起、儲值優惠、NT$30 價格區間下限除外；title／og／twitter 標題不動）", () => {
    const re = /(?<!NT)(?<!改衣 )(?<!送 )(?:\$ ?\d{2,4}|\d{3,4})(?: ?元)? ?起(?![一貨床])/gu;
    for (const f of files.filter((x) => !TITLE_FREEZE.has(x.rel))) {
      const lines = readFileSync(f.path, "utf8").split("\n").filter((l) => !/<title>|og:title|twitter:title/u.test(l));
      for (const line of lines) {
        for (const m of line.matchAll(re)) {
          const num = m[0].replace(/\D/gu, "");
          expect(["1500", "60", "100"].includes(num), `${f.rel}: ${m[0]}`).toBe(true);
        }
      }
    }
  });

  it("不寫單獨的「防水」，只寫防潑水或防水透氣（title／og／twitter 標題與衡量期頁不動）", () => {
    for (const f of files.filter((x) => !TITLE_FREEZE.has(x.rel))) {
      const lines = readFileSync(f.path, "utf8").split("\n").filter((l) => !/<title>|og:title|twitter:title/u.test(l));
      for (const line of lines) {
        expect(/防水(?!透氣)/u.test(line), `${f.rel}: ${line.slice(0, 80)}`).toBe(false);
      }
    }
  });

  it("大件交期寫「至少 10–14 天」，不寫「大件約 10–14 天」（答案檔與 llms）", () => {
    for (const rel of ["answers.json", "ai-discovery.json", "llms.txt", ".well-known/llms.txt", "guides/suit-water-wash-risk.html"]) {
      const f = files.find((x) => x.rel === rel);
      if (!f) continue;
      expect(readFileSync(f.path, "utf8"), rel).not.toMatch(/大件約 10[–-]14/u);
    }
  });
});

describe("2026-11-11 行銷裁定 M1–M6 價目表與皮件用字", () => {
  const rd = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
  const priceList = () => rd("services/taichung-laundry-price-list.html");

  it("價目表沒有空括號「（）」，H1 與卡片不寫 $30 起", () => {
    const html = priceList();
    expect(html).not.toContain("（）");
    expect(html).toContain("$30 到 $2500。參考價，看過實品再報價。");
    expect(html).not.toContain("$30<small>起</small>");
  });

  it("價目表皮類、麂皮、名牌列與 Offer 備註用清潔參考價，不寫水洗參考價", () => {
    const html = priceList();
    for (const name of ["皮類運動鞋", "麂皮鞋", "名牌鞋", "皮鞋", "名牌包", "特殊類名牌包", "皮衣"]) {
      const m = html.match(new RegExp(`"name":"${name}","description":"([^"]*)"`, "u"));
      expect(m, name).not.toBeNull();
      expect(m![1], name).not.toContain("水洗");
      expect(m![1], name).toContain("清潔參考價");
    }
  });

  it("一句同時有皮／麂皮／名牌與水洗價的句子已改成清潔參考價（非凍結頁）", () => {
    for (const rel of ["answers.json", "llms.txt", "hubs/shoe-care.html", "hubs/bag-care.html", "guides/bag-cleaning-price.html", "services/luxury-bag-cleaning.html"]) {
      const text = rd(rel);
      for (const seg of text.split(/[。\n]/u)) {
        if (/水洗價|水洗參考價/u.test(seg) && /皮|麂皮|名牌/u.test(seg) && !/乾洗跟水洗價格差/u.test(seg)) {
          throw new Error(`${rel}: ${seg.slice(0, 80)}`);
        }
      }
    }
  });

  it("rainy-shoe-care 不再寫「公開：」", () => {
    expect(rd("guides/rainy-shoe-care.html")).not.toContain("公開：一般運動鞋");
  });

  it("generatePublicSite.ts 與頁面同步：皮類列用清潔參考價、priceRange NT$30 起、沒有 250起／400起", () => {
    const src = readFileSync(join(__dirname, "..", "src", "generatePublicSite.ts"), "utf8");
    expect(src).toContain('priceRange: "NT$30 起"');
    expect(src).toContain('{ item: "麂皮鞋", price: "$400(清潔參考價)" }');
    expect(src).not.toMatch(/運動鞋水洗價250起|麂皮鞋400起|運動鞋250起/u);
    expect(src).not.toContain("（）。");
  });

  it("行銷複核 R326-2/3：generator 皮／麂皮／名牌的「公開」句用清潔參考價，帆布鞋不帶金額", () => {
    const src = readFileSync(join(__dirname, "..", "src", "generatePublicSite.ts"), "utf8");
    for (const line of src.split("\n")) {
      if (/公開水洗價：/u.test(line)) {
        expect(/皮|麂皮|名牌/u.test(line.split("公開水洗價：")[1]?.split("。")[0] ?? ""), line.slice(0, 60)).toBe(false);
      }
    }
    expect(src).toContain("公開清潔參考價：一般運動鞋 250、皮類運動鞋 300");
    expect(src).toContain("公開清潔參考價：一般運動鞋 250、皮鞋 400、麂皮鞋 400");
    expect(src).toContain("公開清潔參考價：一般包 600、皮包 1000、名牌包 1500 起");
    expect(src).toContain("公開參考價：精品襯衫 100、精品外套 200、精品長大衣 350");
    expect(src).toContain("帆布鞋傳照片到 LINE，看過實品再報價。");
    expect(src).not.toContain("帆布鞋先對照一般運動鞋");
  });

  it("行銷複核 R325P-1：表內有皮／麂皮／名牌的 #325 價格頁，表頭、備註與表下句不整張標水洗", () => {
    const tableUnder: Record<string, string> = {
      "taichung-shoe-cleaning-price": "上表是清潔參考價，看過實品再報價；發霉與特殊污漬另外說明。",
      "bag-mold-cleaning-price": "上表是清潔參考價，看過實品再報價；乾洗、柔洗與發霉另計，特殊污漬另外說明。"
    };
    for (const slug of ["taichung-shoe-cleaning-price", "bag-mold-cleaning-price"]) {
      const html = readFileSync(join(ROOT, "guides", `${slug}.html`), "utf8");
      expect(html, slug).not.toContain("水洗價");
      expect(html, slug).not.toContain("水洗參考價");
      expect(html, slug).not.toContain("上表是清潔參考價；乾洗、柔洗另計，發霉與特殊污漬要看過實品再報價。");
      expect(html, slug).toContain("<th>清潔參考價</th>");
    }
    expect(readFileSync(join(ROOT, "guides", "taichung-shoe-cleaning-price.html"), "utf8")).toContain(tableUnder["taichung-shoe-cleaning-price"] ?? "");
    expect(readFileSync(join(ROOT, "guides", "bag-mold-cleaning-price.html"), "utf8")).toContain(tableUnder["bag-mold-cleaning-price"] ?? "");
  });
});
