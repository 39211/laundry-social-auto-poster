import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  classifyTrafficSource,
  fetchGa4AiTraffic,
  recordGa4AiTraffic,
  summarizeTraffic,
  type Ga4SourceSessionRow
} from "../src/ga4AiTraffic";

const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "548899490"
} as NodeJS.ProcessEnv;

function stubFetch(reports: unknown[]) {
  let reportIndex = 0;
  return (async (url: string | URL) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = reports[reportIndex] ?? { rows: [] };
    reportIndex += 1;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("GA4 AI traffic classification", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ga4-ai-"));
    await mkdir(join(root, "data", "insights", "ga4-traffic"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("treats ChatGPT and Perplexity as AI, and never treats google.com as AI", () => {
    expect(classifyTrafficSource("chatgpt.com", "referral")).toBe("ai");
    expect(classifyTrafficSource("https://www.perplexity.ai/search", "referral")).toBe("ai");
    expect(classifyTrafficSource("google", "organic")).toBe("google_organic");
    expect(classifyTrafficSource("google.com", "organic")).toBe("google_organic");
    expect(classifyTrafficSource("www.google.com", "organic")).toBe("google_organic");
    expect(classifyTrafficSource("(direct)", "(none)")).toBe("other");
  });

  it("totals are the sum of classified rows, not a stamped constant", () => {
    const rows: Ga4SourceSessionRow[] = [
      { source: "chatgpt.com", medium: "referral", sessions: 4, engaged_sessions: 2, traffic_class: "ai" },
      { source: "google", medium: "organic", sessions: 9, engaged_sessions: 6, traffic_class: "google_organic" },
      { source: "(direct)", medium: "(none)", sessions: 3, engaged_sessions: 1, traffic_class: "other" }
    ];
    const totals = summarizeTraffic(rows);
    expect(totals.sessions).toBe(16);
    expect(totals.ai_sessions).toBe(4);
    expect(totals.google_organic_sessions).toBe(9);
    expect(totals.other_sessions).toBe(3);
    expect(totals.ai_engaged_sessions).toBe(2);
    expect(totals.ai_sessions + totals.google_organic_sessions + totals.other_sessions).toBe(totals.sessions);
  });

  it("keeps AI landing pages only when the source itself classified as AI", async () => {
    const report = await fetchGa4AiTraffic({
      date: "2026-08-28",
      env: CONFIGURED,
      fetchImpl: stubFetch([
        {
          rows: [
            { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }], metricValues: [{ value: "2" }, { value: "1" }] },
            { dimensionValues: [{ value: "google" }, { value: "organic" }], metricValues: [{ value: "5" }, { value: "4" }] }
          ]
        },
        {
          rows: [
            {
              dimensionValues: [{ value: "/guides/white-shoe-yellowing.html" }, { value: "chatgpt.com" }],
              metricValues: [{ value: "2" }, { value: "1" }]
            },
            {
              dimensionValues: [{ value: "/" }, { value: "google" }],
              metricValues: [{ value: "5" }, { value: "4" }]
            }
          ]
        }
      ])
    });
    expect(report.totals.ai_sessions).toBe(2);
    expect(report.totals.google_organic_sessions).toBe(5);
    expect(report.ai_landing_pages).toEqual([
      {
        page: "/guides/white-shoe-yellowing.html",
        source: "chatgpt.com",
        sessions: 2,
        engaged_sessions: 1,
        traffic_class: "ai"
      }
    ]);
    expect(report.ai_landing_pages.some((row) => row.source === "google")).toBe(false);
  });

  it("refuses to write a report when credentials are missing", async () => {
    await expect(
      fetchGa4AiTraffic({ date: "2026-08-28", env: {} as NodeJS.ProcessEnv, fetchImpl: stubFetch([]) })
    ).rejects.toThrow(/not configured/);
  });

  it("writes the same totals it just computed", async () => {
    const { report, path } = await recordGa4AiTraffic({
      date: "2026-08-28",
      root,
      env: CONFIGURED,
      fetchImpl: stubFetch([
        {
          rows: [
            { dimensionValues: [{ value: "perplexity.ai" }, { value: "referral" }], metricValues: [{ value: "3" }, { value: "2" }] }
          ]
        },
        { rows: [] }
      ])
    });
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.totals).toEqual(report.totals);
    expect(saved.totals.ai_sessions).toBe(3);
    expect(saved.date).toBe("2026-08-28");
  });
});
