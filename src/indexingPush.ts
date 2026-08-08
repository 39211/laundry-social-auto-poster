import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { writeJsonAtomic } from "./logging";
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
  host: string;
  sitemap_urls: number;
  submitted: number;
  indexnow_status: number | "skipped";
  audited: PageAudit[];
  thin_pages: string[];
  unreachable: string[];
  ok: boolean;
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

async function sitemapUrls(base: string): Promise<string[]> {
  const response = await fetch(`${base}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml returned ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "").filter(Boolean);
}

/** Pages changed today plus the always-important entry points. */
function pickSubmissionSet(urls: string[], date: string, base: string): string[] {
  const changedToday = urls.filter((url) => url.includes(date));
  const entryPoints = [`${base}/`, `${base}/sitemap.xml`];
  const landing = urls.filter((url) => url.includes("/guides/") || url.includes("/services/") || url.includes("/local/"));
  // IndexNow accepts up to 10,000 per call; keeping it small keeps the signal
  // meaningful instead of resubmitting the whole site every day.
  return [...new Set([...entryPoints, ...changedToday, ...landing])].slice(0, 60);
}

export async function indexingPush(options: { date?: string; root?: string; skipSubmit?: boolean } = {}): Promise<IndexingPushReport> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;
  const base = (config.publicSiteBaseUrl || "https://39211.github.io").replace(/\/+$/, "");
  const host = new URL(base).host;

  const urls = await sitemapUrls(base);
  const submission = pickSubmissionSet(urls, date, base);

  let indexnowStatus: number | "skipped" = "skipped";
  if (!options.skipSubmit) {
    const key = await readIndexNowKey(root);
    if (key) {
      const response = await fetch(INDEXNOW_ENDPOINT, {
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
      const response = await fetch(url);
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
    host,
    sitemap_urls: urls.length,
    submitted: submission.length,
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
