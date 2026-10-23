import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const OVERRIDE_ROOT = join(REPO_ROOT, "seo-overrides");
const RETIRED_LINE_ID = "4m-rA6hxf6";
const RETIRED_LINE_PATH = "line.me/ti/p";
const OFFICIAL_LINE_URL = "https://lin.ee/w8qGVqM";

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function posixRelative(file: string): string {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

function lineHits(text: string, needle: string): number[] {
  const lines: number[] = [];
  text.split(/\n/u).forEach((line, index) => {
    if (line.includes(needle)) lines.push(index + 1);
  });
  return lines;
}

function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((match) =>
    JSON.parse(match[1] ?? "")
  );
}

function stringsAt(node: unknown, key: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown, parentKey: string): void => {
    if (Array.isArray(value)) {
      if (parentKey === key) {
        for (const item of value) if (typeof item === "string") found.push(item);
      }
      for (const item of value) visit(item, parentKey);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) {
      if (childKey === key && typeof child === "string") found.push(child);
      visit(child, childKey);
    }
  };
  visit(node, "");
  return found;
}

describe("main 追蹤的 seo-overrides 公開輸出", () => {
  it("不得再出現已停用的 LINE id 4m-rA6hxf6", async () => {
    const files = (await walk(OVERRIDE_ROOT)).sort();
    const hits: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const lines = new Set([...lineHits(text, RETIRED_LINE_ID), ...lineHits(text, RETIRED_LINE_PATH)]);
      for (const line of lines) hits.push(`${posixRelative(file)}:${line}`);
    }
    expect(hits).toEqual([]);

    const redirectPath = join(OVERRIDE_ROOT, "go", "line.html");
    const redirect = await readFile(redirectPath, "utf8");
    expect(redirect).toContain(`const destination = ${JSON.stringify(OFFICIAL_LINE_URL)}`);
    expect(redirect).toContain(`href="${OFFICIAL_LINE_URL}"`);
    expect(redirect).toContain(`url=${OFFICIAL_LINE_URL}`);
    expect(redirect).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(redirect).toMatch(/window\.gtag\(\s*'event'\s*,\s*'line_click'/u);
    expect(redirect).toContain("params.get('source')");
    expect(redirect).toContain("link_source: source");
    expect(redirect).toContain("source: source");
    expect(redirect).toContain("location.replace(destination)");

    const indexHtml = await readFile(join(OVERRIDE_ROOT, "index.html"), "utf8");
    const indexBlocks = jsonLdBlocks(indexHtml);
    const contactUrls = indexBlocks.flatMap((block) => stringsAt(block, "url"));
    const sameAs = indexBlocks.flatMap((block) => stringsAt(block, "sameAs"));
    const urlTemplates = indexBlocks.flatMap((block) => stringsAt(block, "urlTemplate"));
    expect(contactUrls).toContain(OFFICIAL_LINE_URL);
    expect(sameAs).toContain(OFFICIAL_LINE_URL);
    expect(urlTemplates).toContain(OFFICIAL_LINE_URL);

    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (file.endsWith(".json")) JSON.parse(text);
      if (!file.endsWith(".html")) continue;
      const blocks = jsonLdBlocks(text);
      for (const block of blocks) {
        for (const value of [
          ...stringsAt(block, "url"),
          ...stringsAt(block, "sameAs"),
          ...stringsAt(block, "urlTemplate")
        ]) {
          expect(value, posixRelative(file)).not.toContain(RETIRED_LINE_ID);
          expect(value, posixRelative(file)).not.toContain(RETIRED_LINE_PATH);
        }
      }
    }
  });
});
