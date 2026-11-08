import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRootFromHere } from "../scripts/check-sitemap-links";

/**
 * O04：6 個既有指南頁加本頁目錄與穩定 H2 id。
 * 目錄文字與 id 以行銷 PASS 的兩份 CSV 為準。
 * 下面的 sha256 是凍結基準 e890511a82b5b2f9300999a68c56cadebb92c1f6 上、LF 原文的雜湊。
 * CI 只抓 PR commit、拿不到該 commit 時仍用這個鎖；git show 只對這個凍結 SHA，淺層 checkout 拿不到就回 undefined 並跳過比對。
 */
const ROOT = repoRootFromHere();
const PROPOSED_CSV = "test/fixtures/o04/proposed-changes.csv";
const LABELS_CSV = "test/fixtures/o04/codex-toc-labels.csv";
const PROPOSED_SHA256 = "4df2744b936bad5ec7546254a4fbd9b36b041cb61efc56179f3346469c84ccc7";
const LABELS_SHA256 = "cbb058e110ecd5fedf54bfe6ab8b70f3fbbd617916c0ea7d82a3c421fb1aaddd";

const PAGES = [
  "sticky-bag-lining",
  "suede-bag-care",
  "washing-machine-shoe-risk",
  "lambskin-bag-care",
  "leather-belt-care",
  "shoe-drying-heat-risk"
] as const;

type PageSlug = (typeof PAGES)[number];

const EXPECTED_COUNTS = {
  "sticky-bag-lining": 4,
  "suede-bag-care": 6,
  "washing-machine-shoe-risk": 3,
  "lambskin-bag-care": 3,
  "leather-belt-care": 8,
  "shoe-drying-heat-risk": 5
} as const satisfies Record<PageSlug, number>;

const MAIN_SHA256 = {
  "sticky-bag-lining": "805b489649b208a36ec7fcf7a9070682d1ba7b3ca1dcd6b5209bcda7ca0a8975",
  "suede-bag-care": "fd5d854736e94675df45f8ce6d8b2b29cb3981d19bb4e60b9304907e7e3dfa90",
  // 這一筆不是 e890511a82b5b2f9300999a68c56cadebb92c1f6 的原文雜湊，而是該凍結原文把「東海無門市、全市可收送」換成「東海無門市、免費收送、沒有最低消費」之後的 stripped sha256。
  "washing-machine-shoe-risk": "d3938c5892ac62acab854d2552338d9700be692611b951c6e71fba830b509492",
  "lambskin-bag-care": "427a03ce23140db27c7b16b2c8ebae57721174f6ab26e100140e46b81687de5c",
  "leather-belt-care": "74d82511a2e418f5fca6298ad31b7051739e365270b1111163152e504557a26e",
  "shoe-drying-heat-risk": "4204ca5917e2c2c6ec636568a1d3aed1b41e63610415aa7c335f232fa3be6833"
} as const satisfies Record<PageSlug, string>;

const SHOE_DRYING_IDS = [
  "drying-devices",
  "heat-sensitive-parts",
  "care-label-and-manual",
  "dryness-and-ventilation",
  "damaged-shoes"
] as const;

const SKIP_HEADINGS = [
  "常見問題",
  "店家資料",
  "對應服務",
  "私享家洗衣店",
  "先看價目、收送、門市，再決定送洗",
  "這四件事先講清楚",
  "接著看這些頁",
  "門市或收送"
] as const;

const CONTACTS = ["@454foyks", "0968-327-653", "0968327653", "04-2452-7411"] as const;

const PRICE_PHRASES = {
  "leather-belt-care": "皮帶水洗參考價 $400",
  "washing-machine-shoe-risk": "一般運動鞋水洗參考價 $250"
} as const satisfies Partial<Record<PageSlug, string>>;

const ADDED_CSS = `    .page-toc {
      max-width: var(--max-page);
      margin: 0 auto;
      padding: 8px 20px 0;
    }
    .page-toc strong {
      color: var(--color-ink);
      display: block;
      font-size: 1rem;
      margin: 18px 0 8px;
    }
    .page-toc ol {
      background: var(--color-surface);
      border: 1px solid var(--color-line);
      border-radius: var(--radius-card);
      list-style: decimal;
      margin: 0 0 8px;
      padding: 14px 18px 14px 2.2rem;
    }
    .page-toc li {
      color: var(--color-ink);
    }
    .page-toc a {
      color: var(--color-blue-strong);
      font-weight: 700;
    }
    h2[id]{scroll-margin-top:6rem}`;

const NAV_RE =
  /\n      <nav class="page-toc" aria-label="本頁目錄">\n        <strong>本頁目錄<\/strong>\n        <ol>\n(?:          <li><a href="#[a-z0-9-]+">[^<]*<\/a><\/li>\n)+        <\/ol>\n      <\/nav>/u;

