import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TARGETS = [
  { path: "services/white-shoe-cleaning.html", finalFile: "final-white-shoe.md", finalHeading: "白鞋清潔服務", kind: "white-shoe" },
  { path: "guides/white-shoe-yellowing.html", finalFile: "final-white-shoe.md", finalHeading: "白鞋泛黃指南", kind: "white-shoe" },
  { path: "services/luxury-bag-cleaning.html", finalFile: "final-luxury-bag.md", finalHeading: "精品包清潔服務", kind: "luxury-bag" },
  { path: "guides/luxury-bag-mold.html", finalFile: "final-luxury-bag.md", finalHeading: "精品包發霉指南", kind: "luxury-bag" },
  { path: "services/down-jacket-cleaning.html", finalFile: "final-down-jacket.md", finalHeading: "羽絨外套清潔指南", kind: "down-jacket" },
  { path: "guides/down-jacket-cleaning.html", finalFile: "final-down-jacket.md", finalHeading: "羽絨外套清潔指南", kind: "down-jacket" }
] as const;

type Faq = { question: string; answer: string };
type FinalCopy = { headings: string[]; paragraphs: string[][]; faqs: Faq[] };
type JsonRecord = Record<string, unknown>;
type ElementBlock = { openTag: string; inner: string; start: number; end: number };
type MarkerSets = Record<"meta_names" | "meta_properties" | "link_rels" | "jsonld_types" | "section_aside_ids" | "script_srcs", string[]> & {
  link_rel_alternate_count: number;
  inline_gtag_config_count: number;
};

const markerFixture = JSON.parse(readFileSync(join(ROOT, "test/fixtures/aeo325/base-page-markers.json"), "utf8")) as {
  source_commit: string;
  pages: Record<string, MarkerSets>;
};

function readHtml(path: string): string {
  return readFileSync(join(ROOT, "seo-overrides", path), "utf8");
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (entity, code: string) => {
    if (code.toLowerCase() === "amp") return "&";
    if (code.toLowerCase() === "lt") return "<";
    if (code.toLowerCase() === "gt") return ">";
    if (code.toLowerCase() === "quot") return '"';
    if (code.toLowerCase() === "apos" || code === "#39") return "'";
    if (code.toLowerCase() === "nbsp") return " ";
    const number = code.startsWith("#x") ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

function textContent(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]*>/gu, " ")
  ).replace(/\s+/gu, " ").trim();
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "").trim() : undefined;
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "giu"))].map((match) => match[0]);
}

function balancedElements(html: string, name: string): ElementBlock[] {
  const token = new RegExp(`<(/?)${name}\\b[^>]*>`, "giu");
  const stack: Array<{ start: number; contentStart: number; openTag: string }> = [];
  const elements: ElementBlock[] = [];
  for (const match of html.matchAll(token)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (value.startsWith("</")) {
      const open = stack.pop();
      if (open) elements.push({
        openTag: open.openTag,
        inner: html.slice(open.contentStart, start),
        start: open.start,
        end: start + value.length
      });
    } else if (!value.endsWith("/>")) {
      stack.push({ start, contentStart: start + value.length, openTag: value });
    }
  }
  return elements.sort((left, right) => left.start - right.start);
}

function sectionHeading(section: ElementBlock): string {
  const heading = section.inner.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/iu)?.[0] ?? "";
  return textContent(heading);
}

function finalSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/u);
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`Missing final copy section: ${heading}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

function readFinalCopy(file: string, heading: string): FinalCopy {
  const markdown = readFileSync(join(ROOT, "docs-internal/aeo325", file), "utf8");
  const lines = finalSection(markdown, heading).split(/\r?\n/u);
  const headings: string[] = [];
  const paragraphs: string[][] = [];
  const faqs: Faq[] = [];
  let current = -1;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("### ")) {
      headings.push(line.slice(4).trim());
      paragraphs.push([]);
      current += 1;
      continue;
    }
    if (current === 4) {
      const faq = line.match(/^\*\*(.+?)\*\*\s*(.+)$/u);
      if (!faq) throw new Error(`Unexpected FAQ line in ${file} / ${heading}: ${line}`);
      faqs.push({ question: faq[1] ?? "", answer: faq[2] ?? "" });
      continue;
    }
    if (current < 0) throw new Error(`Copy paragraph appears before an H3 in ${file} / ${heading}`);
    paragraphs[current]?.push(line.replace(/\*\*/gu, "").trim());
  }
  return { headings, paragraphs, faqs };
}

function mainHtml(html: string): string {
  return balancedElements(html, "main")[0]?.inner ?? "";
}

function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter((match) => attribute(`<script ${match[1] ?? ""}>`, "type")?.toLowerCase() === "application/ld+json")
    .map((match) => JSON.parse(match[2] ?? "{}") as unknown);
}

function visitObjects(value: unknown, visit: (record: JsonRecord) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitObjects(item, visit);
  } else if (value && typeof value === "object") {
    const record = value as JsonRecord;
    visit(record);
    for (const child of Object.values(record)) visitObjects(child, visit);
  }
}

function schemaNodes(blocks: readonly unknown[]): JsonRecord[] {
  const result: JsonRecord[] = [];
  for (const block of blocks) visitObjects(block, (record) => result.push(record));
  return result;
}

function pageOwnedNodes(blocks: readonly unknown[], path: string, types: ReadonlySet<string>): JsonRecord[] {
  const pagePrefix = `https://sixiangjialaundry.com/${path}#`;
  const roots: JsonRecord[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const graph = (block as JsonRecord)["@graph"];
    const candidates = Array.isArray(graph) ? graph : [block];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const record = candidate as JsonRecord;
      const id = record["@id"];
      if (typeof id === "string" && id.startsWith(pagePrefix) && nodeTypes(record).some((type) => types.has(type))) {
        roots.push(record);
      }
    }
  }
  return roots;
}

function nodeTypes(record: JsonRecord): string[] {
  const type = record["@type"];
  if (typeof type === "string") return [type];
  return Array.isArray(type) ? type.filter((entry): entry is string => typeof entry === "string") : [];
}

