import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGscPerformanceReport,
  classifyServiceCluster,
  gscPerformancePath,
  parseCsv,
  parseGscFiltersCsv,
  parseGscMetricCsv,
  parseGscQueryPageCsv,
  runGscPerformanceCli
} from "../src/gscPerformance";

const queryCsv = `熱門查詢項目,點擊,曝光,點閱率,排名
私享家,0,50,0%,1.88
逢甲洗鞋,0,16,0%,5.75
台中乾洗,0,2,0%,9
"台中,洗衣",1,4,25%,7
`;

const pageCsv = `熱門網頁,點擊,曝光,點閱率,排名
https://39211.github.io/,1,329,0.3%,6.84
https://39211.github.io/laundry-social-auto-poster/,2,78,2.56%,6.6
https://39211.github.io/local/qinghai-road-shoe-cleaning.html,1,84,1.19%,8.2
`;

const pairedCsv = `熱門查詢項目,熱門網頁,點擊,曝光,點閱率,排名
私享家,https://39211.github.io/laundry-social-auto-poster/,0,50,0%,1.88
逢甲洗鞋,https://39211.github.io/local/qinghai-road-shoe-cleaning.html,0,16,0%,5.75
台中乾洗,https://39211.github.io/,0,2,0%,9
`;

const filtersCsv = "篩選器,值\n搜尋類型,網路\n日期,前 3 個月\n";
const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function buildOptions(pairedRows = parseGscQueryPageCsv(pairedCsv)) {
  return {
    queryRows: parseGscMetricCsv(queryCsv, "熱門查詢項目"),
    pageRows: parseGscMetricCsv(pageCsv, "熱門網頁"),
    pairedRows,
    filters: parseGscFiltersCsv(filtersCsv),
    generatedAt: "2026-08-08T00:00:00.000Z",
    dataThrough: "2026-08-05"
  };
}

