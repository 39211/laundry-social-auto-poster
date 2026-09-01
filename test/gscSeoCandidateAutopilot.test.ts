import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRAFT_ONLY,
  assertDraftOnlyCandidate,
  createGscSeoCandidateReport,
  type SeoCandidate
} from "../src/gscSeoCandidateAutopilot";

const SITE = "sc-domain:example.com";
const SHOE_PAGE = "https://example.com/services/shoe-bag-care.html";
const PICKUP_PAGE = "https://example.com/services/citywide-pickup.html";
const NOW = new Date("2026-09-01T15:15:00.000Z");

function indexedRow(url: string) {
  return {
    url,
    verdict: "PASS",
    coverage_state: "Submitted and indexed",
    robots_txt_state: "ALLOWED",
    indexing_state: "INDEXING_ALLOWED",
    last_crawl_time: null,
    page_fetch_state: "SUCCESSFUL",
    google_canonical: url,
    user_canonical: url
  };
}

describe("GSC SEO candidate autopilot", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gsc-seo-candidates-"));
    await Promise.all([
      mkdir(join(root, "docs"), { recursive: true }),
      mkdir(join(root, "data", "insights", "gsc"), { recursive: true }),
      mkdir(join(root, "data", "insights", "gsc-index"), { recursive: true })
    ]);
    await writeFile(
      join(root, "docs", "sitemap.xml"),
      `<urlset><url><loc>${SHOE_PAGE}</loc></url><url><loc>${PICKUP_PAGE}</loc></url></urlset>`,
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeInputs(
    options: {
      pairs?: unknown;
      rows?: unknown;
      fetchedAt?: string;
      indexGeneratedAt?: string;
      totals?: { clicks: number; impressions: number; ctr: number; position: number };
    } = {}
  ) {
    await writeFile(
      join(root, "data", "insights", "gsc", "2026-08-29.json"),
      JSON.stringify({
        date: "2026-08-29",
        site_url: SITE,
        fetched_at: options.fetchedAt ?? NOW.toISOString(),
        totals: options.totals ?? { clicks: 4, impressions: 100, ctr: 0.04, position: 11 },
        top_queries: [],
        top_pages: [],
        ...(options.pairs === undefined ? {} : { top_query_pages: options.pairs })
      }),
      "utf8"
    );
    await writeFile(
      join(root, "data", "insights", "gsc-index", "2026-09-01.json"),
      JSON.stringify({
        date: "2026-09-01",
        site_url: SITE,
        generated_at: options.indexGeneratedAt ?? NOW.toISOString(),
        total: 2,
        states: { "Submitted and indexed": 2 },
        indexed_count: 2,
        rows: options.rows ?? [indexedRow(SHOE_PAGE), indexedRow(PICKUP_PAGE)]
      }),
      "utf8"
    );
  }

  it("creates one shoes/bags draft candidate from direct query-page evidence, ahead of pickup", async () => {
    await writeInputs({
      pairs: [
        { keys: ["台中全市洗衣收送", PICKUP_PAGE], clicks: 2, impressions: 50, ctr: 0.04, position: 9 },
        { keys: ["西屯洗鞋", SHOE_PAGE], clicks: 1, impressions: 20, ctr: 0.05, position: 12 }
      ]
    });

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("CANDIDATE");
    expect(report.candidate?.canonical_page).toBe(SHOE_PAGE);
    expect(report.candidate?.service_cluster).toBe("shoes_bags");
    expect(report.candidate?.publication_status).toBe(DRAFT_ONLY);
    expect(report.candidate?.forbidden_actions).toContain("no_public_site_write");
    expect(report.candidate?.forbidden_actions).toContain("no_deploy");
    expect(report.inputs.gsc_report_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.inputs.index_report_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not infer page causality from separate top-query and top-page lists", async () => {
    await writeInputs();

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("NOOP");
    expect(report.reason_codes).toEqual(["query_page_evidence_unavailable"]);
    expect(report.candidate).toBeNull();
  });

  it("rejects query evidence when its page is not confirmed indexed and canonical", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 20, ctr: 0, position: 12 }],
      rows: [{ ...indexedRow(SHOE_PAGE), coverage_state: "Discovered - currently not indexed" }]
    });

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("NOOP");
    expect(report.reason_codes).toEqual(["no_eligible_query_page_evidence"]);
    expect(report.candidate).toBeNull();
  });

  it("blocks rather than treating stale GSC evidence as current", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 20, ctr: 0, position: 12 }],
      fetchedAt: new Date(NOW.getTime() - 37 * 60 * 60 * 1000).toISOString()
    });

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toEqual(["required_gsc_input_stale"]);
    expect(report.candidate).toBeNull();
  });

  it("blocks malformed reports instead of treating missing fields as zero", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 20, ctr: 0, position: 12 }]
    });
    await writeFile(join(root, "data", "insights", "gsc", "2026-08-29.json"), JSON.stringify({ site_url: SITE }), "utf8");

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toEqual(["required_gsc_input_malformed"]);
    expect(report.observed_totals).toEqual({ clicks: null, impressions: null, ctr: null, position: null });
  });

  it("keeps low-volume evidence as a no-op even when a query/page pair exists", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 2, impressions: 40, ctr: 0.05, position: 10 }],
      totals: { clicks: 1, impressions: 22, ctr: 1 / 22, position: 17 }
    });

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("NOOP");
    expect(report.reason_codes).toEqual(["insufficient_total_search_impressions"]);
    expect(report.candidate).toBeNull();
  });

  it("stops duplicate drafts when the inputs have not changed", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 20, ctr: 0, position: 12 }]
    });
    const first = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });
    const second = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(first.report.status).toBe("CANDIDATE");
    expect(second.report.status).toBe("NOOP");
    expect(second.report.reason_codes).toEqual(["identical_input_fingerprint"]);
  });

  it("does not re-issue a page candidate inside the seven-day cooldown", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 20, ctr: 0, position: 12 }]
    });
    const first = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 0, impressions: 21, ctr: 0, position: 11 }],
      fetchedAt: nextDay.toISOString(),
      indexGeneratedAt: nextDay.toISOString()
    });
    const second = await createGscSeoCandidateReport({ root, now: nextDay, outputDate: "2026-09-02" });

    expect(first.report.status).toBe("CANDIDATE");
    expect(second.report.status).toBe("NOOP");
    expect(second.report.reason_codes).toEqual(["page_cooldown_active"]);
  });

  it("blocks when prior candidate history is malformed rather than forgetting the cooldown", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 1, impressions: 20, ctr: 0.05, position: 12 }]
    });
    const historyDir = join(root, "output", "operations", "gsc-seo-candidates");
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(historyDir, "2026-08-31.json"), "not json", "utf8");

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toEqual(["candidate_history_malformed"]);
    expect(report.candidate).toBeNull();
  });

  it("blocks valid JSON with an invalid candidate-history shape before deduplication", async () => {
    await writeInputs({
      pairs: [{ keys: ["西屯洗鞋", SHOE_PAGE], clicks: 1, impressions: 20, ctr: 0.05, position: 12 }]
    });
    const historyDir = join(root, "output", "operations", "gsc-seo-candidates");
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(historyDir, "2026-08-31.json"), JSON.stringify({ inputs: null }), "utf8");

    const { report } = await createGscSeoCandidateReport({ root, now: NOW, outputDate: "2026-09-01" });

    expect(report.status).toBe("BLOCKED");
    expect(report.reason_codes).toEqual(["candidate_history_malformed"]);
    expect(report.candidate).toBeNull();
  });

  it("rejects an output date that could escape the operations directory", async () => {
    await writeInputs();

    await expect(createGscSeoCandidateReport({ root, now: NOW, outputDate: "../../docs/overwrite" })).rejects.toThrow(
      /cannot name a path/
    );
  });

  it("mutation: any state other than DRAFT_ONLY is rejected before it can be emitted", () => {
    const unsafe = {
      canonical_page: SHOE_PAGE,
      service_cluster: "shoes_bags",
      evidence: [],
      evidence_totals: { clicks: 0, impressions: 5, ctr: 0, weighted_position: 12 },
      recommended_review: "unsafe",
      publication_status: "PUBLISHED",
      forbidden_actions: ["no_public_site_write", "no_deploy"]
    } as unknown as SeoCandidate;

    expect(() => assertDraftOnlyCandidate(unsafe)).toThrow(/not DRAFT_ONLY/);
  });
});
