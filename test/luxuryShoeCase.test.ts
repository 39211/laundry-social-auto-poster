import { copyFile, mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generatePublicSite, publicSupportPages } from "../src/generatePublicSite";

const slug = "luxury-designer-shoe-care";
const heading = "精品鞋泡沫清洗案例：本案實收600元、清洗約一週";
const baseUrl = "https://sixiangjialaundry.com";
const now = "2026-09-14T06:00:00.000Z";

async function render(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sxj-luxury-case-"));
  await mkdir(join(root, "data"));
  await copyFile(join(process.cwd(), "data/business-profile.json"), join(root, "data/business-profile.json"));
  await generatePublicSite({ root, baseUrl, now });
  return root;
}

function verifyCase(html: string): void {
  const section = html.match(new RegExp(`<article class="card">\\s*<h3>${heading}</h3>\\s*<p>([\\s\\S]*?)</p>\\s*</article>`))?.[1];
  expect(section, "rendered owner-confirmed case is required").toBeDefined();
  for (const text of ["泡沫清洗", "本案實收600元", "清洗時間約一週", "由私享家門市提供", "不是所有精品鞋的統一價格", "不是固定交件承諾", "免費收送、無低消", "清潔費另計"]) {
    expect(section, `case boundary: ${text}`).toContain(text);
  }
  expect(section).not.toContain("<img");
}

describe("owner-confirmed luxury shoe case", () => {
  it("renders factual limits and preserves the existing acquisition flow", async () => {
    const root = await render();
    const html = await readFile(join(root, `docs/guides/${slug}.html`), "utf8");
    verifyCase(html);
    const page = publicSupportPages().find(p => p.slug === slug)!;
    expect(html).toContain(`<link rel="canonical" href="${baseUrl}/guides/${slug}.html"`);
    expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain(`<title>${page.title}</title>`);
    expect(html).toContain(`<p>${page.citation_answer}</p>`);
    expect(html).toContain(`${baseUrl}/go/line.html?source=guide-${slug}-cta`);
    expect(html).toContain('datetime="2026-09-14"');
    expect(html).toContain('"dateModified":"2026-09-14"');
    for (const text of [heading, "不是所有精品鞋的統一價格", "不是固定交件承諾", "由私享家門市提供"]) {
      expect(() => verifyCase(html.replace(text, "")), `mutation: ${text}`).toThrow();
    }
    verifyCase(html);
  });

  it("changes only the case page and its necessary date projections in a fixed-input full render", async () => {
    const page = publicSupportPages().find(p => p.slug === slug)!;
    expect(page.sections?.filter(s => s.heading === heading)).toHaveLength(1);
    const savedSections = page.sections;
    const savedDate = page.content_lastmod;
    let before: string;
    try {
      page.sections = savedSections!.filter(s => s.heading !== heading);
      page.content_lastmod = "2026-09-05";
      before = await render();
    } finally {
      page.sections = savedSections;
      page.content_lastmod = savedDate;
    }
    const after = await render();
    async function files(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      return (await Promise.all(entries.map(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))).flat();
    }
    const changed: string[] = [];
    for (const file of await files(join(before!, "docs"))) {
      const rel = relative(before!, file).replaceAll("\\", "/");
      if (!Buffer.from(await readFile(file)).equals(await readFile(join(after, rel)))) changed.push(rel);
    }
    expect(changed.sort()).toEqual([
      "docs/ai-sitemap.xml", "docs/guides/luxury-designer-shoe-care.html", "docs/knowledge-graph.json", "docs/knowledge/index.html", "docs/sitemap.xml"
    ]);
    const beforePage = await readFile(join(before!, `docs/guides/${slug}.html`), "utf8");
    const afterPage = await readFile(join(after, `docs/guides/${slug}.html`), "utf8");
    const stripChange = (html: string) => html.replace(new RegExp(`<article class="card">\\s*<h3>${heading}</h3>\\s*<p>[\\s\\S]*?</p>\\s*</article>\\s*`), "").replaceAll("2026-09-14", "2026-09-05").replace(/>\s+</g, "><");
    expect(stripChange(afterPage)).toBe(stripChange(beforePage));
  });
});
