import { randomUUID } from "node:crypto";
import { getNumberOption, getOption, isMain } from "./cli";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { conversionEventsPath, projectRoot } from "./paths";

export type ConversionEventType = "line_click" | "inquiry" | "booking" | "revenue";

export interface ConversionEvent {
  id: string;
  event_type: ConversionEventType;
  event_date: string;
  content_date?: string;
  slot?: number;
  platform?: "facebook" | "instagram" | "website" | "unknown";
  source: string;
  count: number;
  /** Anonymous cross-stage join key. Never put a phone, LINE user id, name, or order PII here. */
  journey_id?: string;
  /** Stable idempotency key for one source event (webhook/order/payment). */
  dedupe_key?: string;
  revenue_twd?: number;
  note?: string;
  created_at: string;
}

const EVENT_TYPES: ConversionEventType[] = ["line_click", "inquiry", "booking", "revenue"];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;

export interface JourneyFunnelRow {
  journey_id: string;
  sources: string[];
  source_conflict: boolean;
  line_clicks: number;
  inquiries: number;
  bookings: number;
  revenue_events: number;
  revenue_twd: number;
}

function sameDedupedEvent(existing: ConversionEvent, input: Omit<ConversionEvent, "id" | "created_at">): boolean {
  return (
    existing.event_type === input.event_type &&
    existing.event_date === input.event_date &&
    existing.source === input.source &&
    existing.count === input.count &&
    existing.journey_id === input.journey_id &&
    existing.revenue_twd === input.revenue_twd &&
    existing.content_date === input.content_date &&
    existing.slot === input.slot &&
    existing.platform === input.platform
  );
}

export function reconcileJourneyFunnel(events: ConversionEvent[]): JourneyFunnelRow[] {
  const grouped = new Map<string, JourneyFunnelRow>();
  for (const event of events) {
    if (!event.journey_id) continue;
    let row = grouped.get(event.journey_id);
    if (!row) {
      row = {
        journey_id: event.journey_id,
        sources: [],
        source_conflict: false,
        line_clicks: 0,
        inquiries: 0,
        bookings: 0,
        revenue_events: 0,
        revenue_twd: 0
      };
      grouped.set(event.journey_id, row);
    }
    if (event.source && !row.sources.includes(event.source)) {
      row.sources.push(event.source);
      row.sources.sort();
      row.source_conflict = row.sources.length > 1;
    }
    if (event.event_type === "line_click") row.line_clicks += event.count;
    else if (event.event_type === "inquiry") row.inquiries += event.count;
    else if (event.event_type === "booking") row.bookings += event.count;
    else if (event.event_type === "revenue") {
      row.revenue_events += event.count;
      row.revenue_twd += event.revenue_twd ?? 0;
    }
  }
  return [...grouped.values()].sort((a, b) => a.journey_id.localeCompare(b.journey_id));
}

export async function loadConversionEvents(root = projectRoot()): Promise<ConversionEvent[]> {
  return readJsonFile<ConversionEvent[]>(conversionEventsPath(root), []);
}

export async function recordConversionEvent(
  input: Omit<ConversionEvent, "id" | "created_at">,
  root = projectRoot()
): Promise<ConversionEvent> {
  if (!EVENT_TYPES.includes(input.event_type)) throw new Error(`Unsupported conversion event: ${input.event_type}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.event_date)) throw new Error("event_date must use YYYY-MM-DD.");
  if (input.content_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.content_date)) {
    throw new Error("content_date must use YYYY-MM-DD.");
  }
  if (input.slot !== undefined && ![1, 2].includes(input.slot)) throw new Error("slot must be 1 or 2.");
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error("count must be a positive integer.");
  if (input.journey_id && !SAFE_ID.test(input.journey_id)) {
    throw new Error("journey_id must be an anonymous 8-128 character safe id.");
  }
  if (input.dedupe_key && !SAFE_ID.test(input.dedupe_key)) {
    throw new Error("dedupe_key must be an 8-128 character safe id.");
  }
  if (input.event_type === "revenue" && (!Number.isFinite(input.revenue_twd) || (input.revenue_twd ?? 0) < 0)) {
    throw new Error("revenue events require a non-negative revenue_twd value.");
  }

  const events = await loadConversionEvents(root);
  if (input.dedupe_key) {
    const existing = events.find((row) => row.dedupe_key === input.dedupe_key);
    if (existing) {
      if (!sameDedupedEvent(existing, input)) {
        throw new Error(`Conflicting conversion event for dedupe_key: ${input.dedupe_key}`);
      }
      return existing;
    }
  }
  const event: ConversionEvent = {
    ...input,
    id: randomUUID(),
    created_at: new Date().toISOString()
  };
  events.push(event);
  await writeJsonAtomic(conversionEventsPath(root), events);
  return event;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const eventType = getOption(args, "event") as ConversionEventType | undefined;
  const eventDate = getOption(args, "date");
  const source = getOption(args, "source");
  if (!eventType || !eventDate || !source) {
    throw new Error("Required: --event line_click|inquiry|booking|revenue --date YYYY-MM-DD --source SOURCE");
  }
  const platformOption = getOption(args, "platform");
  const event = await recordConversionEvent({
    event_type: eventType,
    event_date: eventDate,
    content_date: getOption(args, "content-date"),
    slot: getNumberOption(args, "slot"),
    platform: platformOption as ConversionEvent["platform"],
    source,
    count: getNumberOption(args, "count") ?? 1,
    journey_id: getOption(args, "journey-id"),
    dedupe_key: getOption(args, "dedupe-key"),
    revenue_twd: getNumberOption(args, "revenue-twd"),
    note: getOption(args, "note")
  }, projectRoot(getOption(args, "root")));
  console.log(JSON.stringify(event, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
