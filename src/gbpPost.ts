import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { buildGbpPostCaption } from "./contentPlan";
import {
  GbpAuthError,
  readGbpEnvIds,
  refreshGbpAccessToken,
  requireGbpAccountId
} from "./gbpAuth";
import { loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import {
  facebookInsightsDirectory,
  instagramInsightsDirectory,
  projectRoot
} from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { DailyContent, DailySlot, PostLogEntry, PostStatus } from "./types";

export const GBP_SUMMARY_MAX = 1500;
export const GBP_LINE_REDIRECT = "https://39211.github.io/go/line.html?source=gbp";
const LOCAL_POSTS_API = "https://mybusiness.googleapis.com/v4";
const LIVE_STATUSES = new Set<PostStatus>(["success", "posted"]);

export type GbpSelectionReason = "highest_engagement" | "latest";

export interface GbpLocalPostPayload {
  languageCode: "zh-TW";
  summary: string;
  topicType: "STANDARD";
  callToAction: {
    actionType: "LEARN_MORE";
    url: string;
  };
  media: Array<{
    mediaFormat: "PHOTO";
    sourceUrl: string;
  }>;
}

export interface GbpWeeklyComposition {
  date: string;
  source: {
    date: string;
    slot: number;
    topic: string;
    selection: GbpSelectionReason;
    engagement?: number;
    created_at: string;
  };
  summary: string;
  ctaUrl: string;
  mediaUrl: string;
  apiPayload: GbpLocalPostPayload;
}

export interface GbpDraftFile {
  dry_run: true;
  generated_at: string;
  date: string;
  parent: string;
  missing: string[];
  source: GbpWeeklyComposition["source"];
  preview: {
    headline: string;
    summary: string;
    summary_length: number;
    cta_url: string;
    media_url: string;
    selection_reason: string;
  };
  api_payload: GbpLocalPostPayload;
  endpoint: string;
}

export interface GbpCreateResult {
  dry_run: boolean;
  date: string;
  draft_path?: string;
  name?: string;
  composition: GbpWeeklyComposition;
  parent: string;
}

export interface GbpPostOptions {
  date?: string;
  root?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

interface SlotCandidate {
  date: string;
  slot: number;
  topic: string;
  body: string;
  mediaUrl: string;
  created_at: string;
  engagement?: number;
}

interface InsightFileShape {
  generated_at?: string;
  rows?: Array<{
    date?: string;
    slot?: number;
    insights_ok?: boolean;
    metrics?: Record<string, unknown>;
    insights?: Record<string, unknown>;
  }>;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function sumKnown(values: unknown[]): number | undefined {
  const numbers = values.map(asFiniteNumber).filter((value): value is number => value !== undefined);
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : undefined;
}

function scoreInstagramRow(row: NonNullable<InsightFileShape["rows"]>[number]): number | undefined {
  if (row.insights_ok === false) return undefined;
  const metrics = row.metrics ?? {};
  return asFiniteNumber(metrics.total_interactions) ?? sumKnown([metrics.likes, metrics.comments, metrics.shares, metrics.saved]);
}

function scoreFacebookRow(row: NonNullable<InsightFileShape["rows"]>[number]): number | undefined {
  if (row.insights_ok === false) return undefined;
  const insights = row.insights ?? {};
  return (
    asFiniteNumber(insights.total_interactions) ??
    sumKnown([insights.reactions, insights.comments, insights.shares])
  );
}

function isLivePosted(entry: PostLogEntry): boolean {
  return entry.dry_run === false && LIVE_STATUSES.has(entry.status);
}

export function isPublicHttpsUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

export function addUtcDays(date: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`GBP date must be YYYY-MM-DD, got: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.toISOString().slice(0, 10);
}

export function lastSevenDates(asOf: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addUtcDays(asOf, -index));
}

export function gbpDraftPath(date: string, root = projectRoot()): string {
  return join(root, "output", "gbp-drafts", `${date}.json`);
}

export function isGbpDryRun(args: string[]): boolean {
  const publish = getFlag(args, "publish");
  const dryRun = getFlag(args, "dry-run");
  if (publish && dryRun) {
    throw new Error("Pass only one of --dry-run or --publish");
  }
  return !publish;
}

export function gbpParentPath(accountId: string, locationId: string): string {
  const account = accountId.startsWith("accounts/") ? accountId : `accounts/${accountId}`;
  const location = locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
  return `${account}/${location}`;
}

export function extractGbpCtaUrl(caption: string): string {
  const match = caption.match(/https:\/\/[^(\s]+/);
  if (!match?.[0]) {
    throw new Error("GBP caption is missing the utm-tagged CTA URL");
  }
  const url = match[0];
  if (!url.includes("utm_source=gbp")) {
    throw new Error("GBP caption CTA is missing utm_source=gbp");
  }
  return url;
}

export function clipGbpSummary(body: string, date: string, slot: number): string {
  const trimmed = body.replace(/\r\n/g, "\n").trim();
  const caption = buildGbpPostCaption({ date, body: trimmed, slot });
  if (caption.length <= GBP_SUMMARY_MAX) return caption;

  const suffix = buildGbpPostCaption({ date, body: "", slot });
  const budget = GBP_SUMMARY_MAX - suffix.length;
  if (budget < 1) {
    throw new Error(`GBP CTA alone exceeds the ${GBP_SUMMARY_MAX}-character summary limit`);
  }
  const clipped = buildGbpPostCaption({ date, body: trimmed.slice(0, budget), slot });
  if (clipped.length > GBP_SUMMARY_MAX) {
    throw new Error(`GBP summary still exceeds ${GBP_SUMMARY_MAX} after clipping`);
  }
  return clipped;
}

function sourceBody(slot: DailySlot): string {
  const raw = (slot.facebook_caption || slot.instagram_caption || slot.topic || "").replace(/\r\n/g, "\n");
  const kept = raw.split("\n").filter((line) => {
    if (line.includes("go/line.html")) return false;
    if (/utm_source=|utm_medium=|utm_campaign=/.test(line)) return false;
    const trimmed = line.trim();
    if (trimmed && /^#[^\s#]+(?:\s+#[^\s#]+)*$/u.test(trimmed)) return false;
    return true;
  });
  const body = kept.join("\n").trim();
  return body || slot.topic;
}

function slotMediaUrl(slot: DailySlot): string | undefined {
  const candidates = [slot.public_image_url, slot.carousel_items?.[0]?.public_image_url];
  return candidates.find((value) => typeof value === "string" && isPublicHttpsUrl(value));
}

function compareLatest(a: SlotCandidate, b: SlotCandidate): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.slot - a.slot;
}

async function loadEngagementIndex(root: string): Promise<Map<string, number>> {
  type Platform = "ig" | "fb";
  const perKey = new Map<string, Partial<Record<Platform, { score: number; generatedAt: string }>>>();

  const ingest = async (dir: string, platform: Platform, score: typeof scoreInstagramRow) => {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const report = await readJsonFile<InsightFileShape | undefined>(join(dir, name), undefined);
      if (!report || !Array.isArray(report.rows)) continue;
      const generatedAt = typeof report.generated_at === "string" ? report.generated_at : name;
      for (const row of report.rows) {
        if (!row.date || !Number.isInteger(row.slot)) continue;
        const value = score(row);
        if (value === undefined) continue;
        const key = `${row.date}:${row.slot}`;
        const current = perKey.get(key) ?? {};
        const existing = current[platform];
        if (!existing || generatedAt >= existing.generatedAt) {
          current[platform] = { score: value, generatedAt };
          perKey.set(key, current);
        }
      }
    }
  };

  await ingest(instagramInsightsDirectory(root), "ig", scoreInstagramRow);
  await ingest(facebookInsightsDirectory(root), "fb", scoreFacebookRow);

  const index = new Map<string, number>();
  for (const [key, parts] of perKey) {
    if (parts.ig === undefined && parts.fb === undefined) continue;
    index.set(key, (parts.ig?.score ?? 0) + (parts.fb?.score ?? 0));
  }
  return index;
}

async function collectCandidates(asOf: string, root: string): Promise<SlotCandidate[]> {
  const engagement = await loadEngagementIndex(root);
  const grouped = new Map<string, { created_at: string }>();

  for (const date of lastSevenDates(asOf)) {
    const entries = await loadPostLog(date, root);
    for (const entry of entries) {
      if (!isLivePosted(entry)) continue;
      const key = `${entry.date}:${entry.slot}`;
      const created = entry.created_at || `${entry.date}T00:00:00.000Z`;
      const existing = grouped.get(key);
      if (!existing || created > existing.created_at) {
        grouped.set(key, { created_at: created });
      }
    }
  }

  const candidates: SlotCandidate[] = [];
  for (const [key, meta] of grouped) {
    const [date, slotText] = key.split(":");
    if (!date || !slotText) continue;
    const slotNumber = Number(slotText);
    const content = await readJsonFile<DailyContent | undefined>(
      join(root, "data", "content-calendar", `${date}.json`),
      undefined
    );
    const slot = content?.slots.find((item) => item.slot === slotNumber);
    if (!slot) continue;
    const mediaUrl = slotMediaUrl(slot);
    if (!mediaUrl) continue;
    candidates.push({
      date,
      slot: slotNumber,
      topic: slot.topic,
      body: sourceBody(slot),
      mediaUrl,
      created_at: meta.created_at,
      engagement: engagement.get(key)
    });
  }
  return candidates;
}

function pickCandidate(candidates: SlotCandidate[]): SlotCandidate {
  if (candidates.length === 0) {
    throw new Error("No published image slots in the last 7 days suitable for a GBP weekly post.");
  }
  const scored = candidates.filter((item) => item.engagement !== undefined);
  if (scored.length > 0) {
    return [...scored].sort((a, b) => {
      const delta = (b.engagement ?? 0) - (a.engagement ?? 0);
      return delta !== 0 ? delta : compareLatest(a, b);
    })[0]!;
  }
  return [...candidates].sort(compareLatest)[0]!;
}

export function composeGbpSummary(input: { date: string; body: string; slot: number }): {
  summary: string;
  ctaUrl: string;
} {
  const summary = clipGbpSummary(input.body, input.date, input.slot);
  if (summary.length > GBP_SUMMARY_MAX) {
    throw new Error(`GBP summary exceeds ${GBP_SUMMARY_MAX} characters`);
  }
  return { summary, ctaUrl: extractGbpCtaUrl(summary) };
}

export async function composeWeeklyGbpPost(options: GbpPostOptions = {}): Promise<GbpWeeklyComposition> {
  const root = options.root ?? projectRoot();
  const date = options.date ?? getZonedDateParts(options.now ?? new Date()).date;
  const candidates = await collectCandidates(date, root);
  const chosen = pickCandidate(candidates);
  const { summary, ctaUrl } = composeGbpSummary({
    date: chosen.date,
    body: chosen.body,
    slot: chosen.slot
  });
  const selection: GbpSelectionReason = chosen.engagement === undefined ? "latest" : "highest_engagement";

  return {
    date,
    source: {
      date: chosen.date,
      slot: chosen.slot,
      topic: chosen.topic,
      selection,
      engagement: chosen.engagement,
      created_at: chosen.created_at
    },
    summary,
    ctaUrl,
    mediaUrl: chosen.mediaUrl,
    apiPayload: {
      languageCode: "zh-TW",
      summary,
      topicType: "STANDARD",
      callToAction: {
        actionType: "LEARN_MORE",
        url: ctaUrl
      },
      media: [
        {
          mediaFormat: "PHOTO",
          sourceUrl: chosen.mediaUrl
        }
      ]
    }
  };
}

function resolveParent(env: NodeJS.ProcessEnv): { parent: string; missing: string[] } {
  const ids = readGbpEnvIds(env);
  const missing: string[] = [];
  if (!ids.accountId) missing.push("GBP_ACCOUNT_ID");
  if (!ids.locationId) missing.push("GBP_LOCATION_ID");
  const account = ids.accountId || "{GBP_ACCOUNT_ID}";
  const location = ids.locationId || "{GBP_LOCATION_ID}";
  return { parent: gbpParentPath(account, location), missing };
}

export async function createLocalPost(
  dryRun: boolean,
  options: GbpPostOptions = {}
): Promise<GbpCreateResult> {
  const env = options.env ?? process.env;
  const root = options.root ?? projectRoot();
  if (!dryRun) {
    requireGbpAccountId(env);
    if (!readGbpEnvIds(env).locationId) {
      throw new GbpAuthError("GBP_LOCATION_ID is missing; refuse to publish.", "not_configured");
    }
  }

  const composition = await composeWeeklyGbpPost(options);
  const { parent, missing } = resolveParent(env);

  if (dryRun) {
    const draft: GbpDraftFile = {
      dry_run: true,
      generated_at: new Date().toISOString(),
      date: composition.date,
      parent,
      missing,
      source: composition.source,
      preview: {
        headline: composition.source.topic,
        summary: composition.summary,
        summary_length: composition.summary.length,
        cta_url: composition.ctaUrl,
        media_url: composition.mediaUrl,
        selection_reason:
          composition.source.selection === "highest_engagement"
            ? `highest_engagement (${composition.source.engagement ?? 0})`
            : "latest (no engagement data)"
      },
      api_payload: composition.apiPayload,
      endpoint: `POST ${LOCAL_POSTS_API}/${parent}/localPosts`
    };
    const draftPath = gbpDraftPath(composition.date, root);
    await writeJsonAtomic(draftPath, draft);
    return {
      dry_run: true,
      date: composition.date,
      draft_path: draftPath,
      composition,
      parent
    };
  }

  const accountId = requireGbpAccountId(env);
  const locationId = readGbpEnvIds(env).locationId;

  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = await refreshGbpAccessToken({ env, root, fetchImpl });
  const liveParent = gbpParentPath(accountId, locationId);
  const endpoint = `${LOCAL_POSTS_API}/${liveParent}/localPosts`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(composition.apiPayload)
  });

  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      throw new GbpAuthError("GBP localPosts.create rate limited (429)", "rate_limited", 429);
    }
    if (status === 401) {
      throw new GbpAuthError("GBP localPosts.create unauthorized (401)", "unauthorized", 401);
    }
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : undefined;
    const message = typeof nested?.message === "string" ? nested.message : `HTTP ${status}`;
    throw new Error(`GBP localPosts.create failed: ${message}`);
  }

  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const name = typeof record.name === "string" ? record.name : undefined;
  if (!name || name.trim() !== name) {
    throw new Error("GBP localPosts.create returned no usable resource name; refusing to claim success.");
  }

  // A create 2xx is only an accepted request, not proof that the local post
  // exists with the approved payload. Read it back before recording success.
  const readback = await fetchImpl(`${LOCAL_POSTS_API}/${encodeURIComponent(name)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  let readbackPayload: unknown = {};
  try {
    readbackPayload = await readback.json();
  } catch {
    readbackPayload = {};
  }
  const remote = readbackPayload && typeof readbackPayload === "object"
    ? (readbackPayload as Record<string, unknown>)
    : {};
  const remoteName = typeof remote.name === "string" ? remote.name : "";
  const remoteSummary = typeof remote.summary === "string" ? remote.summary : "";
  if (!readback.ok || remoteName !== name || remoteSummary !== composition.summary) {
    throw new Error("GBP localPosts read-back did not match the created name and summary; success is unverified.");
  }
  return {
    dry_run: false,
    date: composition.date,
    name,
    composition,
    parent: liveParent
  };
}

export async function runGbpPostCli(
  args: string[],
  options: GbpPostOptions = {}
): Promise<GbpCreateResult> {
  const dryRun = isGbpDryRun(args);
  const date = getOption(args, "date");
  return createLocalPost(dryRun, { ...options, date: date ?? options.date });
}

function printDryRunSummary(result: GbpCreateResult): void {
  const { composition, draft_path: draftPath, parent } = result;
  const lines = [
    "GBP weekly post dry-run",
    `date: ${result.date}`,
    `source: ${composition.source.date} slot ${composition.source.slot} (${composition.source.selection})`,
    `draft: ${draftPath ?? ""}`,
    `parent: ${parent}`,
    `summary_chars: ${composition.summary.length}`,
    `cta: ${composition.ctaUrl}`,
    `media: ${composition.mediaUrl}`
  ];
  console.log(lines.join("\n"));
}

if (isMain(import.meta.url)) {
  runGbpPostCli(process.argv.slice(2))
    .then((result) => {
      if (result.dry_run) {
        printDryRunSummary(result);
        return;
      }
      console.log(`GBP localPost created: ${result.name ?? result.date}`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
