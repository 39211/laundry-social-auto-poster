import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import {
  classifyTrafficSource,
  fetchGa4AiTraffic,
  recordGa4AiTraffic,
  runGa4AiTrafficCli,
  summarizeTraffic,
  type Ga4SourceSessionRow
} from "../src/ga4AiTraffic";

const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "548899490"
} as NodeJS.ProcessEnv;

const REMOTE_ERROR_CANARY = "SUPER_SECRET_CANARY";
const REMOTE_ROWCOUNT_CANARY = 424242;
const REMOTE_ROWCOUNT_CANARY_ALT = 525252;

const SCHEMA_ROWCOUNT_CHANGED = "GA4 runReport failed: schema rowCount changed across pages";
const SCHEMA_ROWS_EXCEED = "GA4 runReport failed: schema rows exceed rowCount";
const SCHEMA_INCOMPLETE_PAGES = "GA4 runReport failed: schema incomplete page sequence";

function stubFetch(reports: unknown[]) {
  let reportIndex = 0;
  return (async (url: string | URL) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = reports[reportIndex] ?? { rowCount: 0, rows: [] };
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
    expect(classifyTrafficSource("google", "organic", "AI Assistant")).toBe("google_organic");
    expect(classifyTrafficSource("www.chatgpt.com", "referral")).toBe("ai");
    expect(classifyTrafficSource("www.claude.ai", "referral")).toBe("ai");
    expect(classifyTrafficSource("new-ai.example", "referral", "AI Assistant")).toBe("ai");
    expect(classifyTrafficSource("(direct)", "(none)")).toBe("other");
  });

  it("totals are the sum of classified rows, not a stamped constant", () => {
    const rows: Ga4SourceSessionRow[] = [
      { source: "chatgpt.com", medium: "referral", channel_group: "AI Assistant", sessions: 4, engaged_sessions: 2, key_events: 1, traffic_class: "ai" },
      { source: "google", medium: "organic", channel_group: "Organic Search", sessions: 9, engaged_sessions: 6, key_events: 2, traffic_class: "google_organic" },
      { source: "(direct)", medium: "(none)", channel_group: "Direct", sessions: 3, engaged_sessions: 1, key_events: 0, traffic_class: "other" }
    ];
    const totals = summarizeTraffic(rows);
    expect(totals.sessions).toBe(16);
    expect(totals.ai_sessions).toBe(4);
    expect(totals.google_organic_sessions).toBe(9);
    expect(totals.other_sessions).toBe(3);
    expect(totals.ai_engaged_sessions).toBe(2);
    expect(totals.ai_key_events).toBe(1);
    expect(totals.ai_sessions + totals.google_organic_sessions + totals.other_sessions).toBe(totals.sessions);
  });

  it("keeps AI landing pages only when the source itself classified as AI", async () => {
    const report = await fetchGa4AiTraffic({
      date: "2026-08-28",
      env: CONFIGURED,
      fetchImpl: stubFetch([
        {
          rowCount: 2,
          rows: [
            { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }] },
            { dimensionValues: [{ value: "google" }, { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }] }
          ]
        },
        {
          rowCount: 2,
          rows: [
            {
              dimensionValues: [{ value: "/guides/white-shoe-yellowing.html" }, { value: "chatgpt.com" }, { value: "AI Assistant" }],
              metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }]
            },
            {
              dimensionValues: [{ value: "/" }, { value: "google" }, { value: "Organic Search" }],
              metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }]
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
        channel_group: "AI Assistant",
        sessions: 2,
        engaged_sessions: 1,
        key_events: 1,
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

  it("rejects a non-2xx Data API response instead of recording zero traffic", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 503 });
    }) as unknown as typeof fetch;
    await expect(fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl })).rejects.toThrow(
      /HTTP 503/
    );
  });

  it("rejects HTTP 200 {} as a schema/rowCount failure instead of recording zero traffic", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toMatch(/schema/i);
    expect(error.message).toMatch(/rowCount/i);
  });

  it("rejects a 200 payload that has rows but no rowCount", async () => {
    const fetchImpl = stubFetch([{ rows: [] }]);
    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toMatch(/schema/i);
    expect(error.message).toMatch(/rowCount/i);
  });

  it("rejects a JSON page with more rows than its rowCount", async () => {
    const fetchImpl = stubFetch([
      {
        rowCount: 1,
        rows: [
          { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }] },
          { dimensionValues: [{ value: "google" }, { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }] }
        ]
      }
    ]);
    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toBe(SCHEMA_ROWS_EXCEED);
  });

  it("rejects a 200 payload whose rows would exceed rowCount", async () => {
    const overflowRows = [
      {
        dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }],
        metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }]
      },
      {
        dimensionValues: [{ value: "google" }, { value: "organic" }, { value: "Organic Search" }],
        metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }]
      }
    ];
    overflowRows.length = REMOTE_ROWCOUNT_CANARY_ALT; // remote rows canary; avoid stringify of 525252 nulls
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ rowCount: REMOTE_ROWCOUNT_CANARY, rows: overflowRows })
      } as Response;
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toBe(SCHEMA_ROWS_EXCEED);
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));

    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe(SCHEMA_ROWS_EXCEED);
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("accepts explicit zero traffic with rowCount 0", async () => {
    const report = await fetchGa4AiTraffic({
      date: "2026-08-28",
      env: CONFIGURED,
      fetchImpl: stubFetch([{ rowCount: 0 }, { rowCount: 0, rows: [] }])
    });
    expect(report.totals.sessions).toBe(0);
    expect(report.by_source).toEqual([]);
    expect(report.ai_landing_pages).toEqual([]);
  });

  it("paginates until Data API rowCount is complete", async () => {
    const offsets: number[] = [];
    let reportCall = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
      offsets.push(request.offset ?? -1);
      reportCall += 1;
      if (reportCall === 1) {
        return new Response(
          JSON.stringify({
            rowCount: 2,
            rows: [
              { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }] }
            ]
          }),
          { status: 200 }
        );
      }
      if (reportCall === 2) {
        return new Response(
          JSON.stringify({
            rowCount: 2,
            rows: [
              { dimensionValues: [{ value: "google" }, { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }] }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ rowCount: 0, rows: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl });
    expect(offsets).toEqual([0, 1, 0]);
    expect(report.totals.sessions).toBe(7);
  });

  it("rejects when a later page increases rowCount instead of paginating further", async () => {
    const offsets: number[] = [];
    let reportCall = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
      offsets.push(request.offset ?? -1);
      reportCall += 1;
      if (reportCall === 1) {
        return new Response(
          JSON.stringify({
            rowCount: REMOTE_ROWCOUNT_CANARY,
            rows: [
              { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }] }
            ]
          }),
          { status: 200 }
        );
      }
      if (reportCall === 2) {
        return new Response(
          JSON.stringify({
            rowCount: REMOTE_ROWCOUNT_CANARY_ALT,
            rows: [
              { dimensionValues: [{ value: "google" }, { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "5" }, { value: "4" }, { value: "2" }] }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          rowCount: 4,
          rows: [
            { dimensionValues: [{ value: "(direct)" }, { value: "(none)" }, { value: "Direct" }], metricValues: [{ value: "1" }, { value: "1" }, { value: "0" }] }
          ]
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toBe(SCHEMA_ROWCOUNT_CHANGED);
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(reportCall).toBe(2);
    expect(offsets).toEqual([0, 1]);

    reportCall = 0;
    offsets.length = 0;
    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe(SCHEMA_ROWCOUNT_CHANGED);
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(reportCall).toBe(2);
    expect(offsets).toEqual([0, 1]);
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("rejects an empty page before rowCount is complete", async () => {
    const offsets: number[] = [];
    let reportCall = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      const request = JSON.parse(String(init?.body ?? "{}")) as { offset?: number };
      offsets.push(request.offset ?? -1);
      reportCall += 1;
      if (reportCall === 1) {
        return new Response(
          JSON.stringify({
            rowCount: REMOTE_ROWCOUNT_CANARY,
            rows: [
              { dimensionValues: [{ value: "chatgpt.com" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "2" }, { value: "1" }, { value: "1" }] }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ rowCount: REMOTE_ROWCOUNT_CANARY, rows: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).toBe(SCHEMA_INCOMPLETE_PAGES);
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(error.message).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(reportCall).toBe(2);
    expect(offsets).toEqual([0, 1]);

    reportCall = 0;
    offsets.length = 0;
    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe(SCHEMA_INCOMPLETE_PAGES);
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(result.reason).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY));
    expect(output.join("\n")).not.toContain(String(REMOTE_ROWCOUNT_CANARY_ALT));
    expect(reportCall).toBe(2);
    expect(offsets).toEqual([0, 1]);
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("does not echo OAuth error_description into thrown errors or --no-fail logs", async () => {
    const fetchImpl = (async () => {
      return new Response(
        JSON.stringify({ error: "invalid_grant", error_description: REMOTE_ERROR_CANARY }),
        { status: 400 }
      );
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected oauth failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).not.toContain(REMOTE_ERROR_CANARY);
    expect(error.message).toMatch(/token refresh/i);
    expect(error.message).toMatch(/HTTP 400/);

    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).not.toContain(REMOTE_ERROR_CANARY);
    expect(output.join("\n")).not.toContain(REMOTE_ERROR_CANARY);
  });

  it("does not echo an invalid remote rowCount into thrown errors or --no-fail logs", async () => {
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ rowCount: REMOTE_ERROR_CANARY, rows: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected schema failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).not.toContain(REMOTE_ERROR_CANARY);
    expect(error.message).toBe("GA4 runReport failed: schema invalid rowCount");

    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).not.toContain(REMOTE_ERROR_CANARY);
    expect(result.reason).toBe("GA4 runReport failed: schema invalid rowCount");
    expect(output.join("\n")).not.toContain(REMOTE_ERROR_CANARY);
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("does not echo Data API error.message into thrown errors or --no-fail logs", async () => {
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "ya29.ACCESS_TOKEN_CANARY" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: REMOTE_ERROR_CANARY, status: "PERMISSION_DENIED" } }), {
        status: 403
      });
    }) as unknown as typeof fetch;

    const error = await fetchGa4AiTraffic({ date: "2026-08-28", env: CONFIGURED, fetchImpl }).then(
      () => {
        throw new Error("expected data api failure");
      },
      (reason) => reason as Error
    );
    expect(error.message).not.toContain(REMOTE_ERROR_CANARY);
    expect(error.message).not.toContain("ya29.ACCESS_TOKEN_CANARY");
    expect(error.message).toMatch(/HTTP 403/);

    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).not.toContain(REMOTE_ERROR_CANARY);
    expect(result.reason).not.toContain("ya29.ACCESS_TOKEN_CANARY");
    expect(output.join("\n")).not.toContain(REMOTE_ERROR_CANARY);
    expect(output.join("\n")).not.toContain("ya29.ACCESS_TOKEN_CANARY");
  });

  it("--no-fail reports skipped and does not write a zero report", async () => {
    const output: string[] = [];
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: {} as NodeJS.ProcessEnv,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({ skipped: true });
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("--no-fail skips a 200 schema-invalid payload and does not write a file", async () => {
    const output: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      if (String(url).includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await runGa4AiTrafficCli({
      args: ["--date", "2026-08-28", "--root", root, "--no-fail"],
      env: CONFIGURED,
      fetchImpl,
      log: (line) => output.push(line)
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/schema/i);
    expect(result.reason).toMatch(/rowCount/i);
    const logged = JSON.parse(output[0] ?? "{}") as { skipped?: boolean; reason?: string };
    expect(logged.skipped).toBe(true);
    expect(logged.reason).toMatch(/schema/i);
    expect(logged.reason).toMatch(/rowCount/i);
    expect(await readdir(join(root, "data", "insights", "ga4-traffic"))).toEqual([]);
  });

  it("writes the same totals it just computed", async () => {
    const { report, path } = await recordGa4AiTraffic({
      date: "2026-08-28",
      root,
      env: CONFIGURED,
      fetchImpl: stubFetch([
        {
          rowCount: 1,
          rows: [
            { dimensionValues: [{ value: "perplexity.ai" }, { value: "referral" }, { value: "AI Assistant" }], metricValues: [{ value: "3" }, { value: "2" }, { value: "1" }] }
          ]
        },
        { rowCount: 0, rows: [] }
      ])
    });
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.totals).toEqual(report.totals);
    expect(saved.totals.ai_sessions).toBe(3);
    expect(saved.totals.ai_key_events).toBe(1);
    expect(saved.date).toBe("2026-08-28");
  });
});
