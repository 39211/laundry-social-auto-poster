import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTrafficSource, fetchGa4AiTraffic, recordGa4AiTraffic } from "../src/ga4AiTraffic";
import { fetchGa4ReportRows, resolveGa4ReportDate } from "../src/ga4ReportRows";

const ENV = { YT_CLIENT_ID: "fixture-client", YT_CLIENT_SECRET: "fixture-secret",
  GA4_REFRESH_TOKEN: "fixture-refresh", GA4_PROPERTY_ID: "123", TIMEZONE: "Asia/Taipei" };
const row = (first: string, second = "referral", sessions = "1") => ({
  dimensionValues: [{ value: first }, { value: second }],
  metricValues: [{ value: sessions }, { value: "0" }]
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function fixture(bodies: unknown[]) {
  let i = 0;
  const calls: Record<string, any>[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) return json({ access_token: "fixture-token" });
    calls.push(JSON.parse(String(init?.body)));
    const body = bodies[i++];
    if (body === undefined) throw new Error("Unexpected extra report request");
    return body instanceof Response ? body : json(body);
  }) as typeof fetch;
  return { fetchImpl, calls };
}
function report(bodies: unknown[]) {
  const f = fixture(bodies);
  return fetchGa4ReportRows("fixture-token", "123", "2026-09-06", ["sessionSource", "sessionMedium"], f.fetchImpl);
}
const full = () => Array.from({ length: 200 }, (_, i) => row(`a${String(i).padStart(3, "0")}.example`));

