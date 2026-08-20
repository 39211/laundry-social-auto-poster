import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchGscDayReport, recordGscDayReport, gscSearchAnalyticsPath } from "../src/gscSearchAnalytics";

// Same discipline as ga4Report.test.ts: an unfetched number must never read
// as a zero, and the site-wide total must come from GSC's own aggregate row,
// not a sum of the (privacy-filtered) per-query rows.

const CONFIGURED = {
  GSC_CLIENT_ID: "client",
  GSC_CLIENT_SECRET: "secret",
  GSC_REFRESH_TOKEN: "refresh",
  GSC_SITE_URL: "sc-domain:example.com"
} as NodeJS.ProcessEnv;

function stubFetch(handlers: { totals?: unknown; query?: unknown; page?: unknown }) {
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    const dims: string[] = body.dimensions ?? [];
    if (dims.length === 0) return new Response(JSON.stringify(handlers.totals ?? { rows: [] }), { status: 200 });
    if (dims[0] === "query") return new Response(JSON.stringify(handlers.query ?? { rows: [] }), { status: 200 });
    return new Response(JSON.stringify(handlers.page ?? { rows: [] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("gsc search-analytics reader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gsc-"));
    await mkdir(join(root, "data", "insights", "gsc"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to report zero when the read side is not configured", async () => {
    await expect(
      fetchGscDayReport({ date: "2026-08-17", env: {} as NodeJS.ProcessEnv, fetchImpl: stubFetch({}) })
    ).rejects.toThrow(/not configured/);
  });

  it("marks the day unmeasured rather than writing zeros on an API error", async () => {
    const failing = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "permission denied" } }), { status: 403 });
    }) as unknown as typeof fetch;

    const result = await recordGscDayReport({ date: "2026-08-17", root, env: CONFIGURED, fetchImpl: failing });
    expect(result.status).toBe("unmeasured");
    expect(result.reason).toMatch(/permission denied/);

    await expect(readFile(gscSearchAnalyticsPath("2026-08-17", root), "utf8")).rejects.toThrow();
  });

  it("takes the site total from GSC's own aggregate row, not a sum of per-query rows", async () => {
    // Per-query rows are privacy-filtered by Google and can under-count the
    // real total; summing them would silently understate traffic.
    const report = await fetchGscDayReport({
      date: "2026-08-17",
      env: CONFIGURED,
      fetchImpl: stubFetch({
        totals: { rows: [{ keys: [], clicks: 9, impressions: 40, ctr: 0.225, position: 6.5 }] },
        query: { rows: [{ keys: ["洗鞋"], clicks: 1, impressions: 5, ctr: 0.2, position: 8 }] },
        page: { rows: [{ keys: ["https://example.com/"], clicks: 1, impressions: 5, ctr: 0.2, position: 8 }] }
      })
    });
    expect(report.totals).toEqual({ clicks: 9, impressions: 40, ctr: 0.225, position: 6.5 });
    expect(report.top_queries).toHaveLength(1);
  });

  it("records a measured day keyed by the query date, not the collection date", async () => {
    const result = await recordGscDayReport({
      date: "2026-08-17",
      root,
      env: CONFIGURED,
      fetchImpl: stubFetch({
        totals: { rows: [{ keys: [], clicks: 0, impressions: 6, ctr: 0, position: 9 }] }
      })
    });
    expect(result).toEqual({ status: "recorded", date: "2026-08-17" });

    const saved = JSON.parse(await readFile(gscSearchAnalyticsPath("2026-08-17", root), "utf8"));
    expect(saved.date).toBe("2026-08-17");
    expect(saved.totals.impressions).toBe(6);
  });
});
