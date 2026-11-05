import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/** 2026-11-05：從已有曝光的頁，各加一句、一個錨文字，指到 GSC「已找到 - 尚未建立索引」的頁。 */
const LINKS = [
  {
    from: "services/ironing-pressing.html",
    href: "https://sixiangjialaundry.com/guides/collar-sweat-yellow.html",
    anchor: "領口發黃怎麼辦"
  },
  {
    from: "services/ironing-pressing.html",
    href: "https://sixiangjialaundry.com/guides/clothing-ink-stain.html",
    anchor: "衣服畫到原子筆怎麼洗"
  },
  {
    from: "services/ironing-pressing.html",
    href: "https://sixiangjialaundry.com/services/clinic-uniform-laundry.html",
    anchor: "診所制服送洗"
  },
  {
    from: "guides/sticky-bag-lining.html",
    href: "https://sixiangjialaundry.com/guides/wallet-cleaning-check.html",
    anchor: "皮夾怎麼判斷"
  },
  {
    from: "services/taichung-laundry-price-list.html",
    href: "/services/wool-coat-cleaning.html",
    anchor: "羊毛大衣送洗"
  },
  {
    from: "services/taichung-laundry-price-list.html",
    href: "/guides/sweater-cleaning-price.html",
    anchor: "毛衣送洗多少錢"
  },
  {
    from: "services/taichung-laundry-price-list.html",
    href: "/services/duvet-bedding-cleaning.html",
    anchor: "羽絨被怎麼洗"
  },
  {
    from: "services/taichung-laundry-price-list.html",
    href: "/guides/summer-quilt-washing.html",
    anchor: "涼被可以水洗嗎"
  },
  {
    from: "services/taichung-laundry-price-list.html",
    href: "/guides/mattress-protector-washing.html",
    anchor: "保潔墊可以丟洗衣機嗎"
  },
  {
    from: "services/luxury-garment-cleaning.html",
    href: "/guides/cashmere-knit-care.html",
    anchor: "羊絨怎麼洗"
  },
  {
    from: "services/luxury-garment-cleaning.html",
    href: "/guides/cardigan-cleaning.html",
    anchor: "毛衣外套怎麼洗"
  },
  {
    from: "services/luxury-garment-cleaning.html",
    href: "/guides/suede-jacket-cleaning.html",
    anchor: "麂皮衣服怎麼洗"
  },
  {
    from: "services/luxury-garment-cleaning.html",
    href: "/guides/clothing-dye-transfer.html",
    anchor: "衣服被染色怎麼辦"
  },
  {
    from: "services/luxury-garment-cleaning.html",
    href: "/guides/clothing-color-fading.html",
    anchor: "衣服褪色怎麼辦"
  },
  {
    from: "services/shoe-bag-care.html",
    href: "/guides/waterproof-breathable-shoe-care.html",
    anchor: "防水透氣鞋可以水洗嗎"
  },
  {
    from: "services/shoe-bag-care.html",
    href: "/guides/shoe-insole-machine-wash.html",
    anchor: "鞋墊可以丟洗衣機嗎"
  },
  {
    from: "services/shoe-bag-care.html",
    href: "/services/luggage-cleaning.html",
    anchor: "行李箱清潔"
  },
  {
    from: "services/taichung-citywide-laundry-pickup.html",
    href: "/local/west-district-laundry-pickup.html",
    anchor: "西區洗衣收送"
  },
  {
    from: "services/taichung-citywide-laundry-pickup.html",
    href: "/guides/coin-laundry-vs-pickup.html",
    anchor: "自助洗衣和到府收送"
  },
  {
    from: "services/taichung-citywide-laundry-pickup.html",
    href: "/services/postpartum-center-laundry.html",
    anchor: "月子中心洗衣"
  }
] as const;

const BANNED = ["防水層", "除霉", "只補", "另看", "本頁", "這頁"] as const;

function read(rel: string): string {
  return readFileSync(join(repoRootFromHere(), "seo-overrides", rel), "utf8");
}

function paragraphWith(html: string, anchor: string): string {
  const marker = `>${anchor}<`;
  const at = html.indexOf(marker);
  const start = html.lastIndexOf("<p", at);
  const end = html.indexOf("</p>", at);
  return html.slice(start, end + 4);
}

describe("GSC 尚未索引頁的內鏈句", () => {
  it("共 20 句，每句一個連結，錨文字對得上目標", () => {
    expect(LINKS).toHaveLength(20);
    for (const link of LINKS) {
      const html = read(link.from);
      const paragraph = paragraphWith(html, link.anchor);
      expect(paragraph, `${link.from} → ${link.anchor}`).toContain(`href="${link.href}"`);
      expect(paragraph.match(/<a\b/g) ?? [], link.anchor).toHaveLength(1);
      const text = paragraph.replace(/<[^>]+>/g, "");
      for (const word of BANNED) {
        expect(text, link.anchor).not.toContain(word);
      }
      expect(text, link.anchor).not.toMatch(/\$\d+/);
      expect(text.replaceAll("台中全市免費收送、沒有最低消費", ""), link.anchor).not.toContain("免費");
    }
  });
});