describe("GA4 evidence integrity", () => {
  it("collects AI source number 201 instead of reporting false zero", async () => {
    const f = fixture([{ rowCount: 201, rows: full() }, { rowCount: 201, rows: [row("perplexity.ai")] }, { rows: [] }]);
    const result = await fetchGa4AiTraffic({ date: "2026-09-06", env: ENV, fetchImpl: f.fetchImpl });
    assert.equal(result.totals.sessions, 201);
    assert.equal(result.totals.ai_sessions, 1);
    assert.deepEqual(f.calls.map((call) => call.offset), ["0", "200", "0"]);
    assert.deepEqual(f.calls[0].orderBys.map((item: any) => item.dimension.dimensionName), ["sessionSource", "sessionMedium"]);
    assert.ok(f.calls.every((call) => !("pageToken" in call)));
  });
  it("paginates the landing report independently", async () => {
    const landings = Array.from({ length: 200 }, (_, i) => row(`/guides/${i}`, "chatgpt.com"));
    const f = fixture([{ rows: [row("chatgpt.com", "referral", "201")] },
      { rowCount: 201, rows: landings }, { rowCount: 201, rows: [row("/services/price", "chatgpt.com")] }]);
    const result = await fetchGa4AiTraffic({ date: "2026-09-06", env: ENV, fetchImpl: f.fetchImpl });
    assert.equal(result.ai_landing_pages.length, 201);
    assert.ok(result.ai_landing_pages.some((entry) => entry.page === "/services/price"));
    assert.deepEqual(f.calls.map((call) => call.offset), ["0", "0", "200"]);
  });
  it("continues after a short page when rowCount says there are more", async () => {
    assert.equal((await report([{ rowCount: 3, rows: [row("a"), row("b")] }, { rowCount: 3, rows: [row("c")] }])).length, 3);
  });
  it("continues a full page when rowCount is omitted", async () => {
    assert.equal((await report([{ rows: full() }, { rows: [row("perplexity.ai")] }])).length, 201);
  });
  it("accepts a genuinely empty rows array", async () => assert.deepEqual(await report([{ rows: [] }]), []));
  it("accepts explicit zero rowCount with omitted rows", async () => assert.deepEqual(await report([{ rowCount: 0 }]), []));
  it("accepts a protobuf zero report with headers", async () => assert.deepEqual(await report([
    { dimensionHeaders: [{ name: "sessionSource" }, { name: "sessionMedium" }], metricHeaders: [{ name: "sessions" }, { name: "engagedSessions" }] }
  ]), []));
  it("rejects HTTP errors even without a Google error envelope", async () => {
    await assert.rejects(report([json({}, 503)]), /HTTP 503/);
  });
  it("rejects non-JSON instead of manufacturing zero", async () => {
    await assert.rejects(report([new Response("upstream timeout", { status: 200 })]), /invalid JSON/);
  });
  it("does not echo an arbitrary API error body into logs", async () => {
    await assert.rejects(report([{ error: { message: "sensitive-fixture-value" } }]), (error: Error) => {
      assert.match(error.message, /API error/); assert.ok(!error.message.includes("sensitive-fixture-value")); return true;
    });
  });
  for (const [label, body] of [["empty object", {}], ["null", null], ["array", []], ["rows object", { rows: {} }], ["null rows", { rows: null }]] as const) {
    it(`rejects malformed response: ${label}`, async () => { await assert.rejects(report([body])); });
  }
  it("does not claim completeness under thresholding", async () => {
    await assert.rejects(report([{ rows: [], metadata: { subjectToThresholding: true } }]), /incomplete/);
  });
  it("does not claim completeness under other-row loss", async () => {
    await assert.rejects(report([{ rows: [], metadata: { dataLossFromOtherRow: true } }]), /incomplete/);
  });
  it("rejects sampled data as complete evidence", async () => {
    await assert.rejects(report([{ rows: [], metadata: { samplingMetadatas: [{ samplesReadCount: "50", samplingSpaceSize: "100" }] } }]), /sampled/);
  });
  it("accepts full sampling-space coverage", async () => {
    assert.deepEqual(await report([{ rows: [], metadata: { samplingMetadatas: [{ samplesReadCount: "100", samplingSpaceSize: "100" }] } }]), []);
  });
  for (const metric of ["NaN", "-1", "1.5", "", "9007199254740993"]) {
    it(`rejects invalid count ${JSON.stringify(metric)}`, async () => { await assert.rejects(report([{ rows: [row("chatgpt.com", "referral", metric)] }]), /invalid dimension or count/); });
  }
  it("does not replace a missing metric with zero", async () => {
    await assert.rejects(report([{ rows: [{ dimensionValues: row("a").dimensionValues, metricValues: [{ value: "1" }] }] }]), /invalid dimension or count/);
  });
  it("rejects a missing dimension", async () => {
    await assert.rejects(report([{ rows: [{ dimensionValues: [{ value: "a" }], metricValues: row("a").metricValues }] }]), /invalid dimension or count/);
  });
  it("fails on premature empty pages", async () => {
    await assert.rejects(report([{ rowCount: 201, rows: full() }, { rowCount: 201, rows: [] }]), /before rowCount/);
  });
  it("fails when rowCount changes during pagination", async () => {
    await assert.rejects(report([{ rowCount: 201, rows: full() }, { rowCount: 202, rows: [row("z")] }]), /rowCount changed/);
  });
  it("rejects a repeated page rather than double counting", async () => {
    await assert.rejects(report([{ rowCount: 400, rows: full() }, { rowCount: 400, rows: full() }]), /repeated/);
  });
  it("rejects more rows than rowCount", async () => {
    await assert.rejects(report([{ rowCount: 0, rows: [row("a")] }]), /more rows than rowCount/);
  });
  it("rejects more rows than the requested limit", async () => {
    await assert.rejects(report([{ rows: [...full(), row("z")] }]), /page limit/);
  });
  it("rejects a malformed rowCount", async () => {
    await assert.rejects(report([{ rowCount: "201", rows: [] }]), /invalid rowCount/);
  });
  it("does not label a missing Google medium as organic", () => {
    assert.equal(classifyTrafficSource("google"), "other");
    assert.equal(classifyTrafficSource("google.com", "cpc"), "other");
    assert.equal(classifyTrafficSource("google", "organic"), "google_organic");
    assert.equal(classifyTrafficSource("chatgpt.com", "referral"), "ai");
    assert.equal(classifyTrafficSource("chatgpt.com.evil.example", "referral"), "other");
  });
  it("resolves relative dates at the Taipei midnight boundary", () => {
    const before = new Date("2026-09-06T15:59:59Z"), after = new Date("2026-09-06T16:00:00Z");
    assert.equal(resolveGa4ReportDate("today", before), "2026-09-06");
    assert.equal(resolveGa4ReportDate("today", after), "2026-09-07");
    assert.equal(resolveGa4ReportDate("yesterday", after), "2026-09-06");
    assert.equal(resolveGa4ReportDate("7daysAgo", after), "2026-08-31");
  });
  it("handles year and leap-day boundaries", () => {
    assert.equal(resolveGa4ReportDate("yesterday", new Date("2026-12-31T16:00:00Z")), "2026-12-31");
    assert.equal(resolveGa4ReportDate("yesterday", new Date("2024-02-29T16:00:00Z")), "2024-02-29");
    assert.equal(resolveGa4ReportDate("2024-02-29"), "2024-02-29");
  });
  it("rejects invalid dates and path traversal", () => {
    for (const value of ["2026-02-30", "2026-13-01", "../outside", "yesterday/../../a", "-1daysAgo", "InfinitydaysAgo"]) {
      assert.throws(() => resolveGa4ReportDate(value));
    }
  });
  it("rejects invalid date before any credential or report request", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return json({}); }) as typeof fetch;
    await assert.rejects(fetchGa4AiTraffic({ date: "../outside", env: ENV, fetchImpl }), /date/);
    assert.equal(calls, 0);
  });
  it("rejects failed token HTTP status even with an access_token field", async () => {
    const fetchImpl = (async () => json({ access_token: "should-not-be-used" }, 401)) as typeof fetch;
    await assert.rejects(fetchGa4AiTraffic({ date: "2026-09-06", env: ENV, fetchImpl }), /HTTP 401/);
  });
  it("refuses missing credentials without any network request", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return json({}); }) as typeof fetch;
    await assert.rejects(fetchGa4AiTraffic({ date: "2026-09-06", env: {}, fetchImpl }), /not configured/);
    assert.equal(calls, 0);
  });
  it("leaves an existing report untouched when a later page fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "ga4-integrity-"));
    try {
      const dir = join(root, "data", "insights", "ga4-traffic");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "2026-09-06.json"), sentinel = '{"evidence":"previous-valid-report"}';
      await writeFile(path, sentinel);
      const f = fixture([{ rowCount: 201, rows: full() }, json({}, 503)]);
      await assert.rejects(recordGa4AiTraffic({ date: "2026-09-06", root, env: ENV, fetchImpl: f.fetchImpl }), /HTTP 503/);
      assert.equal(await readFile(path, "utf8"), sentinel);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("uses the same absolute date in both reports, JSON and filename", async () => {
    const root = await mkdtemp(join(tmpdir(), "ga4-date-"));
    try {
      const f = fixture([{ rows: [] }, { rows: [] }]);
      const result = await recordGa4AiTraffic({ date: "yesterday", root, env: ENV, fetchImpl: f.fetchImpl });
      assert.match(result.report.date, /^\d{4}-\d{2}-\d{2}$/u);
      assert.ok(result.path.endsWith(`${result.report.date}.json`));
      assert.ok(f.calls.every((call) => call.dateRanges[0].startDate === result.report.date && call.dateRanges[0].endDate === result.report.date));
      assert.equal(JSON.parse(await readFile(result.path, "utf8")).date, result.report.date);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