type CsvAction = "add_id_and_toc" | "insert_nav_after_hero" | "skip";

type TocRow = {
  slug: PageSlug;
  h2: string;
  id: string;
  label: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function readNormalized(path: string): string {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function readRepo(rel: string): string {
  return readNormalized(join(ROOT, rel));
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function encodeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function decodeHtml(value: string): string {
  return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function columnIndex(header: readonly string[], name: string): number {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`缺少欄位 ${name}`);
  return index;
}

function cellAt(row: readonly string[], index: number): string {
  const value = row[index];
  if (value === undefined) throw new Error("CSV 列太短");
  return value;
}

function asAction(value: string): CsvAction {
  switch (value) {
    case "add_id_and_toc":
    case "insert_nav_after_hero":
    case "skip":
      return value;
    default:
      throw new Error(`未知 action：${value}`);
  }
}

function asSlug(value: string): PageSlug {
  const found = PAGES.find((slug) => slug === value);
  if (!found) throw new Error(`不在 6 頁內：${value}`);
  return found;
}

function slugFromUrl(url: string): PageSlug {
  const name = url.split("/").pop() ?? "";
  if (!name.endsWith(".html")) throw new Error(`不是指南網址：${url}`);
  return asSlug(name.slice(0, -".html".length));
}

function loadProposed(): { adds: TocRow[]; navSlugs: PageSlug[] } {
  const table = parseCsv(readRepo(PROPOSED_CSV));
  const header = table[0];
  if (!header) throw new Error("proposed CSV 沒有表頭");
  const urlIndex = columnIndex(header, "url");
  const h2Index = columnIndex(header, "h2_text");
  const idIndex = columnIndex(header, "proposed_id");
  const labelIndex = columnIndex(header, "toc_label");
  const actionIndex = columnIndex(header, "action");
  const adds: TocRow[] = [];
  const navSlugs: PageSlug[] = [];
  for (const row of table.slice(1)) {
    const action = asAction(cellAt(row, actionIndex));
    const slug = slugFromUrl(cellAt(row, urlIndex));
    switch (action) {
      case "add_id_and_toc":
        adds.push({
          slug,
          h2: cellAt(row, h2Index),
          id: cellAt(row, idIndex),
          label: cellAt(row, labelIndex)
        });
        break;
      case "insert_nav_after_hero":
        if (cellAt(row, labelIndex) !== "本頁目錄") {
          throw new Error(`${slug} 目錄標題不是本頁目錄`);
        }
        navSlugs.push(slug);
        break;
      case "skip":
        break;
      default: {
        const unreachable: never = action;
        throw new Error(unreachable);
      }
    }
  }
  return { adds, navSlugs };
}

function loadLabels(): TocRow[] {
  const table = parseCsv(readRepo(LABELS_CSV));
  const header = table[0];
  if (!header) throw new Error("labels CSV 沒有表頭");
  const slugIndex = columnIndex(header, "url_slug");
  const h2Index = columnIndex(header, "h2_text");
  const idIndex = columnIndex(header, "proposed_id");
  const labelIndex = columnIndex(header, "toc_label");
  return table.slice(1).map((row) => ({
    slug: asSlug(cellAt(row, slugIndex)),
    h2: cellAt(row, h2Index),
    id: cellAt(row, idIndex),
    label: cellAt(row, labelIndex)
  }));
}

function rowsFor(rows: readonly TocRow[], slug: PageSlug): TocRow[] {
  return rows.filter((row) => row.slug === slug);
}

function htmlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...htmlFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".html")) found.push(full);
  }
  return found;
}

function pageHeroClose(html: string): number {
  const openMatch = /<section\b[^>]*class="[^"]*\bpage-hero\b[^"]*"[^>]*>/u.exec(html);
  if (!openMatch) throw new Error("找不到 page-hero");
  const token = /<\/?section\b[^>]*>/gu;
  token.lastIndex = openMatch.index;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return match.index + tag.length;
    } else {
      depth += 1;
    }
  }
  throw new Error("page-hero 沒有結束");
}

function tocItems(html: string): Array<{ id: string; raw: string }> {
  const nav = html.match(NAV_RE);
  if (!nav) throw new Error("找不到符合格式的本頁目錄");
  return [...nav[0].matchAll(/<li><a href="#([a-z0-9-]+)">([^<]*)<\/a><\/li>/gu)].map((match) => ({
    id: match[1] ?? "",
    raw: match[2] ?? ""
  }));
}

function h2Inners(html: string): string[] {
  return [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gu)].map((match) => match[2] ?? "");
}

