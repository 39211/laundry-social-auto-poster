import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { submitIndexNow } from "../src/submitIndexNow";

const TEST_KEY = "test-indexnow-key";
const TEST_ORIGIN = "https://39211.github.io";

interface FixturePage {
  path: string;
  robots?: string;
  googlebot?: string;
  body?: string;
}

async function writePages(root: string, pages: FixturePage[]): Promise<void> {
  await mkdir(join(root, "docs"), { recursive: true });
  const locs = pages.map((page) => `<url><loc>${TEST_ORIGIN}${page.path}</loc></url>`);
  await writeFile(
    join(root, "docs", "sitemap.xml"),
    ['<?xml version="1.0" encoding="UTF-8"?>', "<urlset>", ...locs, "</urlset>", ""].join("\n"),
    "utf8"
  );
  for (const page of pages) {
    if (page.robots === undefined && page.googlebot === undefined && page.body === undefined) continue;
    const relative = page.path.endsWith("/") ? `${page.path.slice(1)}index.html` : page.path.slice(1);
    const filePath = join(root, "docs", relative);
    await mkdir(dirname(filePath), { recursive: true });
    const metas = [
      page.robots !== undefined ? `<meta name="robots" content="${page.robots}" />` : "",
      page.googlebot !== undefined ? `<meta name="googlebot" content="${page.googlebot}" />` : ""
    ].filter(Boolean);
    await writeFile(
      filePath,
      `<!doctype html><html><head>${metas.join("")}</head><body>${page.body ?? ""}</body></html>`,
      "utf8"
    );
  }
}

async function submitLive(root: string): Promise<{ urlCount: number; urlList: string[]; endpoint: string }> {
  await writeFile(join(root, "docs", `${TEST_KEY}.txt`), `${TEST_KEY}\n`, "utf8");
  let endpoint = "";
  let urlList: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) {
      endpoint = url;
      urlList = (JSON.parse(String(init.body)) as { urlList: string[] }).urlList;
    }
    return new Response(url.endsWith(`${TEST_KEY}.txt`) ? TEST_KEY : "", { status: 200 });
  }) as typeof fetch;
  const result = await submitIndexNow({
    root,
    key: TEST_KEY,
    live: true,
    endpoint: "https://indexnow.example/submit",
    fetchImpl
  });
  return { urlCount: result.urlCount, urlList, endpoint };
}

async function writeSitemap(root: string): Promise<void> {
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "docs", "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      "<url><loc>https://39211.github.io/</loc></url>",
      "<url><loc>https://39211.github.io/services/white-shoe-cleaning.html</loc></url>",
      "<url><loc>https://39211.github.io/answers.json</loc></url>",
      "</urlset>"
    ].join("\n"),
    "utf8"
  );
}

describe("submitIndexNow", () => {
  it("is dry-run by default and submits only canonical HTML URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "test-indexnow-key" })).resolves.toEqual({
      dryRun: true,
      urlCount: 2,
      host: "39211.github.io"
    });
  });

  it("requires an explicit key before any IndexNow action", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-no-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root })).rejects.toThrow("INDEXNOW_KEY is required");
  });

  it("rejects keys that don't match the IndexNow 8-128 character pattern", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-bad-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "ab" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
    await expect(submitIndexNow({ root, key: "with spaces" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
  });

  it("expects the public key file to be named ${INDEXNOW_KEY}.txt and rejects stale locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-named-key-"));
    await writeSitemap(root);
    await writeFile(join(root, "docs", "indexnow-key.txt"), "laundry-test-key-2026\n", "utf8");

    await expect(
      submitIndexNow({ root, key: "laundry-test-key-2026", live: true })
    ).rejects.toThrow(/laundry-test-key-2026\.txt does not match INDEXNOW_KEY/);
  });

  it("verifies the public key file before live submission and never needs to expose the key", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-live-"));
    await writeSitemap(root);
    await writeFile(join(root, "docs", "test-indexnow-key.txt"), "test-indexnow-key\n", "utf8");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(String(input).endsWith("test-indexnow-key.txt") ? "test-indexnow-key" : "", { status: 200 });
    }) as typeof fetch;

    await expect(
      submitIndexNow({ root, key: "test-indexnow-key", live: true, endpoint: "https://indexnow.example/submit", fetchImpl })
    ).resolves.toEqual({ dryRun: false, urlCount: 2, host: "39211.github.io" });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://indexnow.example/submit");
    expect(calls[1]?.init?.body).toContain("white-shoe-cleaning.html");
    expect(calls[1]?.init?.body).not.toContain("answers.json");
  });

  it("does not submit URLs whose path contains /posts/", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-posts-"));
    await writePages(root, [
      { path: "/", robots: "index, follow" },
      { path: "/services/white-shoe-cleaning.html", robots: "index, follow, max-image-preview:large" },
      { path: "/posts/", robots: "index, follow" },
      { path: "/posts/2026-10-08-slot-01.html", robots: "index, follow, max-image-preview:large" }
    ]);

    const submitted = await submitLive(root);

    expect(submitted.endpoint).toBe("https://indexnow.example/submit");
    expect(submitted.urlCount).toBe(2);
    expect(submitted.urlList).toEqual([
      "https://39211.github.io/",
      "https://39211.github.io/services/white-shoe-cleaning.html"
    ]);
  });

  it("does not submit pages whose robots or googlebot meta contains noindex", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-noindex-"));
    await writePages(root, [
      { path: "/services/white-shoe-cleaning.html", robots: "index, follow", googlebot: "index, follow" },
      { path: "/local/wuqi-laundry-pickup.html", robots: "noindex, follow" },
      { path: "/local/daya-laundry-pickup.html", robots: "index, follow", googlebot: "noindex, follow" },
      { path: "/services/taichung-laundry-price-list.html", robots: "NOINDEX, follow" }
    ]);

    const submitted = await submitLive(root);

    expect(submitted.endpoint).toBe("https://indexnow.example/submit");
    expect(submitted.urlCount).toBe(1);
    expect(submitted.urlList).toEqual(["https://39211.github.io/services/white-shoe-cleaning.html"]);
  });

  it("submits a normal indexable page unchanged", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-indexable-"));
    await writePages(root, [
      {
        path: "/",
        robots: "index, follow, max-image-preview:large",
        googlebot: "index, follow, max-image-preview:large",
        body: "這頁說明 noindex 政策，但本身可索引。"
      },
      { path: "/services/white-shoe-cleaning.html", robots: "index, follow", googlebot: "index, follow" }
    ]);

    const submitted = await submitLive(root);

    expect(submitted.endpoint).toBe("https://indexnow.example/submit");
    expect(submitted.urlCount).toBe(2);
    expect(submitted.urlList).toEqual([
      "https://39211.github.io/",
      "https://39211.github.io/services/white-shoe-cleaning.html"
    ]);
  });
});
