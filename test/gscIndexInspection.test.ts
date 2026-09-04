import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  indexInspectionPath,
  inspectUrls,
  recordIndexInspection,
  sitemapPageUrls
} from "../src/gscIndexInspection";

// Same discipline as gscSearchAnalytics.test.ts: unmeasured must never read as
// zero, and "indexed" must count only Google's indexed states — the word
// "indexed" also appears inside "Crawled - currently not indexed", which is
// the opposite claim.

const CONFIGURED = {
  GSC_CLIENT_ID: "client",
  GSC_CLIENT_SECRET: "secret",
  GSC_REFRESH_TOKEN: "refresh",
  GSC_SITE_URL: "sc-domain:example.com"
} as NodeJS.ProcessEnv;

function stubFetch(byUrl: Record<string, unknown>) {
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const inspected = body.inspectionUrl as string;
    const result = byUrl[inspected];
    if (result === undefined) {
      return new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 });
    }
    return new Response(
      JSON.stringify({ inspectionResult: { indexStatusResult: result } }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
}

describe("gsc url-inspection reader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gsc-index-"));
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "data", "insights", "gsc-index"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("turns a stalled inspection call into one failed row and keeps inspecting the rest", async () => {
    const stalled = "https://example.com/hangs/";
    const fine = "https://example.com/ok/";
    const good = stubFetch({ [fine]: { verdict: "PASS", coverageState: "Submitted and indexed" } });
    // A request that never completes but honours the abort signal, like a
    // socket that stays open with no bytes: only the deadline can end it.
    const hanging = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) return good(url, init);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.inspectionUrl !== stalled) return good(url, init);
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      });
    }) as unknown as typeof fetch;

    const started = Date.now();
    const report = await inspectUrls({ urls: [stalled, fine], env: CONFIGURED, fetchImpl: hanging, requestTimeoutMs: 50 });
    expect(Date.now() - started).toBeLessThan(5_000);

    expect(report.total).toBe(2);
    const [first, second] = report.rows;
    expect(first?.url).toBe(stalled);
    expect(first?.verdict).toBe("ERROR");
    expect(first?.coverage_state).toBe("inspection-failed");
    expect(first?.error).toMatch(/timed out after 50ms/);
    expect(second?.coverage_state).toBe("Submitted and indexed");
    expect(report.indexed_count).toBe(1);
    expect(report.states).toEqual({ "inspection-failed": 1, "Submitted and indexed": 1 });
  });

  it("fails fast with a clear message when the token refresh itself stalls", async () => {
    const hangingToken = (async (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted")));
      })) as unknown as typeof fetch;
    await expect(
      inspectUrls({ urls: ["https://example.com/"], env: CONFIGURED, fetchImpl: hangingToken, requestTimeoutMs: 50 })
    ).rejects.toThrow(/token refresh failed or timed out after 50ms/);
  });

  it("refuses to run when the read side is not configured", async () => {
    await expect(
      inspectUrls({ urls: ["https://example.com/"], env: {} as NodeJS.ProcessEnv, fetchImpl: stubFetch({}) })
    ).rejects.toThrow(/not configured/);
  });

  it("reads page URLs from the sitemap and leaves image URLs out", async () => {
    await writeFile(
      join(root, "docs", "sitemap.xml"),
      `<?xml version="1.0"?><urlset>
        <url><loc>https://example.com/</loc></url>
        <url><loc>https://example.com/guides/a.html</loc></url>
        <url><loc>https://example.com/assets/services/hero.png</loc></url>
      </urlset>`
    );
    expect(sitemapPageUrls(root)).toEqual(["https://example.com/", "https://example.com/guides/a.html"]);
  });

  it("counts only truly indexed states, not 'currently not indexed' ones", async () => {
    // Mutation guard: loosening the indexed matcher to a bare /indexed/i match
    // makes this go red, because "Crawled - currently not indexed" contains
    // the word "indexed" while meaning the opposite.
    const report = await inspectUrls({
      urls: ["https://example.com/", "https://example.com/a.html", "https://example.com/b.html"],
      env: CONFIGURED,
      fetchImpl: stubFetch({
        "https://example.com/": { verdict: "PASS", coverageState: "Submitted and indexed" },
        "https://example.com/a.html": {
          verdict: "NEUTRAL",
          coverageState: "Crawled - currently not indexed"
        },
        "https://example.com/b.html": {
          verdict: "NEUTRAL",
          coverageState: "Discovered - currently not indexed"
        }
      }),
      now: new Date("2026-08-21T02:00:00Z")
    });
    expect(report.total).toBe(3);
    expect(report.indexed_count).toBe(1);
    expect(report.states).toEqual({
      "Submitted and indexed": 1,
      "Crawled - currently not indexed": 1,
      "Discovered - currently not indexed": 1
    });
  });

  it("keeps a failed inspection as an ERROR row instead of dropping the URL", async () => {
    const report = await inspectUrls({
      urls: ["https://example.com/", "https://example.com/missing.html"],
      env: CONFIGURED,
      fetchImpl: stubFetch({
        "https://example.com/": { verdict: "PASS", coverageState: "Submitted and indexed" }
      }),
      now: new Date("2026-08-21T02:00:00Z")
    });
    expect(report.total).toBe(2);
    const failed = report.rows.find((row) => row.url.endsWith("missing.html"));
    expect(failed?.verdict).toBe("ERROR");
    expect(failed?.error).toMatch(/429/);
    expect(report.indexed_count).toBe(1);
  });

  it("records the report keyed by the inspection date", async () => {
    await writeFile(
      join(root, "docs", "sitemap.xml"),
      `<urlset><url><loc>https://example.com/</loc></url></urlset>`
    );
    const { report, path } = await recordIndexInspection({
      root,
      env: CONFIGURED,
      fetchImpl: stubFetch({
        "https://example.com/": { verdict: "PASS", coverageState: "Submitted and indexed" }
      }),
      now: new Date("2026-08-21T02:00:00Z")
    });
    expect(path).toBe(indexInspectionPath(report.date, root));
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.total).toBe(1);
    expect(saved.indexed_count).toBe(1);
    expect(saved.rows[0].url).toBe("https://example.com/");
  });
});
