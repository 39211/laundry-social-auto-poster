import { describe, expect, it } from "vitest";
import {
  Ga4AiNotConfiguredError,
  classifyAiSource,
  fetchAiTraffic
} from "../src/ga4AiTraffic";

const ENV = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "12345"
} as NodeJS.ProcessEnv;

function stubFetch(rows: Array<[string, string, number, number]>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com")) {
      return { json: async () => ({ access_token: "token" }) } as Response;
    }
    return {
      json: async () => ({
        rows: rows.map(([source, landing, sessions, engaged]) => ({
          dimensionValues: [{ value: source }, { value: landing }],
          metricValues: [{ value: String(sessions) }, { value: String(engaged) }]
        }))
      })
    } as Response;
  }) as unknown as typeof fetch;
}

describe("classifyAiSource", () => {
  it("recognises the answer engines by host", () => {
    expect(classifyAiSource("chatgpt.com")).toBe("chatgpt");
    expect(classifyAiSource("chat.openai.com")).toBe("chatgpt");
    expect(classifyAiSource("www.perplexity.ai")).toBe("perplexity");
    expect(classifyAiSource("claude.ai")).toBe("claude");
    expect(classifyAiSource("gemini.google.com")).toBe("gemini");
    expect(classifyAiSource("copilot.microsoft.com")).toBe("copilot");
    expect(classifyAiSource("grok.com")).toBe("grok");
  });

  it("is case and whitespace tolerant, because GA4 is not consistent", () => {
    expect(classifyAiSource("  ChatGPT.com ")).toBe("chatgpt");
    expect(classifyAiSource("PERPLEXITY.AI")).toBe("perplexity");
  });

  it("does not claim ordinary search or docs traffic as an AI referral", () => {
    // The whole point of host-anchoring: these hosts serve plain search and
    // documentation too, and folding them in would inflate the number.
    expect(classifyAiSource("google")).toBeNull();
    expect(classifyAiSource("google.com")).toBeNull();
    expect(classifyAiSource("openai.com")).toBeNull();
    expect(classifyAiSource("bing")).toBeNull();
    expect(classifyAiSource("(direct)")).toBeNull();
    expect(classifyAiSource("")).toBeNull();
  });

  it("does not match a lookalike host that merely contains an engine name", () => {
    // Mutation: drop the ^...$ anchors from AI_ENGINE_RULES and these pass as
    // real engines, so this goes red.
    expect(classifyAiSource("notchatgpt.example.com")).toBeNull();
    expect(classifyAiSource("perplexity.ai.spam.example")).toBeNull();
    expect(classifyAiSource("fake-claude.ai.example.com")).toBeNull();
  });
});

describe("fetchAiTraffic", () => {
  it("refuses to report zero when the read side is not configured", async () => {
    // A reader that returns 0 when nobody asked is indistinguishable from
    // "no AI sent anyone" -- the exact failure this project already fixed
    // once for line_click.
    await expect(
      fetchAiTraffic({ env: {} as NodeJS.ProcessEnv, fetchImpl: stubFetch([]) })
    ).rejects.toBeInstanceOf(Ga4AiNotConfiguredError);
  });

  it("keeps AI sessions separate from the property total", async () => {
    const report = await fetchAiTraffic({
      env: ENV,
      fetchImpl: stubFetch([
        ["chatgpt.com", "/guides/luxury-bag-mold.html", 4, 3],
        ["(direct)", "/", 100, 40],
        ["google", "/", 10, 6]
      ])
    });
    expect(report.total_sessions).toBe(114);
    expect(report.ai_sessions).toBe(4);
    expect(report.no_ai_referrals).toBe(false);
  });

  it("merges one engine's landing pages instead of emitting a row per page", async () => {
    const report = await fetchAiTraffic({
      env: ENV,
      fetchImpl: stubFetch([
        ["chatgpt.com", "/guides/white-shoe-yellowing.html", 2, 2],
        ["chat.openai.com", "/guides/luxury-bag-mold.html", 3, 1]
      ])
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.engine).toBe("chatgpt");
    expect(report.rows[0]!.sessions).toBe(5);
    expect(report.rows[0]!.engaged_sessions).toBe(3);
    expect(report.rows[0]!.landing_pages).toEqual([
      "/guides/luxury-bag-mold.html",
      "/guides/white-shoe-yellowing.html"
    ]);
  });

  it("says no_ai_referrals rather than inventing an empty engine row", async () => {
    const report = await fetchAiTraffic({
      env: ENV,
      fetchImpl: stubFetch([["(direct)", "/", 100, 40]])
    });
    expect(report.rows).toEqual([]);
    expect(report.ai_sessions).toBe(0);
    expect(report.no_ai_referrals).toBe(true);
    // The distinction that matters: the property was read, and it genuinely
    // had no AI referral -- not that nobody asked.
    expect(report.total_sessions).toBe(100);
  });

  it("ranks engines by sessions", async () => {
    const report = await fetchAiTraffic({
      env: ENV,
      fetchImpl: stubFetch([
        ["claude.ai", "/", 1, 1],
        ["perplexity.ai", "/", 7, 5],
        ["chatgpt.com", "/", 3, 2]
      ])
    });
    expect(report.rows.map((row) => row.engine)).toEqual(["perplexity", "chatgpt", "claude"]);
  });
});
