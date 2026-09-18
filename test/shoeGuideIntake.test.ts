import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePublicSite, publicSupportPages } from "../src/generatePublicSite";

const baseUrl = "https://sixiangjialaundry.com";
const cases = [
  { slug: "shoe-odor-source", heading: "鞋臭送洗：先說味道來源，再確認清潔費用", cue: "淋雨後、連續穿著後", boundary: "不保證無味", parent: "shoe-bag-care" },
  { slug: "shoe-mold-surface-check", heading: "發霉鞋送洗：特殊污況先評估，不套一般洗鞋價", cue: "發霉位置", boundary: "除霉全包價", parent: "shoe-bag-care" },
  { slug: "white-shoe-yellowing", heading: "白鞋送洗：分清清潔費與泛黃改善界線", cue: "布面黃痕、膠邊轉黃還是灰污", boundary: "不保證恢復全白", parent: "white-shoe-cleaning" },
  { slug: "suede-shoe-cleaning", heading: "麂皮鞋送洗：先傳哪些照片、怎麼看費用", cue: "發亮或水圈近照", boundary: "不保證恢復原絨向", parent: "shoe-bag-care" }
];

describe("shoe guide intake cohort 2026-09-07", () => {
  it("renders four distinct intake sections with contextual price and pickup links, preserving parent and LINE routing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sxj-shoe-intake-"));
    await mkdir(join(root, "data"));
    await copyFile(join(process.cwd(), "data/business-profile.json"), join(root, "data/business-profile.json"));
    await generatePublicSite({ root, baseUrl, now: "2026-09-07T02:30:00.000Z" });
    for (const item of cases) {
      const html = await readFile(join(root, "docs/guides", `${item.slug}.html`), "utf8");
      const section = html.match(new RegExp(`<article class="card">\\s*<h3>${item.heading}</h3>\\s*<p>([\\s\\S]*?)</p>\\s*</article>`))?.[1];
      expect(section, `${item.slug}: actual rendered intake section`).toBeDefined();
      expect(section, item.slug).toContain(item.cue);
      expect(section, item.slug).toContain(item.boundary);
      expect(section, item.slug).toContain("收送無低消，清潔費另計");
      expect(section, item.slug).toContain(`<a href="${baseUrl}/services/taichung-laundry-price-list.html">台中洗衣價目表</a>`);
      expect(section, item.slug).toContain(`<a href="${baseUrl}/services/taichung-citywide-laundry-pickup.html">台中全市免費洗衣收送</a>`);
      expect(html).toContain(`<link rel="canonical" href="${baseUrl}/guides/${item.slug}.html"`);
      expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large"');
      expect(html).toContain(`<time datetime="2026-09-07">2026-09-07</time>`);
      const parentLinks = [...html.matchAll(/<a\b[^>]*\bdata-parent-service[^>]*>[\s\S]*?<\/a>/g)];
      expect(parentLinks, item.slug).toHaveLength(1);
      expect(parentLinks[0]?.[0], item.slug).toContain(`/services/${item.parent}.html`);
      expect(html).toContain(`${baseUrl}/go/line.html?source=guide-${item.slug}-cta`);
      const redirect = await readFile(join(root, "docs/go/line.html"), "utf8");
      expect(redirect).toContain("line.me");
      const page = publicSupportPages().find((entry) => entry.slug === item.slug)!;
      expect(html).toContain(`<p>${page.citation_answer}</p>`);
    }
    // No synthetic cases or new service URLs can enter the publication surface.
    const sitemap = await readFile(join(root, "docs/sitemap.xml"), "utf8");
    expect(sitemap).not.toContain("/cases/");
    expect(sitemap).not.toContain("/services/bag-cleaning.html");
  });
});
