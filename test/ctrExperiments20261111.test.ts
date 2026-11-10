import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-10 行銷裁定。title 四欄同句；description 四欄同句。聯絡次數不得低於改前。 */
const PAGES = [
  {
    path: "index.html",
    title: "台中洗衣店｜洗鞋洗包、衣物送洗，台中全市免費收送｜私享家洗衣店",
    description:
      "台中洗衣、洗鞋、洗包、精品衣物，先傳照片問再報價。私享家洗衣店在西屯青海路二段365號（至善國中對面），台中全市免費收送、沒有最低消費，一件也收。LINE 官方 @454foyks，或 LINE 0968327653。",
    h1: '<h1 data-r5-title="">台中洗衣、洗鞋洗包，<br/>讓喜歡的每一件繼續陪你。</h1>',
    line: 6,
    phone: 5,
    websiteDescription: true
  },
  {
    path: "guides/pu-leather-peeling.html",
    title: "合成皮掉屑處理：先停手、留屑，清潔補不回已掉的皮膜｜私享家洗衣店",
    description:
      "合成皮掉屑處理：已經掉下的膜，清洗補不回去，用力擦還會帶起鬆的膜。先停手，把屑收進袋子，拍外層與內裡傳 LINE（@454foyks／0968327653），門市看過實品再說明；不保證恢復皮面，也不保證不再掉屑。",
    h1: "<h1>合成皮掉屑怎麼處理？脫皮先停手，能做與不能做</h1>",
    line: 9,
    phone: 1
  },
  {
    path: "guides/sticky-bag-lining.html",
    title: "包包黏黏的怎麼處理？放久內裡黏手、掉屑，是塗層老化不是髒｜私享家洗衣店",
    description:
      "包包放久黏黏的怎麼處理？內裡黏手、起皺、掉黑屑或白屑，多半是塗層老化，不是髒，清潔洗不掉黏。不要用酒精擦、不要撒粉蓋住。拍主袋、夾層與剝落處傳 LINE（@454foyks／0968327653），換內裡屬修繕，是否可處理由門市看實品說明。",
    h1: "<h1>包包黏黏的怎麼處理：內裡塗層老化不是髒</h1>",
    line: 3,
    phone: 2
  },
  {
    path: "guides/suede-jacket-cleaning.html",
    title: "麂皮外套怎麼洗？先別整件泡水、別脫水，台中送洗先看絨面｜私享家洗衣店",
    description:
      "麂皮外套怎麼洗、麂皮衣服能不能洗？先別整件泡水，也別丟洗衣機脫水。絨毛倒了用軟刷順毛，還濕的話門市會趁濕處理，麂皮可能染色。價目表沒有麂皮外套這一列，參考價，看過實品再報價。台中全市免費收送、沒有最低消費。",
    h1: "<h1>麂皮衣服怎麼洗？麂皮外套可以水洗嗎？</h1>",
    line: 3,
    phone: 3
  },
  {
    path: "local/fengjia-laundry-pickup.html",
    title: "逢甲洗衣店｜宿舍租屋免費收送、沒有最低消費，一件也收｜私享家洗衣店",
    description:
      "逢甲洗衣店怎麼找？門市在西屯青海路二段365號（至善國中對面），宿舍、租屋可約台中全市免費收送、沒有最低消費，一件也收。襯衫水洗參考價 $70，參考價，看過實品再報價。LINE 官方 @454foyks，或 LINE 0968327653。",
    h1: "<h1>逢甲洗衣店：西屯青海路門市，宿舍租屋免費收送、沒有最低消費</h1>",
    line: 6,
    phone: 6
  },
  {
    path: "services/taichung-citywide-laundry-pickup.html",
    title: "衣服送洗怎麼約？台中全市免費收送、沒有最低消費，一件也收｜私享家洗衣店",
    description:
      "衣服送洗怎麼約？台中全市免費收送、沒有最低消費，洗衣、洗鞋、洗包一件也收。先用 LINE 傳照片確認材質狀態，再約收件時間（LINE 官方 @454foyks，或 LINE 0968327653）。洗鞋一般約一個禮拜可以拿。參考價，看過實品再報價。",
    h1: '<h1 data-reveal="" style="flex:1 1 560px;margin:0;font-size:clamp(48px,8vw,132px);line-height:0.98;letter-spacing:-0.045em;font-weight:900">免費收送，<br><span style="color:var(--color-accent)">一件也收。</span></h1>',
    line: 14,
    phone: 5
  },
  {
    path: "services/wool-coat-cleaning.html",
    title: "台中洗羊毛大衣多少錢？先看洗標，長大衣水洗參考價 $300｜私享家洗衣店",
    description:
      "台中洗羊毛大衣、大衣送洗多少錢？官網價目表長大衣水洗參考價 $300、厚外套 $180，乾洗另計，參考價，看過實品再報價。先拍洗標、裡布與墊肩傳 LINE（@454foyks／0968327653），台中全市免費收送、沒有最低消費。不保證變全新。",
    h1: "<h1>台中洗羊毛大衣：羊毛大衣送洗先交照片</h1>",
    line: 3,
    phone: 3
  },
  {
    path: "guides/knit-shoulder-bump-stretch.html",
    title: "毛衣洗完變大、變長、變硬怎麼辦？肩膀凸起也看這篇｜台中私享家洗衣店",
    description:
      "毛衣洗完變大、變長或變硬怎麼辦？先別再洗、再烘、再熨，也別用力拉，把衣服攤平量一量。變長多半是濕的時候被吊或被拉，變硬可能是縮絨，要看實物。毛衣水洗參考價 $150，參考價，看過實品再報價。",
    h1: "<h1>毛衣掛完肩膀凸起、洗完變長怎麼辦？</h1>",
    line: 3,
    phone: 3
  },
  {
    path: "services/suit-dry-cleaning.html",
    title: "台中洗西裝、西裝乾洗要多久？一般約 7 天可以拿｜私享家洗衣店（西屯）",
    description:
      "台中洗西裝、西裝乾洗要多久？一般約 7 天可以拿，實際日期收件時確認。西裝背心 $80、長褲 $70（水洗參考價，乾洗另計），西裝外套沒有固定價，參考價，看過實品再報價。台中全市免費收送、沒有最低消費。",
    h1: "<h1>洗西裝：只收西裝，先看肩線、內襯與洗標</h1>",
    line: 3,
    phone: 3
  }
] as const;

