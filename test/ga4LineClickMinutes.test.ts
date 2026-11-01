import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectLineClickMinutes, formatGa4Minute } from "../src/ga4LineClickMinutes";
import { Ga4NotConfiguredError } from "../src/ga4Report";

const CONFIGURED = {
  YT_CLIENT_ID: "client",
  YT_CLIENT_SECRET: "secret",
  GA4_REFRESH_TOKEN: "refresh",
  GA4_PROPERTY_ID: "123456"
} as NodeJS.ProcessEnv;

type Raw = [string, string, string];

function page(rows: Raw[], extra: Record<string, unknown> = {}) {
  return {
    rows: rows.map(([minute, source, count]) => ({
      dimensionValues: [{ value: minute }, { value: source }],
      metricValues: [{ value: count }]
    })),
    rowCount: rows.length,
    metadata: { timeZone: "Asia/Taipei" },
    ...extra
  };
}

function stubFetch(handler: (req: { startDate: string; offset: number }) => { status?: number; payload: unknown }) {
  const calls: { startDate: string; offset: number; body: any }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    }
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const req = { startDate: body.dateRanges[0].startDate as string, offset: Number(body.offset ?? 0) };
    calls.push({ ...req, body });
    const { status = 200, payload } = handler(req);
    return new Response(JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("ga4 line_click per minute", () => {
  let root: string;
  const clickFile = (date: string) => join(root, "data", "leads", "clicks", `${date}.json`);
  const readClicks = async (date: string) => JSON.parse(await readFile(clickFile(date), "utf8"));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ga4-minutes-"));
    await mkdir(join(root, "data", "leads"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("formats GA4 dateHourMinute as a Taipei minute", () => {
    expect(formatGa4Minute("202610201903")).toBe("2026-10-20T19:03+08:00");
    expect(() => formatGa4Minute("2026102019")).toThrow();
    expect(() => formatGa4Minute("202610202460")).toThrow();
  });

  it("parses rows, sorts them and writes the contract file atomically", async () => {
    await writeFile(
      join(root, "data", "leads", "2026-10.json"),
      JSON.stringify({ month: "2026-10", days: { "2026-10-20": { line_clicks_total: 2 } } })
    );
    const { impl, calls } = stubFetch(() => ({
      payload: page([
        ["202610201903", "reel-card-mold-20261020", "2"],
        ["202610200905", "ig-bio", "1"]
      ])
    }));
    const result = await collectLineClickMinutes({ date: "2026-10-20", days: 1, root, env: CONFIGURED, fetchImpl: impl });
    expect(result.exitCode).toBe(0);
    const doc = await readClicks("2026-10-20");
    expect(doc).toMatchObject({
      schema: "line-click-minutes/v1",
      date: "2026-10-20",
      time_zone: "Asia/Taipei",
      status: "measured",
      total: 3,
      daily_ledger_total: 2
    });
    expect(doc.rows).toEqual([
      { minute: "2026-10-20T09:05+08:00", source: "ig-bio", count: 1 },
      { minute: "2026-10-20T19:03+08:00", source: "reel-card-mold-20261020", count: 2 }
    ]);
    expect(typeof doc.fetched_at).toBe("string");
    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.dimensions).toEqual([{ name: "dateHourMinute" }, { name: "customEvent:source" }]);
    expect(body.metrics).toEqual([{ name: "eventCount" }]);
    expect(body.dimensionFilter.filter).toEqual({
      fieldName: "eventName",
      stringFilter: { matchType: "EXACT", value: "line_click" }
    });
    expect(body.limit).toBe(10000);
    expect(await readdir(join(root, "data", "leads", "clicks"))).toEqual(["2026-10-20.json"]);
  });

  it("maps empty and (not set) sources to unknown and merges them", async () => {
    const { impl } = stubFetch(() => ({
      payload: page([
        ["202610200105", "(not set)", "1"],
        ["202610200105", "", "2"]
      ])
    }));
    await collectLineClickMinutes({ date: "2026-10-20", days: 1, root, env: CONFIGURED, fetchImpl: impl });
    const doc = await readClicks("2026-10-20");
    expect(doc.rows).toEqual([{ minute: "2026-10-20T01:05+08:00", source: "unknown", count: 3 }]);
    expect(doc.daily_ledger_total).toBeNull();
  });

  it("follows pagination with offset and rowCount", async () => {
    const { impl, calls } = stubFetch(({ offset }) => ({
      payload:
        offset === 0
          ? page([["202610201000", "a", "1"], ["202610201001", "a", "1"]], { rowCount: 3 })
          : page([["202610201002", "b", "4"]], { rowCount: 3 })
    }));
    const result = await collectLineClickMinutes({ date: "2026-10-20", days: 1, root, env: CONFIGURED, fetchImpl: impl });
    expect(result.exitCode).toBe(0);
    expect(calls.map((call) => call.offset)).toEqual([0, 2]);
    const doc = await readClicks("2026-10-20");
    expect(doc.rows).toHaveLength(3);
    expect(doc.total).toBe(6);
  });

  it("never guesses an offset when the property is not in Asia/Taipei", async () => {
    const { impl } = stubFetch(() => ({
      payload: page([["202610201903", "a", "2"]], { metadata: { timeZone: "America/Los_Angeles" } })
    }));
    const result = await collectLineClickMinutes({ date: "2026-10-20", days: 2, root, env: CONFIGURED, fetchImpl: impl });
    expect(result.exitCode).toBe(3);
    for (const date of ["2026-10-19", "2026-10-20"]) {
      const doc = await readClicks(date);
      expect(doc.status).toBe("timezone_mismatch");
      expect(doc.time_zone).toBe("America/Los_Angeles");
      expect(doc.rows).toEqual([]);
      expect(doc.total).toBeNull();
    }
  });

  it("keeps the older file on an API error and still runs other days", async () => {
    await mkdir(join(root, "data", "leads", "clicks"), { recursive: true });
    const old = '{"old": true}\n';
    await writeFile(clickFile("2026-10-20"), old, "utf8");
    const { impl } = stubFetch(({ startDate }) =>
      startDate === "2026-10-20"
        ? { status: 403, payload: { error: { message: "permission denied" } } }
        : { payload: page([["202610210800", "a", "1"]]) }
    );
    const result = await collectLineClickMinutes({ date: "2026-10-21", days: 2, root, env: CONFIGURED, fetchImpl: impl });
    expect(result.exitCode).toBe(1);
    expect(await readFile(clickFile("2026-10-20"), "utf8")).toBe(old);
    expect((await readClicks("2026-10-21")).status).toBe("measured");
    expect(result.days.find((day) => day.date === "2026-10-20")?.reason).toMatch(/permission denied/);
  });

  it("writes nothing when the read side is not configured", async () => {
    let called = 0;
    const impl = (async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      collectLineClickMinutes({ date: "2026-10-20", root, env: {} as NodeJS.ProcessEnv, fetchImpl: impl })
    ).rejects.toBeInstanceOf(Ga4NotConfiguredError);
    expect(called).toBe(0);
    await expect(stat(join(root, "data", "leads", "clicks"))).rejects.toThrow();
  });
});
