import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-10 行銷裁定。title 四欄同句；meta 四欄同句。聯絡次數不得低於改前。 */
const PAGES = [
  {
    path: "services/ironing-pressing.html",
    title: "哪裡可以燙衣服？台中燙衣服店只燙不洗｜整燙參考價 $50（一般衣服）｜私享家洗衣店",
    description:
      "哪裡可以燙衣服？台中燙衣服店可只燙不洗：衣服先洗好、完全乾透，先拍洗標與在意部位。整燙 $50 參考價（一般衣服），其他衣物看過實品再報價。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "台中燙衣服店：只燙不洗可以接，先看洗標與布料",
    line: 2,
    phone: 1
  },
  {
    path: "guides/birkenstock-care.html",
    title: "勃肯鞋臭怎麼辦？軟木鞋床與 EVA 臭味先分開｜台中送洗｜私享家洗衣店",
    description:
      "勃肯鞋臭、勃肯 EVA 臭？味道多半在軟木鞋床吸汗，不是鞋面；整雙泡水或丟洗衣機易變形開膠。休閒鞋水洗參考價 $350、麂皮鞋 $400，參考價，看過實品再報價。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "勃肯鞋臭怎麼辦？先看軟木鞋床，不要整雙泡水",
    line: 5,
    phone: 3
  },
  {
    path: "guides/shoe-drying-heat-risk.html",
    title: "鞋子可以烘乾嗎？烘鞋機、烘衣機、吹風機風險不同｜私享家洗衣店",
    description:
      "鞋子可以烘乾嗎？不建議用熱風催乾：鞋膠、塗層、泡棉與皮革都可能受影響。先看洗標與材質，沒有通用安全溫度。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "鞋子可以烘乾嗎：烘鞋設備與材質限制",
    line: 2,
    phone: 2
  },
  {
    path: "guides/dress-shirt-starch-risk.html",
    title: "襯衫領口發亮變硬？先分漿膜、汗黃、燙焦再決定洗或燙｜私享家洗衣店",
    description:
      "襯衫漿燙後領口發亮、變硬？先分漿膜、汗黃與燙焦，再決定先洗還是只燙。襯衫水洗參考價 $70、整燙 $50（一般衣服），參考價，看過實品再報價。台中全市免費收送、沒有最低消費。",
    h1: "襯衫漿燙：先分漿膜、汗黃和燙焦",
    line: 4,
    phone: 1
  },
  {
    path: "guides/lambskin-bag-care.html",
    title: "小羊皮包怎麼洗？會留痕嗎？先拍照評估｜台中收送｜私享家洗衣店",
    description:
      "小羊皮包怎麼洗、會不會留痕？先分刮痕、壓痕與沾色，材質不明先別自己刷。傳照片看過實品再報價，不套固定價。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "小羊皮包怎麼清：刮痕、壓痕、沾色先分開",
    line: 3,
    phone: 3
  },
  {
    path: "local/nantun-shoe-cleaning.html",
    title: "南屯洗鞋怎麼約？運動鞋水洗參考價 $250、麂皮鞋 $400｜台中收送｜私享家洗衣店",
    description:
      "南屯沒有洗鞋門市，公益路、大墩、河南路、嶺東一帶約西屯門市收送。一般運動鞋水洗參考價 $250、麂皮鞋 $400，參考價，看過實品再報價；洗鞋一般約一個禮拜可以拿。台中全市免費收送、沒有最低消費。",
    h1: "南屯洗鞋：衣物收送請看南屯收送",
    line: 2,
    phone: 2
  },
  {
    path: "guides/suede-bag-care.html",
    title: "麂皮包怎麼洗？會不會洗壞？先別濕刷｜台中收送｜私享家洗衣店",
    description:
      "麂皮包怎麼洗、會不會洗壞？材質不明先別刷、先別濕擦；先拍標示與內袋，看過實品才能判斷。參考價，看過實品再報價。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "麂皮包包怎麼清：絨面、內襯與袋身結構分開看",
    line: 2,
    phone: 1
  },
  {
    path: "guides/new-shoe-dye-ruboff.html",
    title: "新鞋掉色怎麼辦？染料沾到襪子、褲腳先停穿停熱｜私享家洗衣店",
    description:
      "新鞋掉色是鞋面染料蹭到襪子或褲腳，不是洗衣機互染、也不是包包色移。先停穿、停熱、先拍照。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "新鞋掉色：染料沾到襪子和褲腳",
    line: 6,
    phone: 1
  },
  {
    path: "guides/nylon-bag-care.html",
    title: "尼龍包怎麼洗？油膜、泥土、水痕先分開｜台中收送｜私享家洗衣店",
    description:
      "尼龍包怎麼洗？先分提把油膜、包底泥土與雨後水痕，再看塗層和五金；表面變霧先停手。參考價，看過實品再報價。台中全市免費收送、沒有最低消費。LINE @454foyks／0968327653。",
    h1: "尼龍包：油膜和水痕不是同一種髒",
    line: 2,
    phone: 2
  }
] as const;

const VIDEOS = [
  ["guides/down-jacket-cleaning.html", "94f_Tr9g4NE", "羽絨外套袖口油污示範"],
  ["guides/white-shoe-yellowing.html", "v0_YcbbmG9Y", "白鞋晾乾泛黃，先別猛刷"],
  ["guides/sheepskin-boot-cleaning.html", "Nac9mIuxBUg", "雪靴清洗前後，水痕別只擦一處"],
  ["guides/luxury-bag-mold.html", "YgRlFBdPYa0", "包包發霉，洗後可能變黑"]
] as const;

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function meta(html: string, pattern: RegExp): string {
  return html.match(pattern)?.[1] ?? "";
}