const FIGCAPTION = "示範片段為 AI 情境示意，不代表特定客件成果。";

const VIDEOS = [
  ["guides/wool-sweater-pilling.html", "74jq98-izu4", "毛衣起球，一區一區處理給你看", 7, 1],
  ["guides/wool-coat-dry-clean.html", "DOEwnXazKKM", "羊毛大衣沾到羊肉爐湯汁，別急著機洗", 2, 2],
  ["guides/bedding-duvet-cleaning.html", "70qUns7icUY", "棉被摸起來乾，中間那層不一定乾", 4, 4],
  ["services/taichung-citywide-laundry-pickup.html", "kgBHPX1tWQY", "一雙鞋也能約收送", 14, 5],
  ["services/taichung-citywide-laundry-pickup.html", "Qy1-aADQyU4", "不在家也能收送", 14, 5],
  ["services/taichung-citywide-laundry-pickup.html", "M_foOtCsgj8", "只有一件也能叫收送嗎", 14, 5]
] as const;

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function metaContent(html: string, marker: string): string {
  const tag = html.match(new RegExp(`<meta\\b[^>]*${marker}[^>]*>`, "u"))?.[0] ?? "";
  return tag.match(/content="([^"]*)"/u)?.[1] ?? "";
}

function graph(html: string): Array<{ "@type"?: string; name?: string; description?: string }> {
  const raw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/u)?.[1] ?? "{}";
  return (JSON.parse(raw) as { "@graph"?: Array<{ "@type"?: string; name?: string; description?: string }> })["@graph"] ?? [];
}

