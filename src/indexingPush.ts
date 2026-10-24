import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// Daily indexing push and audit. Submitting the sitemap once is not what gets a
// small site indexed: the two levers that keep working are telling engines the
// moment a URL changes (IndexNow, which Bing and therefore ChatGPT search read)
// and proving the pages are actually reachable and substantial. This runs both
// every day and writes the evidence, so "is it indexed yet" stops being a guess.
//
// Thin pages are the 2026 blocker -- Google reports them as "crawled, currently
// not indexed" -- so the audit fails loudly when a page falls under the floor
// rather than quietly submitting something that will never be indexed.

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const THIN_PAGE_FLOOR = 600;

interface PageAudit {
  url: string;
  status: number;
  text_length: number;
  internal_links: number;
  thin: boolean;
}

export interface IndexingPushReport {
  date: string;
  /** The day whose lastmods were treated as changed; the real today, not `date`. */
  notify_date: string;
  host: string;
  sitemap_urls: number;
  submitted: number;
  /** IndexNow is only notified for a new semantic sitemap with URLs changed today. */
  submission_reason:
    | "sitemap_urls_changed_today"
    | "sitemap_unchanged_since_last_successful_submission"
    | "sitemap_changed_without_today_lastmod"
    | "submission_state_malformed";
  sitemap_semantic_sha256: string;
  indexnow_status: number | "skipped";
  audited: PageAudit[];
  thin_pages: string[];
  unreachable: string[];
  ok: boolean;
}

export interface SitemapEntry {
  url: string;
  lastmod: string | null;
}

interface IndexingPushState {
  sitemap_semantic_sha256: string;
  submitted_at: string;
  submitted_urls: string[];
}

function textLength(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return stripped.replace(/\s+/g, "").length;
}

function internalLinkCount(html: string, host: string): number {
  const matches = html.match(/href="[^"]*"/g) ?? [];
  return matches.filter((href) => href.includes(host) || /href="(?!https?:|mailto:|tel:|#)/.test(href)).length;
}

export function parseSitemapEntries(xml: string): SitemapEntry[] {
  return [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => {
    const body = match[1] ?? "";
    return {
      url: body.match(/<loc>\s*([^<]*?)\s*<\/loc>/u)?.[1]?.trim() ?? "",
      lastmod: body.match(/<lastmod>\s*([^<]*?)\s*<\/lastmod>/u)?.[1]?.trim() ?? null
    };
  });
}

function semanticSitemapHash(xml: string): string {
  return createHash("sha256").update(xml.replace(/^\uFEFF/u, "").replace(/\s+/gu, "")).digest("hex");
}

async function sitemapEntries(
  base: string,
  fetchImpl: typeof fetch
): Promise<{ entries: SitemapEntry[]; semantic_sha256: string }> {
  const response = await fetchImpl(`${base}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml returned ${response.status}`);
  const xml = await response.text();
  return {
    entries: parseSitemapEntries(xml).filter((entry) => Boolean(entry.url)),
    semantic_sha256: semanticSitemapHash(xml)
  };
}

/**
 * IndexNow is a changed-URL notification, not a daily sitemap ping. Sending
 * every landing page again when its sitemap lastmod did not change is neither
 * a new discovery signal nor evidence of Google indexing.
 *
 * The date compared here is the day the notification is being sent, never the
 * content date the pipeline happens to be building. Once generation moved to a
 * D+3 buffer, daily-generate.ps1 began passing today+3 to this command, and a
 * sitemap lastmod is always a real past-or-present date -- so the set was empty
 * on every run and IndexNow silently stopped firing after 2026-09-03. That is
 * why indexingPush takes notifyDate separately from the content date.
 */
export function pickSubmissionSet(entries: SitemapEntry[], date: string): string[] {
  return [
    ...new Set(
      entries
        .filter((entry) => entry.lastmod?.match(/^\d{4}-\d{2}-\d{2}/u)?.[0] === date)
        .map((entry) => entry.url)
    )
  ].slice(0, 60);
}

export function chooseIndexNowSubmission(input: {
  entries: SitemapEntry[];
  date: string;
  sitemapSemanticSha256: string;
  priorSitemapSemanticSha256?: string;
}): { urls: string[]; reason: IndexingPushReport["submission_reason"] } {
  if (input.priorSitemapSemanticSha256 === input.sitemapSemanticSha256) {
    return { urls: [], reason: "sitemap_unchanged_since_last_successful_submission" };
  }
  const urls = pickSubmissionSet(input.entries, input.date);
  return urls.length > 0
    ? { urls, reason: "sitemap_urls_changed_today" }
    : { urls: [], reason: "sitemap_changed_without_today_lastmod" };
}

function indexingPushStatePath(root: string): string {
  return join(root, "output", "operations", "indexing-push-state.json");
}

function isIndexingPushState(value: unknown): value is IndexingPushState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IndexingPushState).sitemap_semantic_sha256 === "string" &&
    typeof (value as IndexingPushState).submitted_at === "string" &&
    Array.isArray((value as IndexingPushState).submitted_urls) &&
    (value as IndexingPushState).submitted_urls.every((url) => typeof url === "string")
  );
}

