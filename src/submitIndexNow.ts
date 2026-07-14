import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export interface SubmitIndexNowOptions {
  root?: string;
  live?: boolean;
  key?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

function parseCanonicalHtmlUrls(sitemap: string): string[] {
  const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), ([, value]) => value?.trim() ?? "").filter(Boolean);
  const unique = new Set<string>();

  for (const value of urls) {
    const url = new URL(value);
    if (url.pathname.endsWith("/") || url.pathname.endsWith(".html")) unique.add(url.toString());
  }

  return [...unique];
}

function requireIndexNowKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key) throw new Error("INDEXNOW_KEY is required. Set it, regenerate the public site, publish the key file, then rerun with --live.");
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error("INDEXNOW_KEY must be 8-128 letters, numbers, or hyphens.");
  return key;
}

export async function submitIndexNow(options: SubmitIndexNowOptions = {}): Promise<{ dryRun: boolean; urlCount: number; host: string }> {
  const root = projectRoot(options.root);
  const key = requireIndexNowKey(options.key ?? process.env.INDEXNOW_KEY);
  const sitemap = await readFile(join(root, "docs", "sitemap.xml"), "utf8");
  const urlList = parseCanonicalHtmlUrls(sitemap);
  if (urlList.length === 0) throw new Error("The canonical sitemap has no human-facing HTML URLs to submit.");

  const firstUrl = new URL(urlList[0]!);
  if (urlList.some((value) => new URL(value).host !== firstUrl.host)) {
    throw new Error("The canonical sitemap must contain URLs for one host before IndexNow submission.");
  }

  const keyFileName = `${key}.txt`;
  const keyLocation = new URL(keyFileName, firstUrl).toString();
  if (!options.live) return { dryRun: true, urlCount: urlList.length, host: firstUrl.host };

  const localKey = (await readFile(join(root, "docs", keyFileName), "utf8")).trim();
  if (localKey !== key) {
    throw new Error(`docs/${keyFileName} does not match INDEXNOW_KEY. Run generate-public-site and publish-pages before live submission.`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const keyResponse = await fetchImpl(keyLocation);
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== key) {
    throw new Error("The public IndexNow key file is not reachable or does not match. Publish the public site before live submission.");
  }

  const response = await fetchImpl(options.endpoint ?? INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: firstUrl.host, key, keyLocation, urlList })
  });
  if (!response.ok) throw new Error(`IndexNow submission failed with HTTP ${response.status}.`);

  return { dryRun: false, urlCount: urlList.length, host: firstUrl.host };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const result = await submitIndexNow({
    root: getOption(args, "root"),
    live: getFlag(args, "live")
  });
  console.log(`${result.dryRun ? "IndexNow dry run" : "IndexNow submitted"}: ${result.urlCount} canonical HTML URLs for ${result.host}.`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
