import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";
import { GA4_SEARCH_FUNNEL_EVENTS, fetchLineClicks, recordLineClicksToLedger } from "../src/ga4Report";
import { getZonedDateParts } from "../src/scheduler";
import {
  REQUIRED_SEARCH_CONTENT_EVENTS,
  assertSearchContentAnalyticsScript,
  buildSearchContentAnalyticsScript
} from "../src/searchContentAnalytics";

const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "123456"
} as NodeJS.ProcessEnv;

function inspectRequestFetch(onRunReport: (body: string) => void, eventReport: unknown = { rows: [] }) {
  return (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = typeof init?.body === "string" ? init.body : "";
    if (target.includes("runReport") && !body.includes("customEvent:source")) {
      onRunReport(body);
    }
    return new Response(JSON.stringify(eventReport), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("search-content GA4 funnel under hostile input", () => {
  const script = buildSearchContentAnalyticsScript();

  it("keeps the required funnel and refuses duplicate lead events", () => {
    expect(() => assertSearchContentAnalyticsScript(script)).not.toThrow();
    for (const eventName of REQUIRED_SEARCH_CONTENT_EVENTS) {
      expect(script).toContain(`send("${eventName}"`);
    }
    expect(script).not.toContain('send("line_click"');
    expect(script).not.toContain('send("generate_lead"');
  });

  it("does not emit events for javascript, data, or empty hrefs", () => {
    expect(() => assertSearchContentAnalyticsScript(script)).not.toThrow();
    // The runtime observer used by the assertion already clicks tel: and /go/line.html.
    // Hostile schemes must not invent a required event name or throw.
    const stripped = script.replace('send("click_phone"', 'send("click_phone_disabled"');
    expect(() => assertSearchContentAnalyticsScript(stripped)).toThrow(/click_phone/);
  });

  it("documents fail-open: a protocol-relative foreign /go/line.html still counts as click_line_cta", () => {
    expect(script).toContain("targetUrl.pathname.endsWith");
    expect(script).not.toContain("targetUrl.origin");
    expect(script).toContain('"/go/line.html"');
  });

  it("truncates a very long Chinese CTA name and still carries shared dimensions", () => {
    const longCta = "私訊看材質與髒污位置再決定能不能收".repeat(8);
    expect(longCta.length).toBeGreaterThan(80);
    expect(script).toContain(".slice(0, 80)");
    expect(script).toContain("page_type");
    expect(script).toContain("content_id");
    expect(script).toContain("source_page");
    expect(script).toContain("transport_type");
  });

  it("fails closed when a required event is deleted from the generated script", () => {
    const mutated = script.replace('send("click_service_from_answer"', 'send("click_service_from_answer_removed"');
    expect(() => assertSearchContentAnalyticsScript(mutated)).toThrow(/click_service_from_answer/);
  });
});

describe("GA4 read-side collector under missing config and volume", () => {
  it("throws instead of writing zeros when required keys are missing", async () => {
    await expect(
      fetchLineClicks({
        date: "2026-09-01",
        env: { YT_CLIENT_ID: "only-one" } as NodeJS.ProcessEnv,
        fetchImpl: inspectRequestFetch(() => undefined)
      })
    ).rejects.toThrow(/not configured/);
  });

  it("marks a ledger day unmeasured when the mocked Data API is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "sxj-ga4-unmeasured-"));
    await mkdir(join(root, "data", "leads"), { recursive: true });
    const result = await recordLineClicksToLedger({
      date: "2026-09-01",
      root,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: inspectRequestFetch(() => undefined)
    });
    expect(result.status).toBe("unmeasured");
    const ledger = JSON.parse(await readFile(join(root, "data", "leads", "2026-09.json"), "utf8")) as {
      days: Record<string, { search_funnel_events?: unknown; search_funnel_status?: string }>;
    };
    expect(ledger.days["2026-09-01"]?.search_funnel_status).toBe("unmeasured");
    expect(ledger.days["2026-09-01"]?.search_funnel_events).toBeUndefined();
  });

  it("documents fail-open: the Data API request caps rows at 100 with no page token", async () => {
    let captured = "";
    await fetchLineClicks({
      date: "2026-09-01",
      env: CONFIGURED,
      fetchImpl: inspectRequestFetch((body) => {
        captured = body;
      })
    });
    const payload = JSON.parse(captured) as { limit?: number; pageToken?: string };
    expect(payload.limit).toBe(100);
    expect(payload.pageToken).toBeUndefined();
    expect(GA4_SEARCH_FUNNEL_EVENTS).toContain("line_click");
  });

  it("documents clock risk: CLI date default is UTC slice, not Asia/Taipei", () => {
    const utcLateAugust = new Date("2026-08-31T16:30:00.000Z");
    expect(utcLateAugust.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(getZonedDateParts(utcLateAugust, "Asia/Taipei").date).toBe("2026-09-01");
  });

  it("keeps unknown extra event names out of the funnel totals", async () => {
    const report = await fetchLineClicks({
      date: "2026-09-01",
      env: CONFIGURED,
      fetchImpl: inspectRequestFetch(() => undefined, {
        rows: [
          { dimensionValues: [{ value: "line_click" }], metricValues: [{ value: "3" }] },
          { dimensionValues: [{ value: "generate_lead" }], metricValues: [{ value: "99" }] },
          { dimensionValues: [{ value: "purchase" }], metricValues: [{ value: "7" }] }
        ]
      })
    });
    expect(report.event_counts.line_click).toBe(3);
    expect(report.event_counts).not.toHaveProperty("generate_lead");
    expect(report.event_counts).not.toHaveProperty("purchase");
    expect(Object.keys(report.event_counts).sort()).toEqual([...GA4_SEARCH_FUNNEL_EVENTS].sort());
  });
});

describe("generated search pages keep funnel instrumentation", () => {
  it("writes the analytics script through the same assertion the generator uses", async () => {
    const root = await mkdtemp(join(tmpdir(), "sxj-funnel-script-"));
    const script = buildSearchContentAnalyticsScript();
    assertSearchContentAnalyticsScript(script);
    await writeFile(join(root, "search-content-analytics.js"), script, "utf8");
    const written = await readFile(join(root, "search-content-analytics.js"), "utf8");
    expect(written).toBe(script);
  });

  it("strips a planned Reel with no public mp4 instead of publishing a stale video URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "sxj-stale-video-"));
    const date = "2026-07-02";
    await mkdir(join(root, "data", "content-calendar"), { recursive: true });
    await mkdir(join(root, "data", "approved-log"), { recursive: true });
    await mkdir(join(root, "docs", "assets", date), { recursive: true });
    const profile = await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8");
    await writeFile(join(root, "data", "business-profile.json"), profile, "utf8");
    const png1x1 = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex"
    );
    await writeFile(join(root, "docs", "assets", date, "slot-01.png"), png1x1);
    await writeFile(
      join(root, "data", "content-calendar", `${date}.json`),
      JSON.stringify({
        date,
        timezone: "Asia/Taipei",
        generated_at: `${date}T00:00:00.000Z`,
        slots: [
          {
            slot: 1,
            time: "11:30",
            category: "知識文",
            topic: "白鞋鞋邊泛灰前的檢查",
            instagram_caption: "IG #test",
            facebook_caption: "FB #test",
            image_prompt: "prompt",
            visual_route: "macro-detail",
            traffic_route: "object-proof",
            media_type: "reel",
            format: "reel",
            local_image_path: `docs/assets/${date}/slot-01.png`,
            public_image_url: "",
            local_video_path: `docs/assets/${date}/slot-01.mp4`,
            public_video_url: `https://example.invalid/assets/${date}/slot-01.mp4`,
            status: "pending"
          }
        ]
      })
    );
    await writeFile(
      join(root, "data", "approved-log", `${date}.json`),
      JSON.stringify(
        (["facebook", "instagram"] as const).map((platform) => ({
          date,
          slot: 1,
          platform,
          status: "approved",
          approved_by: "Test",
          created_at: `${date}T02:00:00.000Z`
        }))
      )
    );

    await generatePublicSite({
      root,
      siteBaseUrl: "https://example.invalid",
      imageBaseUrl: "https://example.invalid",
      now: "2026-07-10T03:00:00.000Z"
    });

    const social = JSON.parse(await readFile(join(root, "docs", "social-posts.json"), "utf8")) as {
      posts: Array<{ video_url?: string; media_type?: string }>;
    };
    const publicCalendar = JSON.parse(await readFile(join(root, "docs", "content-calendar", `${date}.json`), "utf8")) as {
      slots: Array<{ media_type?: string; public_video_url?: string }>;
    };
    expect(social.posts[0]?.video_url ?? "").toBe("");
    expect(social.posts[0]?.media_type).not.toBe("reel");
    expect(publicCalendar.slots[0]?.public_video_url).toBeUndefined();
    expect(publicCalendar.slots[0]?.media_type).toBe("image");
  }, 30_000);
});