export async function indexingPush(
  options: {
    date?: string;
    /**
     * The day whose sitemap lastmods count as "changed". Defaults to the real
     * zoned today and deliberately ignores `date`, which the pipeline sets to
     * the D+3 content day.
     */
    notifyDate?: string;
    root?: string;
    skipSubmit?: boolean;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<IndexingPushReport> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const today = getZonedDateParts(new Date(), config.timezone).date;
  const date = options.date || today;
  const notifyDate = options.notifyDate || today;
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.baseUrl || config.publicSiteBaseUrl || "https://39211.github.io").replace(/\/+$/, "");
  const host = new URL(base).host;

  const sitemap = await sitemapEntries(base, fetchImpl);
  const urls = sitemap.entries.map((entry) => entry.url);
  let previousState: unknown;
  try {
    previousState = await readJsonFile<unknown>(indexingPushStatePath(root), undefined);
  } catch {
    previousState = "malformed";
  }
  const selected = isIndexingPushState(previousState)
    ? chooseIndexNowSubmission({
        entries: sitemap.entries,
        date: notifyDate,
        sitemapSemanticSha256: sitemap.semantic_sha256,
        priorSitemapSemanticSha256: previousState.sitemap_semantic_sha256
      })
    : previousState === undefined
      ? chooseIndexNowSubmission({
          entries: sitemap.entries,
          date: notifyDate,
          sitemapSemanticSha256: sitemap.semantic_sha256
        })
      : { urls: [], reason: "submission_state_malformed" as const };
  const submission = selected.urls;
  const submissionReason = selected.reason;

  let indexnowStatus: number | "skipped" = "skipped";
  if (!options.skipSubmit && submission.length > 0) {
    const key = await readIndexNowKey(root);
    if (key) {
      const response = await fetchImpl(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host,
          key,
          keyLocation: `${base}/${key}.txt`,
          urlList: submission
        })
      });
      indexnowStatus = response.status;
      if (indexnowStatus === 200 || indexnowStatus === 202) {
        await writeJsonAtomic(indexingPushStatePath(root), {
          sitemap_semantic_sha256: sitemap.semantic_sha256,
          submitted_at: new Date().toISOString(),
          submitted_urls: submission
        } satisfies IndexingPushState);
      }
    }
  }

  // Audit the landing pages that carry the search intent, plus the newest post.
  const auditTargets = [
    `${base}/`,
    ...urls.filter((url) => url.includes("/guides/") || url.includes("/services/") || url.includes("/local/")),
    ...urls.filter((url) => url.includes("/posts/")).slice(-1)
  ];
  const audited: PageAudit[] = [];
  for (const url of auditTargets) {
    try {
      const response = await fetchImpl(url);
      const html = response.ok ? await response.text() : "";
      const length = textLength(html);
      audited.push({
        url,
        status: response.status,
        text_length: length,
        internal_links: internalLinkCount(html, host),
        thin: response.ok && length < THIN_PAGE_FLOOR
      });
    } catch {
      audited.push({ url, status: 0, text_length: 0, internal_links: 0, thin: false });
    }
  }

  const thin = audited.filter((page) => page.thin).map((page) => page.url);
  const unreachable = audited.filter((page) => page.status !== 200).map((page) => page.url);
  const report: IndexingPushReport = {
    date,
    notify_date: notifyDate,
    host,
    sitemap_urls: urls.length,
    submitted: submission.length,
    submission_reason: submissionReason,
    sitemap_semantic_sha256: sitemap.semantic_sha256,
    indexnow_status: indexnowStatus,
    audited,
    thin_pages: thin,
    unreachable,
    ok: unreachable.length === 0 && thin.length === 0 && (indexnowStatus === 200 || indexnowStatus === 202 || indexnowStatus === "skipped")
  };
  await writeJsonAtomic(join(root, "output", "operations", `indexing-push-${date}.json`), report);
  return report;
}

async function readIndexNowKey(root: string): Promise<string | undefined> {
  const { readdir } = await import("node:fs/promises");
  try {
    const entries = await readdir(join(root, "docs"));
    const keyFile = entries.find((name) => /^[A-Fa-f0-9]{32,}\.txt$/.test(name));
    if (!keyFile) return undefined;
    const contents = await readFile(join(root, "docs", keyFile), "utf8");
    return contents.trim() || keyFile.replace(/\.txt$/, "");
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const report = await indexingPush({
    date: getOption(args, "date"),
    notifyDate: getOption(args, "notify-date"),
    root: getOption(args, "root"),
    skipSubmit: args.includes("--no-submit")
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
