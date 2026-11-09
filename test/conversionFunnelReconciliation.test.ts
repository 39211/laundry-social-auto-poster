import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadConversionEvents,
  recordConversionEvent,
  reconcileJourneyFunnel
} from "../src/conversionFunnel";

describe("anonymous conversion funnel reconciliation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "conversion-funnel-"));
    await mkdir(join(root, "data", "conversions"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is idempotent for a repeated source event", async () => {
    const input = {
      event_type: "inquiry" as const,
      event_date: "2026-11-10",
      platform: "website" as const,
      source: "google-organic",
      count: 1,
      journey_id: "j_4f98a0d8e7d1",
      dedupe_key: "evt_line_webhook_001"
    };

    const first = await recordConversionEvent(input, root);
    const second = await recordConversionEvent(input, root);
    expect(second.id).toBe(first.id);
    expect(await loadConversionEvents(root)).toHaveLength(1);
  });

  it("fails closed when the same dedupe key arrives with different business data", async () => {
    await recordConversionEvent({
      event_type: "booking",
      event_date: "2026-11-10",
      source: "chatgpt",
      count: 1,
      journey_id: "j_4f98a0d8e7d2",
      dedupe_key: "order_stage_0001"
    }, root);

    await expect(recordConversionEvent({
      event_type: "booking",
      event_date: "2026-11-10",
      source: "google-organic",
      count: 1,
      journey_id: "j_4f98a0d8e7d2",
      dedupe_key: "order_stage_0001"
    }, root)).rejects.toThrow(/Conflicting conversion event/);
    expect(await loadConversionEvents(root)).toHaveLength(1);
  });

  it("reconciles one anonymous journey across click, inquiry, booking and multiple payments", async () => {
    const journey_id = "j_4f98a0d8e7d3";
    const base = { event_date: "2026-11-10", source: "google-business", count: 1, journey_id };
    await recordConversionEvent({ ...base, event_type: "line_click", dedupe_key: "web_click_000001" }, root);
    await recordConversionEvent({ ...base, event_type: "inquiry", dedupe_key: "line_event_000001" }, root);
    await recordConversionEvent({ ...base, event_type: "booking", dedupe_key: "order_book_000001" }, root);
    await recordConversionEvent({ ...base, event_type: "revenue", revenue_twd: 300, dedupe_key: "payment_000001" }, root);
    await recordConversionEvent({ ...base, event_type: "revenue", revenue_twd: 450, dedupe_key: "payment_000002" }, root);

    expect(reconcileJourneyFunnel(await loadConversionEvents(root))).toEqual([{
      journey_id,
      sources: ["google-business"],
      source_conflict: false,
      line_clicks: 1,
      inquiries: 1,
      bookings: 1,
      revenue_events: 2,
      revenue_twd: 750
    }]);
  });

  it("flags conflicting attribution instead of silently picking a winner", () => {
    const rows = reconcileJourneyFunnel([
      {
        id: "1", event_type: "line_click", event_date: "2026-11-10", source: "chatgpt",
        count: 1, journey_id: "j_4f98a0d8e7d4", created_at: "2026-11-10T00:00:00Z"
      },
      {
        id: "2", event_type: "inquiry", event_date: "2026-11-10", source: "google-organic",
        count: 1, journey_id: "j_4f98a0d8e7d4", created_at: "2026-11-10T00:01:00Z"
      }
    ]);
    expect(rows[0]?.source_conflict).toBe(true);
    expect(rows[0]?.sources).toEqual(["chatgpt", "google-organic"]);
  });
});