describe("GSC performance analysis", () => {
  it("parses strict quoted CSV and preserves empty values separately from zero", () => {
    expect(parseCsv('欄一,欄二\n"a,b","a""b"\n')).toEqual([
      ["欄一", "欄二"],
      ["a,b", 'a"b']
    ]);
    const rows = parseGscMetricCsv(
      "熱門查詢項目,點擊,曝光,點閱率,排名\n測試,0,,0%,1\n",
      "熱門查詢項目"
    );
    expect(rows[0]).toMatchObject({ clicks: 0, impressions: null, ctr_percent: 0, position: 1 });
    expect(() => parseCsv('欄一\n"值"多餘\n')).toThrow("unexpected character after quoted field");
    expect(() => parseCsv('欄一\n值"錯誤\n')).toThrow("quote inside unquoted field");
    expect(() => parseCsv('欄一\n"未結束\n')).toThrow("unterminated quoted field");
  });

  it("blocks page-edit recommendations until query and page share the same row", () => {
    const report = buildGscPerformanceReport({ ...buildOptions(), pairedRows: undefined });
    expect(report.status).toBe("awaiting_query_page_data");
    expect(report.recommendations).toEqual([]);
    expect(report.data_quality.actionability).toBe("blocked_without_query_page_dimension");
    expect(report.data_quality.query_page_join_note).toContain("cannot attribute a query to a URL");
    expect(report.observations.high_impression_low_ctr_pages.map((row) => row.key)).toEqual([
      "https://39211.github.io/",
      "https://39211.github.io/local/qinghai-road-shoe-cleaning.html"
    ]);
    expect(report.page_row_totals).toMatchObject({ clicks: 4, impressions: 491, ctr_percent: 0.81 });
  });

  it("uses paired rows, canonical URLs, and service clusters for bounded recommendations", () => {
    const first = buildGscPerformanceReport(buildOptions());
    const second = buildGscPerformanceReport(buildOptions());
    expect(second).toEqual(first);
    expect(first.status).toBe("low_sample_directional_only");
    expect(first.source.data_through).toBe("2026-08-05");
    expect(first.source.paired_query_page_file_loaded).toBe(true);
    expect(first.data_quality.canonical_page_rows).toBe(2);
    expect(first.recommendations.map((item) => [item.canonical_page, item.service_cluster])).toEqual([
      ["https://39211.github.io/", "brand"],
      ["https://39211.github.io/local/qinghai-road-shoe-cleaning.html", "shoes_bags"]
    ]);
    expect(first.recommendations[0]).toMatchObject({
      recommended_surface: "title_meta_business_identity",
      status: "wait_for_post_change_data",
      confidence: "low"
    });
    expect(first.recommendations[1]?.evidence[0]?.query).toBe("逢甲洗鞋");
    expect(first.recommendations[1]).toMatchObject({
      status: "wait_for_post_change_data",
      evidence_window: {
        data_through: "2026-08-05",
        page_content_lastmod: "2026-08-08",
        post_change_data_available: false
      }
    });
    expect(first.recommendations[1]?.evidence.some((row) => row.query.includes("工作室"))).toBe(false);
    expect(first.recommendations.some((item) => item.service_cluster === "dry_cleaning")).toBe(false);
    expect(first.data_quality.query_page_join_note).toContain("both query and page dimensions");
  });

  it("requires a full seven-day observation window after a page change", () => {
    const sameDay = buildGscPerformanceReport({ ...buildOptions(), dataThrough: "2026-08-08" });
    expect(sameDay.recommendations.every((item) => item.status === "wait_for_post_change_data")).toBe(true);
    expect(sameDay.recommendations[0]?.evidence_window).toMatchObject({
      post_change_observation_days: 0,
      minimum_observation_days: 7,
      post_change_data_available: false
    });

    const sevenDaysLater = buildGscPerformanceReport({ ...buildOptions(), dataThrough: "2026-08-15" });
    expect(sevenDaysLater.recommendations.every((item) => item.status === "ready_for_bounded_change")).toBe(true);
  });

  it("classifies brand and each requested laundry service separately", () => {
    expect(classifyServiceCluster("私享家")).toBe("brand");
    expect(classifyServiceCluster("台中洗衣店")).toBe("general_laundry");
    expect(classifyServiceCluster("台中乾洗")).toBe("dry_cleaning");
    expect(classifyServiceCluster("衣物水洗")).toBe("wet_cleaning");
    expect(classifyServiceCluster("西裝送洗")).toBe("shirts_suits");
    expect(classifyServiceCluster("西裝乾洗")).toBe("shirts_suits");
    expect(classifyServiceCluster("羽絨被清洗")).toBe("bedding_down");
    expect(classifyServiceCluster("羽絨乾洗")).toBe("bedding_down");
    expect(classifyServiceCluster("逢甲洗鞋")).toBe("shoes_bags");
    expect(classifyServiceCluster("皮衣發霉")).toBe("leather");
    expect(classifyServiceCluster("皮衣乾洗")).toBe("leather");
    expect(classifyServiceCluster("私享家洗衣店")).toBe("brand");
    expect(classifyServiceCluster("別家洗鞋工作室")).toBe("other");
  });

  it.each([
    ["missing", { clicks: null, impressions: 10, ctr_percent: 0, position: 1 }, "Incomplete"],
    ["clicks exceed impressions", { clicks: 2, impressions: 1, ctr_percent: 200, position: 1 }, "clicks exceed"],
    ["CTR exceeds 100", { clicks: 1, impressions: 1, ctr_percent: 101, position: 1 }, "exceeds 100"],
    ["position zero", { clicks: 0, impressions: 1, ctr_percent: 0, position: 0 }, "position"],
    ["inconsistent CTR", { clicks: 1, impressions: 2, ctr_percent: 10, position: 1 }, "Inconsistent"]
  ])("fails closed on impossible %s metrics", (_label, metrics, expected) => {
    const options = buildOptions([]);
    options.queryRows = [{ key: "錯誤資料", ...metrics }];
    expect(() => buildGscPerformanceReport(options)).toThrow(expected);
  });

  it("fails closed on malformed headers, rows, duplicate filters, and canonical cycles", () => {
    expect(() => parseGscMetricCsv("熱門查詢項目,點擊\n測試,0\n", "熱門查詢項目")).toThrow(
      "Invalid GSC CSV header"
    );
    expect(() =>
      parseGscMetricCsv("熱門查詢項目,點擊,曝光,點閱率,排名\n測試,0,1,0%\n", "熱門查詢項目")
    ).toThrow("expected 5 columns");
    expect(() => parseGscFiltersCsv("篩選器,值\n日期,前 3 個月\n日期,前 28 天\n")).toThrow("Duplicate GSC filter");
    expect(() => buildGscPerformanceReport({
      ...buildOptions([]),
      canonicalAliases: { "https://a.example/": "https://b.example/", "https://b.example/": "https://a.example/" }
    })).toThrow("Canonical alias cycle");
  });

  it("fails closed on empty query/page exports and treats an empty paired export as unavailable", () => {
    expect(() => buildGscPerformanceReport({ ...buildOptions([]), queryRows: [] })).toThrow("query export");
    expect(() => buildGscPerformanceReport({ ...buildOptions([]), pageRows: [] })).toThrow("page export");
    const emptyPaired = buildGscPerformanceReport(buildOptions([]));
    expect(emptyPaired.status).toBe("awaiting_query_page_data");
    expect(emptyPaired.recommendations).toEqual([]);
  });

  it("reads the export directory and writes the versioned report through the CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "gsc-performance-"));
    tempRoots.push(root);
    const input = join(root, "input");
    await mkdir(input, { recursive: true });
    await Promise.all([
      writeFile(join(input, "查詢.csv"), queryCsv, "utf8"),
      writeFile(join(input, "網頁.csv"), pageCsv, "utf8"),
      writeFile(join(input, "篩選器.csv"), filtersCsv, "utf8"),
      writeFile(join(input, "查詢與網頁.csv"), pairedCsv, "utf8"),
      writeFile(join(root, "page-lastmods.json"), JSON.stringify({
        "https://39211.github.io/": "2026-08-01",
        "https://39211.github.io/local/qinghai-road-shoe-cleaning.html": "2026-08-01"
      }), "utf8")
    ]);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const report = await runGscPerformanceCli([
      "--root", root,
      "--input", input,
      "--data-through", "2026-08-05",
      "--generated-at", "2026-08-08T00:00:00.000Z",
      "--page-lastmods", "page-lastmods.json"
    ]);
    const written = JSON.parse(await readFile(gscPerformancePath(root), "utf8")) as typeof report;
    expect(written).toEqual(report);
    expect(written.version).toBe(2);
    expect(written.recommendations).toHaveLength(2);
    expect(written.source.page_content_lastmods["https://39211.github.io/"]).toBe("2026-08-01");
  });
});
