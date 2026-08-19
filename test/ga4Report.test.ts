import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fetchLineClicks,
  GA4_LINE_CLICK_SOURCE_DIMENSION,
  recordLineClicksToLedger
} from "../src/ga4Report";

// The whole point of this module is that a number nobody fetched is not a
// zero. These tests exist to keep that true when someone later "simplifies"
// the error handling into a default.

const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "123456"
} as NodeJS.ProcessEnv;

function stubFetch(report: unknown) {
  return (async (url: string | URL) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    return new Response(JSON.stringify(report), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("ga4 line_click reader", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ga4-"));
    await mkdir(join(root, "data", "leads"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to report zero when the read side is not configured", async () => {
    await expect(
      fetchLineClicks({ date: "2026-08-11", env: {} as NodeJS.ProcessEnv, fetchImpl: stubFetch({}) })
    ).rejects.toThrow(/not configured/);
  });

  it("marks the ledger day unmeasured rather than writing zeros", async () => {
    const result = await recordLineClicksToLedger({
      date: "2026-08-11",
      root,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: stubFetch({})
    });
    expect(result.status).toBe("unmeasured");

    const ledger = JSON.parse(await readFile(join(root, "data", "leads", "2026-08.json"), "utf8"));
    expect(ledger.days["2026-08-11"].source_clicks_status).toBe("unmeasured");
    expect(ledger.days["2026-08-11"].source_clicks).toBeUndefined();
  });

  it("breaks a configured day down by source, largest first", async () => {
    const report = await fetchLineClicks({
      date: "2026-08-11",
      env: CONFIGURED,
      fetchImpl: stubFetch({
        rows: [
          { dimensionValues: [{ value: "poster-front" }], metricValues: [{ value: "2" }] },
          { dimensionValues: [{ value: "ig-comment" }], metricValues: [{ value: "7" }] },
          { dimensionValues: [{ value: "" }], metricValues: [{ value: "3" }] }
        ]
      })
    });
    expect(report.total_line_clicks).toBe(12);
    expect(report.by_source[0]).toEqual({ source: "ig-comment", line_clicks: 7 });
    // Clicks with no source parameter stay visible as their own row: how much
    // traffic cannot be attributed is itself worth watching.
    expect(report.by_source.map((row) => row.source)).toContain("(not set)");
  });

  it("queries the same link_source event parameter that the redirect page emits", async () => {
    const dimensions: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { dimensions: Array<{ name: string }> };
      dimensions.push(body.dimensions[0]!.name);
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchLineClicks({ date: "2026-08-11", env: CONFIGURED, fetchImpl });

    expect(dimensions).toEqual(["eventName", GA4_LINE_CLICK_SOURCE_DIMENSION]);
    expect(GA4_LINE_CLICK_SOURCE_DIMENSION).toBe("customEvent:link_source");
  });

  it("records a measured day into the ledger and says so", async () => {
    const result = await recordLineClicksToLedger({
      date: "2026-08-11",
      root,
      env: CONFIGURED,
      fetchImpl: stubFetch({
        rows: [{ dimensionValues: [{ value: "yt" }], metricValues: [{ value: "4" }] }]
      })
    });
    expect(result).toEqual({ status: "recorded", total: 4 });

    const ledger = JSON.parse(await readFile(join(root, "data", "leads", "2026-08.json"), "utf8"));
    expect(ledger.days["2026-08-11"].source_clicks).toEqual({ yt: 4 });
    expect(ledger.days["2026-08-11"].source_clicks_status).toBe("measured");
  });

  it("treats an API error as unmeasured, not as zero clicks", async () => {
    const failing = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "permission denied" } }), { status: 403 });
    }) as unknown as typeof fetch;

    const result = await recordLineClicksToLedger({
      date: "2026-08-11",
      root,
      env: CONFIGURED,
      fetchImpl: failing
    });
    expect(result.status).toBe("unmeasured");
    expect(result.reason).toMatch(/permission denied/);
  });
});
