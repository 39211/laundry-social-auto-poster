// GA4 Data API uses offset + limit, not pageToken. A failed, truncated,
// thresholded or sampled response must never become a clean zero report.
// https://developers.google.com/analytics/devguides/reporting/data/v1/basics

export interface Ga4ApiRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

interface ReportPayload {
  rows?: unknown;
  rowCount?: unknown;
  dimensionHeaders?: unknown[];
  metricHeaders?: unknown[];
  error?: unknown;
  metadata?: {
    subjectToThresholding?: boolean;
    dataLossFromOtherRow?: boolean;
    samplingMetadatas?: { samplesReadCount?: string; samplingSpaceSize?: string }[];
  };
}

export function resolveGa4ReportDate(value: string, now = new Date(), timeZone = "Asia/Taipei"): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
    throw new Error("GA4 report date is not a valid calendar date.");
  }
  const relative = /^(\d+)daysAgo$/u.exec(value);
  const days = value === "today" ? 0 : value === "yesterday" ? 1 : relative ? Number(relative[1]) : NaN;
  if (!Number.isSafeInteger(days) || days < 0 || days > 36500) {
    throw new Error("GA4 report date must be YYYY-MM-DD, today, yesterday or NdaysAgo.");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value;
  const day = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

function validateRows(value: unknown, dimensionCount: number): Ga4ApiRow[] {
  if (!Array.isArray(value)) throw new Error("GA4 runReport returned invalid rows.");
  for (const row of value) {
    if (!row || !Array.isArray(row.dimensionValues) || row.dimensionValues.length !== dimensionCount ||
        row.dimensionValues.some((entry: { value?: unknown } | null) => !entry || typeof entry.value !== "string") ||
        !Array.isArray(row.metricValues) || row.metricValues.length !== 2 ||
        row.metricValues.some((entry: { value?: unknown } | null) =>
          !entry || typeof entry.value !== "string" || !/^\d+$/u.test(entry.value) ||
          !Number.isSafeInteger(Number(entry.value)))) {
      throw new Error("GA4 runReport returned an invalid dimension or count; refusing to substitute zero.");
    }
  }
  return value as Ga4ApiRow[];
}

export async function fetchGa4ReportRows(
  token: string, propertyId: string, date: string, dimensions: string[], fetchImpl: typeof fetch
): Promise<Ga4ApiRow[]> {
  const rows: Ga4ApiRow[] = [];
  const seen = new Set<string>();
  let expected: number | undefined;
  const limit = 200;
  for (let page = 0; page < 500; page += 1) {
    const response = await fetchImpl(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: date, endDate: date }],
          dimensions: dimensions.map((name) => ({ name })),
          metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
          orderBys: dimensions.map((dimensionName) => ({ dimension: { dimensionName }, desc: false })),
          limit: String(limit), offset: String(rows.length)
        })
      }
    );
    if (!response.ok) throw new Error(`GA4 runReport failed (HTTP ${response.status}); no report written.`);
    let decoded: unknown;
    try { decoded = await response.json(); }
    catch { throw new Error("GA4 runReport returned invalid JSON; no report written."); }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("GA4 runReport returned an invalid response.");
    }
    const payload = decoded as ReportPayload;
    if (payload.error !== undefined) throw new Error("GA4 runReport returned an API error; no report written.");
    const meta = payload.metadata;
    if (meta?.subjectToThresholding || meta?.dataLossFromOtherRow) {
      throw new Error("GA4 report incomplete: thresholding or (other) row data loss.");
    }
    for (const sample of meta?.samplingMetadatas ?? []) {
      if (!/^\d+$/u.test(sample.samplesReadCount ?? "") || !/^\d+$/u.test(sample.samplingSpaceSize ?? "") ||
          BigInt(sample.samplesReadCount!) !== BigInt(sample.samplingSpaceSize!)) {
        throw new Error("GA4 report incomplete: sampled or invalid sampling metadata.");
      }
    }
    if (payload.rowCount !== undefined) {
      if (typeof payload.rowCount !== "number" || !Number.isSafeInteger(payload.rowCount) || payload.rowCount < 0) {
        throw new Error("GA4 runReport returned invalid rowCount.");
      }
      if (expected !== undefined && expected !== payload.rowCount) {
        throw new Error("GA4 rowCount changed during pagination; rerun a stable completed date.");
      }
      expected = payload.rowCount;
    }
    // Protobuf JSON may omit rows / rowCount for zero. Require either an
    // explicit zero or the actual report headers, not an arbitrary {} body.
    const emptyWithHeaders = Array.isArray(payload.dimensionHeaders) &&
      payload.dimensionHeaders.length === dimensions.length &&
      Array.isArray(payload.metricHeaders) && payload.metricHeaders.length === 2;
    const values = payload.rows === undefined && (expected === 0 || emptyWithHeaders) ? [] : payload.rows;
    const batch = validateRows(values, dimensions.length);
    if (batch.length > limit) throw new Error("GA4 returned more rows than the requested page limit.");
    if (batch.length === 0 && expected !== undefined && rows.length < expected) {
      throw new Error("GA4 pagination stopped before rowCount; refusing a partial report.");
    }
    for (const row of batch) {
      const key = JSON.stringify(row.dimensionValues.map((entry) => entry.value));
      if (seen.has(key)) throw new Error("GA4 pagination repeated a dimension row; refusing double counting.");
      seen.add(key);
      rows.push(row);
    }
    if (expected !== undefined) {
      if (rows.length > expected) throw new Error("GA4 received more rows than rowCount.");
      if (rows.length === expected) return rows;
    } else if (batch.length < limit) {
      return rows;
    }
  }
  throw new Error("GA4 pagination safety limit reached; no partial report written.");
}