describe("2026-11-11 CTR 實驗已核文案", () => {
  for (const page of PAGES) {
    it(`${page.path} 的 title、description 四欄同句，聯絡次數不低於改前`, () => {
      const html = read(page.path);
      const title = html.match(/<title>([^<]*)<\/title>/u)?.[1] ?? "";
      const description = metaContent(html, 'name="description"');
      const nodes = graph(html);
      const pageNode = nodes.find((node) => node["@type"] === "WebPage");
      expect(title).toBe(page.title);
      expect(metaContent(html, 'property="og:title"')).toBe(page.title);
      expect(metaContent(html, 'name="twitter:title"')).toBe(page.title);
      expect(pageNode?.name).toBe(page.title);
      expect(description).toBe(page.description);
      expect(metaContent(html, 'property="og:description"')).toBe(page.description);
      expect(metaContent(html, 'name="twitter:description"')).toBe(page.description);
      expect(pageNode?.description).toBe(page.description);
      if ("websiteDescription" in page && page.websiteDescription) {
        expect(nodes.find((node) => node["@type"] === "WebSite")?.description).toBe(page.description);
      }
      expect(html).toContain(page.h1);
      expect(html.split("@454foyks").length - 1).toBeGreaterThanOrEqual(page.line);
      expect(html.split("0968327653").length - 1).toBeGreaterThanOrEqual(page.phone);
      expect(html).not.toContain('"@type":"VideoObject"');
    });
  }

  it("合成皮首句接在舊句前，黏包分流段與內鏈錨文字照附件", () => {
    const peeling = read("guides/pu-leather-peeling.html");
    const lead = peeling.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/u)?.[1] ?? "";
    expect(lead.startsWith("合成皮掉屑處理，第一步是停手：不乾擦、不濕擦、不用膠布黏，屑先收進透明袋。")).toBe(true);
    expect(lead).toContain("合成皮若已老化掉屑、脫皮，無法靠清洗恢復；");
    const sticky = read("guides/sticky-bag-lining.html");
    const diversion = sticky.match(/<p>皮包、皮革包黏黏的[\s\S]*?<\/p>/u)?.[0] ?? "";
    expect(diversion.replace(/<[^>]+>/gu, "")).toBe(
      "皮包、皮革包黏黏的，先分黏在哪：包包裡面黏手，看這一頁；包包外面一層薄皮掉粉、脫皮，看合成皮掉屑處理；包邊那條油邊裂開或發黏，看包包油邊裂開。"
    );
    expect(diversion).toContain(
      '<a href="https://sixiangjialaundry.com/guides/pu-leather-peeling.html" data-editorial="1">合成皮掉屑處理</a>'
    );
    expect(diversion).toContain(
      '<a href="https://sixiangjialaundry.com/guides/bag-edge-paint-cracking.html" data-editorial="1">包包油邊裂開</a>'
    );
    for (const path of [
      "guides/synthetic-vs-leather-handle.html",
      "guides/bag-edge-paint-cracking.html",
      "guides/leather-bag-care.html"
    ]) {
      expect(read(path), path).toContain(
        '<a href="https://sixiangjialaundry.com/guides/pu-leather-peeling.html" data-editorial="1">合成皮掉屑處理</a>'
      );
    }
  });

  it("麂皮外套內鏈、大衣段首與回鏈、毛衣段首與西裝直接答案照附件", () => {
    for (const path of [
      "guides/suede-shoe-cleaning.html",
      "guides/suede-bag-care.html",
      "guides/leather-jacket-care.html",
      "guides/nubuck-shoe-cleaning.html"
    ]) {
      expect(read(path), path).toContain(
        '<a href="https://sixiangjialaundry.com/guides/suede-jacket-cleaning.html" data-editorial="1">麂皮外套怎麼洗</a>'
      );
    }
    const coat = read("services/wool-coat-cleaning.html");
    expect(coat).toContain("<h2>羊毛大衣送洗多少錢？</h2>");
    expect(coat).toContain(
      "官網價目表的長大衣水洗參考價是 $300，厚外套 $180（水洗參考價，乾洗、柔洗另計）。洗標寫只能乾洗的大衣，就照洗標乾洗。羊毛大衣依長度、材質和狀況，參考價，看過實品再報價，不是固定成交價。長度請在訊息裡寫大概幾公分，不要只寫「一件大衣」。"
    );
    expect(coat).toContain(
      '外套各厚度怎麼分價，看<a href="https://sixiangjialaundry.com/guides/jacket-cleaning-price.html" data-editorial="1">外套送洗多少錢</a>'
    );
    expect(read("guides/jacket-cleaning-price.html")).toContain(
      '<a href="https://sixiangjialaundry.com/services/wool-coat-cleaning.html" data-editorial="1">羊毛大衣送洗</a>'
    );
    const knit = read("guides/knit-shoulder-bump-stretch.html");
    expect(knit).toContain("<h2>毛衣洗完變大、變長或變硬怎麼辦？</h2>");
    expect(knit).toContain(
      "先停手：不再洗、不烘、不熨，也不要用力拉。濕的毛衣平放，不要吊著。變大、變長，多半是濕的時候被吊著或被拉；變硬，可能是纖維縮絨變緊。哪一種要看實物。能處理到哪，看材質與狀況，不保證回到原本的尺寸或手感。拍洗標與整件傳 LINE（LINE 官方 @454foyks，或 LINE 0968327653），門市看過實物再說明。"
    );
    expect(knit).toContain(
      '<a href="https://sixiangjialaundry.com/guides/sweater-shrunk-what-now.html" data-editorial="1">毛衣縮水怎麼辦</a>'
    );
    expect(knit).toContain(
      '<a href="https://sixiangjialaundry.com/guides/wool-knit-shrink-risk.html" data-editorial="1">羊毛針織縮水</a>'
    );
    expect(knit).toContain(
      '<a href="https://sixiangjialaundry.com/guides/sweater-cleaning-price.html" data-editorial="1">毛衣送洗多少錢</a>'
    );
    expect(read("guides/sweater-shrunk-what-now.html")).toContain(
      '<a href="https://sixiangjialaundry.com/guides/knit-shoulder-bump-stretch.html" data-editorial="1">毛衣洗完變大、變硬</a>'
    );
    const suit = read("services/suit-dry-cleaning.html");
    const answer = suit.match(/<div class="answer-box">([\s\S]*?)<\/div>/u)?.[1] ?? "";
    expect(answer.trimStart().startsWith("<p>西裝乾洗要多久？一般約 7 天可以拿，實際日期收件時會確認。</p>")).toBe(
      true
    );
  });

  it("嵌入頁使用 youtube-nocookie、AI 句 figcaption，且沒有舊句與 VideoObject", () => {
    for (const [path, id, title, line, phone] of VIDEOS) {
      const html = read(path);
      expect(html, path).toContain(
        `<iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${title}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen style="width:100%;max-width:720px;aspect-ratio:16/9;border:0"></iframe>`
      );
      expect(html, path).toContain(`<figcaption>${FIGCAPTION}</figcaption>`);
      expect(html, path).not.toContain("屬情境示意");
      expect(html, path).not.toContain('"@type":"VideoObject"');
      expect(html, path).not.toContain("autoplay");
      expect(html.split("@454foyks").length - 1, path).toBeGreaterThanOrEqual(line);
      expect(html.split("0968327653").length - 1, path).toBeGreaterThanOrEqual(phone);
      const leadEnd = html.indexOf("</p>", html.indexOf('class="lead"'));
      const figureAt = html.indexOf(`youtube-nocookie.com/embed/${id}`);
      if (path !== "services/taichung-citywide-laundry-pickup.html") {
        const updated = html.indexOf('class="last-updated"');
        expect(leadEnd, path).toBeGreaterThan(-1);
        expect(figureAt, path).toBeGreaterThan(leadEnd);
        expect(updated, path).toBeGreaterThan(figureAt);
        expect(html.split(`<figcaption>${FIGCAPTION}</figcaption>`).length - 1, path).toBe(1);
      } else {
        const answerEnd = html.indexOf("預約以 LINE 為主，先傳照片與大致地址。</p>");
        expect(figureAt, path).toBeGreaterThan(answerEnd);
      }
    }
    const pickup = read("services/taichung-citywide-laundry-pickup.html");
    const pickupIds = ["kgBHPX1tWQY", "Qy1-aADQyU4", "M_foOtCsgj8"];
    let cursor = pickup.indexOf("預約以 LINE 為主，先傳照片與大致地址。</p>");
    for (const id of pickupIds) {
      const at = pickup.indexOf(`youtube-nocookie.com/embed/${id}`);
      expect(at, id).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(pickup.split(`<figcaption>${FIGCAPTION}</figcaption>`).length - 1).toBe(pickupIds.length);
  });
});
