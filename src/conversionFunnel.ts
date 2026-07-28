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
  revenue_twd?: number;
  note?: string;
  created_at: string;
}

const EVENT_TYPES: ConversionEventType[] = ["line_click", "inquiry", "booking", "revenue"];

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
  if (input.event_type === "revenue" && (!Number.isFinite(input.revenue_twd) || (input.revenue_twd ?? 0) < 0)) {
    throw new Error("revenue events require a non-negative revenue_twd value.");
  }

  const event: ConversionEvent = {
    ...input,
    id: randomUUID(),
    created_at: new Date().toISOString()
  };
  const events = await loadConversionEvents(root);
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
