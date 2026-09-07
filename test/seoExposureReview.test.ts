import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSeoExposureReview } from "../src/seoExposureReview";

const NOW = new Date("2026-09-01T15:20:00.000Z");

describe("SEO exposure review", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "seo-exposure-review-"));
    await Promise.all([
      mkdir(join(root, "docs"), { recursive: true }),
      mkdir(join(root, "data", "insights", "gsc"), { recursive: true }),
      mkdir(join(root, "data", "insights", "gsc-index"), { recursive: true }),
      mkdir(join(root, "data", "insights", "ga4-traffic"), { recursive: true }),
      mkdir(join(root, "data", "leads"), { recursive: true })
    ]);
    await writeFile(join(root, "docs", "sitemap.xml"), "<urlset><url><loc>https://example.com/</loc></url></urlset>", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeFreshInputs() {
    await writeFile(
      join(root, "data", "insights", "gsc", "2026-08-29.json"),
      JSON.stringify({
        date: "2026-08-29",
        fetched_at: NOW.toISOString(),
        totals: { clicks: 0, impressions: 22, ctr: 0, position: 17 },
        top_queries: [{ keys: ["西屯洗鞋"], clicks: 0, impressions: 4, ctr: 0, position: 12 }]
      }),
      "utf8"
    );
    await writeFile(
      join(root, "data", "insights", "gsc-index", "2026-09-01.json"),
      JSON.stringify({
        generated_at: NOW.toISOString(),
        total: 32,
        indexed_count: 26,
        rows: [{ coverage_state: "Discovered - currently not indexed" }]
      }),
      "utf8"
    );
    await writeFile(
      join(root, "data", "insights", "ga4-traffic", "2026-09-01.json"),
      JSON.stringify({
        date: "2026-09-01",
        fetched_at: "2026-09-01T15:11:00.000Z",
        totals: { sessions: 7, google_organic_sessions: 0, ai_sessions: 0, ai_engaged_sessions: 0 }
      }),
      "utf8"
    );
    await writeFile(
      join(root, "data", "leads", "2026-09.json"),
      JSON.stringify({
        month: "2026-09",
        days: {
          "2026-09-01": {
            line_clicks_total: 3,
            source_clicks_status: "measured",
            line_clicks_recorded_at: "2026-09-01T15:11:00.000Z"
          }
        }
      }),
      "utf8"
    );
  }

  it("blocks instead of evaluating stale GSC inputs", async () => {
    const { report } = await createSeoExposureReview({ root, now: NOW, date: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.measurements.gsc_impressions).toBeNull();
    expect(report.decision.value).toBe("INCONCLUSIVE");
  });

  it("blocks rather than treating missing GA4 and LINE evidence as zeros", async () => {
    await writeFile(
      join(root, "data", "insights", "gsc", "2026-08-29.json"),
      JSON.stringify({
        date: "2026-08-29",
        fetched_at: NOW.toISOString(),
        totals: { clicks: 0, impressions: 22, ctr: 0, position: 17 },
        top_queries: []
      }),
      "utf8"
    );
    await writeFile(
      join(root, "data", "insights", "gsc-index", "2026-09-01.json"),
      JSON.stringify({ generated_at: NOW.toISOString(), total: 32, indexed_count: 26, rows: [] }),
      "utf8"
    );

    const { report } = await createSeoExposureReview({ root, now: NOW, date: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toContain("current_ga4_collection_cycle_missing");
    expect(report.reason_codes).toContain("current_line_click_collection_cycle_missing");
  });

  it("reports indexed-but-low-exposure after all four scheduled evidence inputs are fresh", async () => {
    await writeFreshInputs();

    const { report, path } = await createSeoExposureReview({ root, now: NOW, date: "2026-09-01" });
    const saved = JSON.parse(await readFile(path, "utf8"));

    expect(report.status).toBe("MEASURED");
    expect(report.diagnosis).toBe("INDEXED_WITH_LOW_OBSERVED_EXPOSURE");
    expect(report.measurements.indexed_urls).toBe(26);
    expect(report.measurements.observed_nonbrand_top_query_impressions).toBe(4);
    expect(report.measurements.ga4_sessions).toBe(7);
    expect(report.measurements.line_clicks).toBe(3);
    expect(report.reason_codes).toEqual(["current_ga4_gsc_line_collection_cycle_measured"]);
    expect(saved.forbidden_actions).toContain("no_public_site_write");
    expect(saved.decision.value).toBe("PENDING");
  });

  it("blocks a same-day GA4 file that predates the 23:10 collection window", async () => {
    await writeFreshInputs();
    await writeFile(
      join(root, "data", "insights", "ga4-traffic", "2026-09-01.json"),
      JSON.stringify({
        date: "2026-09-01",
        fetched_at: "2026-09-01T14:00:00.000Z",
        totals: { sessions: 7, google_organic_sessions: 0, ai_sessions: 0, ai_engaged_sessions: 0 }
      }),
      "utf8"
    );

    const { report } = await createSeoExposureReview({ root, now: NOW, date: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toContain("current_ga4_collection_cycle_missing");
  });

  it("blocks a failed collector retry even if earlier same-day inputs are fresh", async () => {
    await writeFreshInputs();

    const { report } = await createSeoExposureReview({ root, now: NOW, date: "2026-09-01", forceBlock: true });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toContain("gsc_collection_command_failed");
    expect(report.decision.value).toBe("INCONCLUSIVE");
  });

  it("rejects impossible calendar dates", async () => {
    await expect(createSeoExposureReview({ root, now: NOW, date: "2026-02-30" })).rejects.toThrow("real YYYY-MM-DD");
  });
});