function nodesOfTypes(blocks: readonly unknown[], types: ReadonlySet<string>): JsonRecord[] {
  return schemaNodes(blocks).filter((record) => nodeTypes(record).some((type) => types.has(type)));
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

function markerSets(html: string, blocks: readonly unknown[]): MarkerSets {
  const metas = tags(html, "meta");
  const links = tags(html, "link");
  const scripts = tags(html, "script");
  const types = new Set<string>();
  for (const block of blocks) visitObjects(block, (record) => nodeTypes(record).forEach((type) => types.add(type)));
  const unique = (values: Array<string | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
  const inlineGtagConfigCount = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter((match) => !attribute(`<script ${match[1] ?? ""}>`, "src"))
    .reduce((count, match) => count + [...(match[2] ?? "").matchAll(/gtag\(\s*['"]config['"]/giu)].length, 0);
  return {
    meta_names: unique(metas.map((tag) => attribute(tag, "name"))),
    meta_properties: unique(metas.map((tag) => attribute(tag, "property"))),
    link_rels: unique(links.map((tag) => attribute(tag, "rel"))),
    jsonld_types: [...types].sort(),
    section_aside_ids: unique(["section", "aside"].flatMap((name) => tags(html, name).map((tag) => attribute(tag, "id")))),
    script_srcs: unique(scripts.map((tag) => attribute(tag, "src"))),
    link_rel_alternate_count: links.filter((tag) => attribute(tag, "rel")?.split(/\s+/u).includes("alternate")).length,
    inline_gtag_config_count: inlineGtagConfigCount
  };
}

function visibleFaqs(html: string): Faq[] {
  const faqSection = balancedElements(html, "section").find((section) => attribute(section.openTag, "id") === "faq");
  if (!faqSection) return [];
  return balancedElements(faqSection.inner, "article")
    .filter((card) => attribute(card.openTag, "class")?.split(/\s+/u).includes("card"))
    .map((card) => ({
      question: textContent(card.inner.match(/<h3\b[^>]*>[\s\S]*?<\/h3>/iu)?.[0] ?? ""),
      answer: textContent(card.inner.match(/<p\b[^>]*>[\s\S]*?<\/p>/iu)?.[0] ?? "")
    }));
}

function schemaFaqs(blocks: readonly unknown[]): Faq[] {
  const faqPage = nodesOfTypes(blocks, new Set(["FAQPage"]))[0];
  const entities = faqPage?.mainEntity;
  if (!Array.isArray(entities)) return [];
  return entities.map((entity) => {
    const record = entity as JsonRecord;
    const answer = record.acceptedAnswer as JsonRecord | undefined;
    return { question: String(record.name ?? ""), answer: String(answer?.text ?? "") };
  });
}

function copyVisibleText(html: string, copy: FinalCopy): string {
  const main = mainHtml(html);
  const lead = balancedElements(main, "p").find((paragraph) => attribute(paragraph.openTag, "class")?.split(/\s+/u).includes("lead"));
  const faq = balancedElements(main, "section").find((section) => attribute(section.openTag, "id") === "faq");
  const copyHeadings = new Set(copy.headings.slice(1, 4));
  const changedSections = balancedElements(main, "section").filter((section) =>
    copyHeadings.has(sectionHeading(section)) || attribute(section.openTag, "id") === "aeo-u06"
  );
  const changedSectionText = changedSections.map((section) => {
    if (attribute(section.openTag, "id") !== "aeo-u06") return textContent(section.inner);
    const answerBox = balancedElements(section.inner, "div").find((block) => attribute(block.openTag, "class")?.split(/\s+/u).includes("answer-box"));
    return answerBox ? textContent(answerBox.inner) : "";
  });
  return [lead ? textContent(lead.inner) : "", ...changedSectionText, faq ? textContent(faq.inner) : ""]
    .filter(Boolean)
    .join(" ");
}

function sitemapEntries(xml: string): Array<{ loc: string; lastmod: string }> {
  return balancedElements(xml, "url").map((entry) => ({
    loc: textContent(entry.inner.match(/<loc\b[^>]*>[\s\S]*?<\/loc>/iu)?.[0] ?? ""),
    lastmod: textContent(entry.inner.match(/<lastmod\b[^>]*>[\s\S]*?<\/lastmod>/iu)?.[0] ?? "")
  }));
}

describe("AEO325 final page copy", () => {
  it.each(TARGETS)("parses every JSON-LD block on $path", ({ path }) => {
    const html = readHtml(path);
    const raw = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
      .filter((match) => attribute(`<script ${match[1] ?? ""}>`, "type")?.toLowerCase() === "application/ld+json")
      .map((match) => match[2] ?? "");
    expect(raw.length, path).toBeGreaterThan(0);
    for (const json of raw) expect(() => JSON.parse(json), path).not.toThrow();
  });

  it("keeps the white-shoe geo entity card inside a surface section", () => {
    const html = readHtml("services/white-shoe-cleaning.html");
    const geoIndex = html.indexOf('id="geo-entity"');
    const sectionAncestors = balancedElements(html, "section").filter((section) => section.start < geoIndex && section.end > geoIndex);
    expect(geoIndex, "white-shoe geo entity exists").toBeGreaterThanOrEqual(0);
    expect(sectionAncestors.some((section) => {
      const classes = attribute(section.openTag, "class")?.split(/\s+/u) ?? [];
      return classes.includes("section") && classes.includes("surface");
    })).toBe(true);
  });

  it("keeps the luxury-bag store and pickup card factual and bounded", () => {
    const main = mainHtml(readHtml("services/luxury-bag-cleaning.html"));
    const storeCard = balancedElements(main, "article").find((article) => {
      const heading = article.inner.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/iu)?.[1] ?? "";
      return textContent(heading) === "門市與收送";
    });
    expect(storeCard, "luxury-bag store and pickup card exists").toBeDefined();

    const cardText = textContent(storeCard?.inner ?? "");
    expect(cardText).toBe("門市與收送 門市在台中市西屯區青海路二段365號（至善國中對面），市話 04-2452-7411，LINE／手機 0968-327-653。週一至週五 10:00-20:00、週六 12:00-18:00、週日公休。免費收送、沒有最低消費。東海無門市（僅收送）。");
    expect(cardText).not.toMatch(/台中全市|台中市全區|台中市全市|台中市區|台中全區|保證|承諾|滅菌/u);
  });

  it.each(TARGETS)("renders final H3-2 to H3-5 and every copy paragraph on $path", ({ path, finalFile, finalHeading }) => {
    const copy = readFinalCopy(finalFile, finalHeading);
    const html = readHtml(path);
    const main = mainHtml(html);
    const mainText = textContent(main);
    const lead = balancedElements(main, "p").find((paragraph) => attribute(paragraph.openTag, "class")?.split(/\s+/u).includes("lead"));
    expect(copy.headings, `${path} final heading count`).toHaveLength(5);
    expect(copy.paragraphs[0], `${path} H3-1 introduction`).toHaveLength(1);
    expect(lead ? textContent(lead.inner) : "", `${path} hero introduction`).toBe(textContent(copy.paragraphs[0]?.[0] ?? ""));

    let previous = -1;
    for (const heading of copy.headings.slice(1)) {
      const position = mainText.indexOf(heading, previous + 1);
      expect(position, `${path} ordered heading: ${heading}`).toBeGreaterThan(previous);
      previous = position;
    }
    for (const paragraph of copy.paragraphs.slice(1, 4).flat()) {
      expect(mainText, `${path} missing final paragraph: ${paragraph}`).toContain(textContent(paragraph));
    }
  });

  it.each(TARGETS)("keeps the visible FAQ, FAQPage JSON-LD, and final FAQ identical on $path", ({ path, finalFile, finalHeading }) => {
    const expected = readFinalCopy(finalFile, finalHeading).faqs;
    const html = readHtml(path);
    const blocks = jsonLdBlocks(html);
    expect(expected, `${path} final FAQ count`).toHaveLength(3);
    expect(visibleFaqs(html), `${path} visible FAQ`).toEqual(expected);
    expect(schemaFaqs(blocks), `${path} FAQPage JSON-LD`).toEqual(expected);
    expect(visibleFaqs(html), `${path} visible/schema equality`).toEqual(schemaFaqs(blocks));
  });

  it.each(TARGETS)("retains the base marker sets and removes obsolete HowTo schema on $path", ({ path }) => {
    const expected = markerFixture.pages[path];
    expect(markerFixture.source_commit).toBe("766ada1c");
    expect(expected, `${path} base markers`).toBeDefined();
    const blocks = jsonLdBlocks(readHtml(path));
    const actual = markerSets(readHtml(path), blocks);
    const arrayKeys = ["meta_names", "meta_properties", "link_rels", "jsonld_types", "section_aside_ids", "script_srcs"] as const;
    for (const key of arrayKeys) {
      const expectedValues = key === "jsonld_types"
        ? (expected?.[key] ?? []).filter((type) => !["HowTo", "HowToStep", "HowToSupply"].includes(type))
        : expected?.[key] ?? [];
      expect(actual[key], `${path} marker set ${key}`).toEqual(expect.arrayContaining(expectedValues));
    }
    expect(actual.link_rel_alternate_count, `${path} link rel=alternate count`).toBe(expected?.link_rel_alternate_count);
    expect(actual.inline_gtag_config_count, `${path} inline gtag config count`).toBe(expected?.inline_gtag_config_count);
    expect(actual.inline_gtag_config_count, `${path} includes inline gtag config`).toBeGreaterThan(0);
    expect(actual.jsonld_types.filter((type) => ["HowTo", "HowToStep", "HowToSupply"].includes(type)), path).toEqual([]);
  });

  it.each(TARGETS)("has no forbidden wording in this round's copy or page-owned JSON-LD on $path", ({ path, finalFile, finalHeading, kind }) => {
    const copy = readFinalCopy(finalFile, finalHeading);
    const html = readHtml(path);
    const blocks = jsonLdBlocks(html);
    const ownedTypes = new Set(["WebPage", "Service", "Article", "FAQPage", "BreadcrumbList"]);
    const strings = [copyVisibleText(html, copy), ...pageOwnedNodes(blocks, path, ownedTypes).flatMap(stringsIn)].join(" ");
    const forbidden = /紫外線|臭氧|殺菌|滅菌|除菌|抑菌|徹底|杜絕|確保|絕不|不傷|專利|認證|食品級|原廠級|修復|還原|恢復機能|台中全市|台中市全區|台中市全市|台中市區|台中全區|全區免費|[0-9]{1,3}\s*[%％]/gu;
    expect([...strings.matchAll(forbidden)].map((match) => match[0]), path).toEqual([]);

    const disinfection = [...copyVisibleText(html, copy).matchAll(/消毒/gu)];
    const expectsDisinfection = kind !== "down-jacket";
    expect(disinfection.length > 0, `${path} disinfection phrase presence`).toBe(expectsDisinfection);
    for (const match of disinfection) {
      expect(copyVisibleText(html, copy).slice(match.index, (match.index ?? 0) + 4), path).toBe("消毒功能");
    }
    const days = [...copyVisibleText(html, copy).matchAll(/[0-9]{1,3}\s*天/gu)].map((match) => match[0].replace(/\s+/gu, " "));
    const expectedDays = kind === "white-shoe" ? ["7 天"] : kind === "luxury-bag" ? ["14 天"] : [];
    expect(days, `${path} turnaround days`).toEqual(expectedDays);
  });

  it.each(TARGETS)("keeps docs and seo-overrides byte-identical on $path", ({ path }) => {
    const source = readFileSync(join(ROOT, "seo-overrides", path));
    const output = readFileSync(join(ROOT, "docs", path));
    expect(output.equals(source), path).toBe(true);
  });

  it.each(TARGETS)("uses the final description and 2026-10-18 modification date on $path", ({ path, finalFile, finalHeading }) => {
    const copy = readFinalCopy(finalFile, finalHeading);
    const intro = copy.paragraphs[0]?.[0] ?? "";
    const description = (intro.match(/[^。]+。|[^。]+$/gu) ?? []).slice(0, 2).join("");
    expect([...description].length, `${path} description length`).toBeLessThanOrEqual(150);
    const html = readHtml(path);
    const head = balancedElements(html, "head")[0]?.inner ?? "";
    const metas = tags(head, "meta");
    const metaContent = (name: string, value: string) => metas.find((tag) => attribute(tag, name) === value);
    expect(attribute(metaContent("name", "description") ?? "", "content"), `${path} meta description`).toBe(description);
    expect(attribute(metaContent("property", "og:description") ?? "", "content"), `${path} OG description`).toBe(description);
    expect(attribute(metaContent("name", "twitter:description") ?? "", "content"), `${path} Twitter description`).toBe(description);

    const blocks = jsonLdBlocks(html);
    const ownedPageNodes = pageOwnedNodes(blocks, path, new Set(["WebPage", "Service", "Article"]));
    const describedNodes = ownedPageNodes.filter((node) => typeof node.description === "string");
    expect(describedNodes.length, `${path} JSON-LD description nodes`).toBeGreaterThan(0);
    expect(describedNodes.map((node) => node.description), `${path} JSON-LD descriptions`).toEqual(Array(describedNodes.length).fill(description));
    const dateNodes = ownedPageNodes.filter((node) => typeof node.dateModified === "string");
    expect(dateNodes.length, `${path} dateModified nodes`).toBeGreaterThan(0);
    expect(dateNodes.map((node) => node.dateModified), `${path} dateModified`).toEqual(Array(dateNodes.length).fill("2026-10-18"));

    const hero = balancedElements(mainHtml(html), "section").find((section) => attribute(section.openTag, "class")?.split(/\s+/u).includes("page-hero"));
    const heroTime = hero ? balancedElements(hero.inner, "time") : [];
    expect(heroTime.some((time) => attribute(time.openTag, "datetime") === "2026-10-18" && textContent(time.inner) === "2026-10-18"), `${path} hero time`).toBe(true);

    const canonical = tags(head, "link").find((tag) => attribute(tag, "rel")?.split(/\s+/u).includes("canonical"));
    if (path === "services/down-jacket-cleaning.html") {
      expect(attribute(canonical ?? "", "href")).toContain("/guides/down-jacket-cleaning.html");
    }
  });

  it("updates lastmod for managed target URLs without pinning sitemap URL sets", () => {
    const sitemapPaths = [
      "/services/white-shoe-cleaning.html",
      "/guides/white-shoe-yellowing.html",
      "/services/luxury-bag-cleaning.html",
      "/guides/luxury-bag-mold.html",
      "/guides/down-jacket-cleaning.html"
    ];
    const expectedBySitemap: Record<string, string[]> = {
      "sitemap.xml": sitemapPaths,
      "ai-sitemap.xml": [
        "/services/white-shoe-cleaning.html",
        "/guides/white-shoe-yellowing.html",
        "/guides/luxury-bag-mold.html",
        "/guides/down-jacket-cleaning.html"
      ]
    };
    for (const file of ["sitemap.xml", "ai-sitemap.xml"]) {
      const entries = sitemapEntries(readFileSync(join(ROOT, "docs", file), "utf8"));
      const expectedPaths = expectedBySitemap[file] ?? [];
      for (const sitemapPath of expectedPaths) {
        const entry = entries.find((candidate) => new URL(candidate.loc).pathname === sitemapPath);
        expect(entry?.lastmod, `${file} ${sitemapPath}`).toBe("2026-10-18");
      }
      expect(entries.some((entry) => new URL(entry.loc).pathname === "/services/down-jacket-cleaning.html"), `${file} excludes canonicalized down service`).toBe(false);
    }
  });
});