function webPage(html: string): { name?: string; description?: string } {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}";
  const graph = (JSON.parse(raw) as { "@graph"?: Array<{ "@type"?: string; name?: string; description?: string }> })[
    "@graph"
  ];
  return graph?.find((node) => node["@type"] === "WebPage") ?? {};
}

describe("2026-11-10 CTR 裁定文案", () => {
  for (const page of PAGES) {
    it(`${page.path} 的 title、meta、H1 與聯絡次數`, () => {
      const html = read(page.path);
      const title = meta(html, /<title>([^<]*)<\/title>/u);
      const description = meta(html, /<meta name="description" content="([^"]*)"/u);
      const pageNode = webPage(html);
      expect(title).toBe(page.title);
      expect(meta(html, /<meta property="og:title" content="([^"]*)"/u)).toBe(page.title);
      expect(meta(html, /<meta name="twitter:title" content="([^"]*)"/u)).toBe(page.title);
      expect(pageNode.name).toBe(page.title);
      expect(description).toBe(page.description);
      expect(meta(html, /<meta property="og:description" content="([^"]*)"/u)).toBe(page.description);
      expect(meta(html, /<meta name="twitter:description" content="([^"]*)"/u)).toBe(page.description);
      expect(pageNode.description).toBe(page.description);
      expect(meta(html, /<h1[^>]*>([\s\S]*?)<\/h1>/u).replace(/<br\s*\/?>/gu, "")).toBe(page.h1);
      expect(html.split("@454foyks").length - 1).toBeGreaterThanOrEqual(page.line);
      expect(html.split("0968327653").length - 1).toBeGreaterThanOrEqual(page.phone);
      expect(html).not.toContain('"@type":"FAQPage","@type":"FAQPage"');
    });
  }

  it("勃肯首段加句用「不承諾除味」，南屯首段有與 meta 相同的價句", () => {
    const birken = meta(read("guides/birkenstock-care.html"), /<p class="lead"[^>]*>([\s\S]*?)<\/p>/u);
    expect(birken).toContain("勃肯 EVA 底若發臭，跟鞋床吸汗是兩件事，先拍鞋床與大底再評估，不承諾除味。");
    const nantun = meta(read("local/nantun-shoe-cleaning.html"), /<p class="lead"[^>]*>([\s\S]*?)<\/p>/u);
    expect(nantun).toContain("一般運動鞋水洗參考價 $250、麂皮鞋 $400，參考價，看過實品再報價；洗鞋一般約一個禮拜可以拿。");
  });

  it("小羊皮 meta 不寫 $1000，麂皮包 meta 不寫鞋價，烘鞋 meta 不寫變全新", () => {
    expect(meta(read("guides/lambskin-bag-care.html"), /<meta name="description" content="([^"]*)"/u)).not.toMatch(/\$|1000/);
    expect(meta(read("guides/suede-bag-care.html"), /<meta name="description" content="([^"]*)"/u)).not.toContain("$400");
    expect(meta(read("guides/shoe-drying-heat-risk.html"), /<meta name="description" content="([^"]*)"/u)).not.toContain("變全新");
    expect("麂".codePointAt(0)).toBe(0x9e82);
  });

  it("內鏈：洗衣機、鞋包服務、新鞋掉色", () => {
    const washing = read("guides/washing-machine-shoe-risk.html");
    expect(washing).toContain(
      '<a href="https://sixiangjialaundry.com/guides/new-shoe-dye-ruboff.html">新鞋掉色、染料沾襪子</a>'
    );
    expect(meta(washing, /<meta name="description" content="([^"]*)"/u)).toContain("新鞋染料蹭襪另見新鞋掉色頁");
    const shoeBag = read("services/shoe-bag-care.html");
    expect(shoeBag).toContain('<a href="/guides/new-shoe-dye-ruboff.html">新鞋掉色怎麼辦</a>');
    expect(shoeBag).toContain('<a href="/guides/washing-machine-shoe-risk.html">鞋子可以丟洗衣機嗎</a>');
    expect(shoeBag).toContain('<a href="/guides/shoe-drying-heat-risk.html">鞋子可以烘乾嗎</a>');
    expect(meta(shoeBag, /<title>([^<]*)<\/title>/u)).toBe("台中洗鞋多少錢？運動鞋 $250、麂皮鞋 $400｜台中收送｜私享家");
    const dye = read("guides/new-shoe-dye-ruboff.html");
    expect(dye).toContain(
      '<a href="https://sixiangjialaundry.com/guides/washing-machine-shoe-risk.html" data-editorial="1">鞋子可以丟洗衣機洗嗎</a>；這頁只講新鞋染料蹭色。'
    );
    expect(read("services/ironing-pressing.html")).toContain('href="https://sixiangjialaundry.com/guides/dress-shirt-starch-risk.html"');
  });

  it("只在指定四頁嵌入 YouTube，lazy-load、有 title、不自動播放", () => {
    for (const [path, id, title] of VIDEOS) {
      const html = read(path);
      expect(html, path).toContain(`src="https://www.youtube-nocookie.com/embed/${id}"`);
      expect(html, path).toContain(`title="${title}"`);
      expect(html, path).toContain('loading="lazy"');
      expect(html, path).not.toContain("autoplay");
      expect(html, path).not.toContain("除霉");
    }
    expect(read("guides/leather-mold-treatment.html")).not.toContain("YgRlFBdPYa0");
    expect(read("guides/fleece-jacket-pilling.html")).not.toContain("74jq98-izu4");
    expect(read("guides/fleece-jacket-pilling.html")).not.toContain("youtube-nocookie.com/embed");
    expect(read("guides/leather-mold-treatment.html")).not.toContain("youtube-nocookie.com/embed");
  });
});
