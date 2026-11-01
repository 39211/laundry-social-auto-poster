import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getZonedDateParts } from "./scheduler";

/** 公開資產日曆日固定用台北。台灣沒有日光節約時間。 */
export const PUBLIC_ASSET_RUN_TIMEZONE = "Asia/Taipei";

const DATED_PUBLIC_ASSET = /(?:^|\/)assets\/(\d{4}-\d{2}-\d{2})(?:\/|$)/u;

const XML_INDEXES = ["sitemap.xml", "ai-sitemap.xml"];
const LINE_INDEXES = ["llms.txt", "llms-lite.txt", "llms-full.txt", ".well-known/llms.txt", "rss.xml"];
const JSONL_INDEXES = ["llms.jsonl"];
const JSON_INDEXES = [
  "feed.json",
  "social-posts.json",
  "latest.json",
  "ai-discovery.json",
  ".well-known/ai.json",
  "knowledge-graph.json",
  "answers.json",
  "services.json",
  "search-visibility.json",
  "geo-targets.json",
  "business-profile.json"
];

export function taipeiRunDate(now: Date): string {
  return getZonedDateParts(now, PUBLIC_ASSET_RUN_TIMEZONE).date;
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

/** `assets/YYYY-MM-DD` 或 `docs/assets/YYYY-MM-DD/...`，日期晚於執行日才算未來。 */
export function isFutureDatedPublicAssetPath(relativePath: string, runDate: string): boolean {
  const match = normalizeSlashes(relativePath).match(DATED_PUBLIC_ASSET);
  return Boolean(match?.[1] && match[1] > runDate);
}

export function containsFutureDatedPublicAsset(value: string, runDate: string): boolean {
  const pattern = new RegExp(DATED_PUBLIC_ASSET.source, "gu");
  for (const match of normalizeSlashes(value).matchAll(pattern)) {
    if ((match[1] ?? "") > runDate) return true;
  }
  return false;
}

export function omitFutureDatedPublicAssets(paths: string[], runDate: string): string[] {
  return paths.filter((path) => !isFutureDatedPublicAssetPath(path, runDate));
}

function stripFutureDatedAssetLines(text: string, runDate: string): string {
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  const kept = lines.filter((line, index) => {
    if (index === lines.length - 1 && line === "") return true;
    return !containsFutureDatedPublicAsset(line, runDate);
  });
  const body = kept.join("\n");
  if (endsWithNewline && body.length > 0 && !body.endsWith("\n")) return `${body}\n`;
  return body;
}

function stripFutureDatedAssetUrlBlocks(xml: string, runDate: string): string {
  const withoutBlocks = xml.replace(/[ \t]*<url\b[^>]*>[\s\S]*?<\/url>[ \t]*(?:\r?\n)?/gu, (block) =>
    containsFutureDatedPublicAsset(block, runDate) ? "" : block
  );
  if (!containsFutureDatedPublicAsset(withoutBlocks, runDate)) return withoutBlocks;
  return stripFutureDatedAssetLines(withoutBlocks, runDate);
}

function scrubJsonValue(value: unknown, runDate: string): unknown {
  if (typeof value === "string") return containsFutureDatedPublicAsset(value, runDate) ? undefined : value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubJsonValue(item, runDate)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const scrubbed = scrubJsonValue(child, runDate);
      if (scrubbed !== undefined) next[key] = scrubbed;
    }
    return next;
  }
  return value;
}

function stripFutureDatedAssetJsonl(text: string, runDate: string, relativePath: string): string {
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index === lines.length - 1 && line === "") {
      kept.push(line);
      continue;
    }
    if (!line.trim() || !containsFutureDatedPublicAsset(line, runDate)) {
      kept.push(line);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Refusing to publish future-dated assets: ${relativePath} has a non-JSON line (${(error as Error).message}).`
      );
    }
    const scrubbed = scrubJsonValue(parsed, runDate);
    if (scrubbed === undefined) continue;
    if (scrubbed && typeof scrubbed === "object" && !Array.isArray(scrubbed) && Object.keys(scrubbed).length === 0) {
      continue;
    }
    kept.push(JSON.stringify(scrubbed));
  }
  const body = kept.join("\n");
  if (endsWithNewline && body.length > 0 && !body.endsWith("\n")) return `${body}\n`;
  return body;
}

function readIndex(docsRoot: string, relativePath: string): { file: string; text: string } | undefined {
  const file = join(docsRoot, ...relativePath.split("/"));
  if (!existsSync(file)) return undefined;
  return { file, text: readFileSync(file, "utf8") };
}

function writeIfChanged(file: string, next: string, current: string): void {
  if (next !== current) writeFileSync(file, next);
}

/**
 * 從 sitemap、ai-sitemap、llms*、RSS 與 JSON 索引拿掉未來日期的 assets/YYYY-MM-DD。
 * 執行日當天與更早的資產保留。檔案沒有未來資產時不改寫。
 */
export function stripFutureDatedPublicAssetIndexes(docsRoot: string, runDate: string): void {
  for (const relativePath of XML_INDEXES) {
    const loaded = readIndex(docsRoot, relativePath);
    if (!loaded || !containsFutureDatedPublicAsset(loaded.text, runDate)) continue;
    writeIfChanged(loaded.file, stripFutureDatedAssetUrlBlocks(loaded.text, runDate), loaded.text);
  }

  for (const relativePath of LINE_INDEXES) {
    const loaded = readIndex(docsRoot, relativePath);
    if (!loaded || !containsFutureDatedPublicAsset(loaded.text, runDate)) continue;
    writeIfChanged(loaded.file, stripFutureDatedAssetLines(loaded.text, runDate), loaded.text);
  }

  for (const relativePath of JSONL_INDEXES) {
    const loaded = readIndex(docsRoot, relativePath);
    if (!loaded || !containsFutureDatedPublicAsset(loaded.text, runDate)) continue;
    writeIfChanged(loaded.file, stripFutureDatedAssetJsonl(loaded.text, runDate, relativePath), loaded.text);
  }

  for (const relativePath of JSON_INDEXES) {
    const loaded = readIndex(docsRoot, relativePath);
    if (!loaded || !containsFutureDatedPublicAsset(loaded.text, runDate)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(loaded.text);
    } catch (error) {
      throw new Error(
        `Refusing to publish future-dated assets: ${relativePath} is not valid JSON (${(error as Error).message}).`
      );
    }
    writeIfChanged(loaded.file, `${JSON.stringify(scrubJsonValue(parsed, runDate), null, 2)}\n`, loaded.text);
  }
}