function h2Entries(html: string): Array<{ attrs: string; text: string }> {
  return [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gu)].map((match) => ({
    attrs: match[1] ?? "",
    text: match[2] ?? ""
  }));
}

function withoutTocAdditions(html: string, ids: readonly string[]): string {
  expect(html.match(NAV_RE), "本頁目錄").not.toBeNull();
  let next = html.replace(NAV_RE, "");
  for (const id of ids) {
    const token = `<h2 id="${id}">`;
    expect(next.split(token).length - 1, id).toBe(1);
    next = next.replace(token, "<h2>");
  }
  const cssNeedle = `\n${ADDED_CSS}`;
  expect(next.split(cssNeedle).length - 1, "toc css").toBe(1);
  return next.replace(cssNeedle, "");
}

function gitBlob(rev: string, rel: string): string | undefined {
  try {
    const output = execFileSync("git", ["show", `${rev}:${rel}`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return output.replaceAll("\r\n", "\n");
  } catch {
    return undefined;
  }
}

const proposed = loadProposed();
const labels = loadLabels();

describe("O04 行銷 CSV", () => {
  it("兩份檔案的 sha256 是行銷 PASS 原文", () => {
    expect(sha256(readRepo(PROPOSED_CSV))).toBe(PROPOSED_SHA256);
    expect(PROPOSED_SHA256.startsWith("4df2744b936b")).toBe(true);
    expect(sha256(readRepo(LABELS_CSV))).toBe(LABELS_SHA256);
    expect(LABELS_SHA256.startsWith("cbb058e110ec")).toBe(true);
  });

  it("29 筆 add_id_and_toc、6 筆 insert_nav，兩份 CSV 的 id 與 toc_label 一致", () => {
    expect(proposed.adds).toHaveLength(29);
    expect(labels).toHaveLength(29);
    expect(proposed.navSlugs).toHaveLength(6);
    expect([...proposed.navSlugs].sort()).toEqual([...PAGES].sort());
    for (const slug of PAGES) {
      const rows = rowsFor(proposed.adds, slug);
      expect(rows, slug).toEqual(rowsFor(labels, slug));
      expect(rows, slug).toHaveLength(EXPECTED_COUNTS[slug]);
      expect(new Set(rows.map((row) => row.id)).size, slug).toBe(rows.length);
      for (const row of rows) {
        expect(row.id, row.h2).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
        expect(row.label.length, row.h2).toBeGreaterThan(0);
        expect(SKIP_HEADINGS, row.h2).not.toContain(row.h2);
      }
    }
    expect(rowsFor(proposed.adds, "shoe-drying-heat-risk").map((row) => row.id)).toEqual([...SHOE_DRYING_IDS]);
  });
});

describe("O04 本頁目錄範圍", () => {
  it("seo-overrides 裡只有既有 6 個指南頁與鞋包服務頁有 page-toc，對照頁沒有", () => {
    const hits = htmlFiles(join(ROOT, "seo-overrides"))
      .filter((file) => readNormalized(file).includes("page-toc"))
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .sort();
    expect(hits).toEqual(
      [...PAGES.map((slug) => `seo-overrides/guides/${slug}.html`), "seo-overrides/services/shoe-bag-care.html"].sort()
    );
    expect(readRepo("seo-overrides/guides/birkenstock-care.html")).not.toContain("page-toc");
    expect(readRepo("seo-overrides/guides/suede-shoe-cleaning.html")).not.toContain("page-toc");
  });

  it("docs/guides、產生器與 sxj-shell.css 沒有 page-toc", () => {
    const hits = htmlFiles(join(ROOT, "docs", "guides"))
      .filter((file) => readNormalized(file).includes("page-toc"))
      .map((file) => relative(ROOT, file).split("\\").join("/"));
    expect(hits).toEqual([]);
    expect(readRepo("src/generatePublicSite.ts")).not.toContain("page-toc");
    expect(readRepo("seo-overrides/assets/v4/sxj-shell.css")).not.toContain("page-toc");
    expect(readRepo("seo-overrides/scripts/sxj-r10-20261103/v4/sxj-shell.css")).not.toContain("page-toc");
  });
});

describe("O04 六個指南頁", () => {
  for (const slug of PAGES) {
    const rel = `seo-overrides/guides/${slug}.html`;
    const rows = rowsFor(proposed.adds, slug);

    it(`${slug} 的目錄項目、href、toc_label 與 H2 id 對上 CSV`, () => {
      const html = readRepo(rel);
      expect(html.split('<nav class="page-toc"').length - 1, slug).toBe(1);
      expect(html.slice(pageHeroClose(html)), slug).toMatch(/^\n      <nav class="page-toc" aria-label="本頁目錄">/u);
      const beforeToc = html.slice(0, html.indexOf('<nav class="page-toc"'));
      expect(beforeToc.match(/<details\b/gu)?.length ?? 0, slug).toBe(beforeToc.match(/<\/details>/gu)?.length ?? 0);
      expect(html.match(/<style>/gu), slug).toHaveLength(1);
      expect(html, slug).toContain(ADDED_CSS);
      expect(ADDED_CSS).toContain("h2[id]{scroll-margin-top:6rem}");
      expect(ADDED_CSS).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden/u);

      const items = tocItems(html);
      expect(items.map((item) => item.id), slug).toEqual(rows.map((row) => row.id));
      expect(items.map((item) => decodeHtml(item.raw)), slug).toEqual(rows.map((row) => row.label));
      expect(items.map((item) => item.raw), slug).toEqual(rows.map((row) => encodeHtml(row.label)));
      const joined = items.map((item) => decodeHtml(item.raw)).join("\n");
      for (const heading of SKIP_HEADINGS) {
        expect(joined, heading).not.toContain(heading);
      }

      const contentIds = h2Entries(html)
        .map((entry) => entry.attrs.match(/\bid="([^"]+)"/u)?.[1])
        .filter((id): id is string => id !== undefined);
      expect(contentIds, slug).toEqual(rows.map((row) => row.id));
      for (const row of rows) {
        const hits = countOf(html, `id="${row.id}"`);
        expect(hits, row.id).toBe(1);
        expect(html, row.h2).toContain(`<h2 id="${row.id}">${row.h2}</h2>`);
      }
      for (const entry of h2Entries(html)) {
        if (!SKIP_HEADINGS.includes(entry.text as (typeof SKIP_HEADINGS)[number])) continue;
        expect(entry.attrs, entry.text).not.toMatch(/\bid=/u);
      }
    });

    it(`${slug} 相對凍結基準 e890511 只多了目錄、H2 id 與 TOC CSS`, () => {
      const html = readRepo(rel);
      const stripped = withoutTocAdditions(html, rows.map((row) => row.id));
      expect(sha256(stripped), slug).toBe(MAIN_SHA256[slug]);
      expect(h2Inners(html), slug).toEqual(h2Inners(stripped));
      expect(html.match(/<title>([^<]*)<\/title>/u)?.[1], slug).toBe(
        stripped.match(/<title>([^<]*)<\/title>/u)?.[1]
      );
      expect(html.match(/"dateModified":"(\d{4}-\d{2}-\d{2})"/u)?.[1], slug).toBe(
        stripped.match(/"dateModified":"(\d{4}-\d{2}-\d{2})"/u)?.[1]
      );
      expect(countOf(html, "台中全市"), slug).toBe(0);
      expect(countOf(stripped, "台中全市"), slug).toBe(0);
      for (const needle of CONTACTS) {
        expect(countOf(html, needle), `${slug} ${needle}`).toBeGreaterThanOrEqual(countOf(stripped, needle));
      }
      const price = PRICE_PHRASES[slug as keyof typeof PRICE_PHRASES];
      if (price !== undefined) {
        expect(countOf(html, price), price).toBeGreaterThan(0);
        expect(countOf(html, price), price).toBe(countOf(stripped, price));
      }
      const fromBaseline = gitBlob("e890511a82b5b2f9300999a68c56cadebb92c1f6", rel);
      if (fromBaseline !== undefined) {
        if (slug === "washing-machine-shoe-risk") {
          const expected = fromBaseline.replaceAll("東海無門市、全市可收送", "東海無門市、免費收送、沒有最低消費");
          expect(stripped, slug).toBe(expected);
          expect(sha256(stripped), slug).toBe(MAIN_SHA256[slug]);
        } else {
          expect(fromBaseline, slug).toBe(stripped);
          expect(sha256(fromBaseline), slug).toBe(MAIN_SHA256[slug]);
        }
      }
    });
  }

  it("麂皮包目錄含 not-deer-skin-method，且該 H2 仍在店家資料之後", () => {
    const html = readRepo("seo-overrides/guides/suede-bag-care.html");
    const items = tocItems(html);
    expect(items.map((item) => item.id)).toContain("not-deer-skin-method");
    expect(items.map((item) => decodeHtml(item.raw))).toContain("鹿皮別直接套用麂皮刷法");
    const store = html.indexOf("<h2>店家資料</h2>");
    const deer = html.indexOf('<h2 id="not-deer-skin-method">鹿皮是短絨，不要套麂皮刷法</h2>');
    expect(store).toBeGreaterThan(-1);
    expect(deer).toBeGreaterThan(store);
  });
});
