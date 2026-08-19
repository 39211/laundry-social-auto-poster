import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { verifyPublicAssetUrl } from "./githubPages";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { findStrictLiveTransportEntry } from "./publishingReconciliation";
import { assertCanonicalPublicPublicationApproval } from "./publicPublicationApproval";
import { getZonedDateParts } from "./scheduler";

// Re-shares the day's live posts to Instagram Stories.
//
// A cold account's feed post reaches roughly 150 people and the algorithm
// stops there when nobody saves or shares (see the 2026-08-11 distribution
// report). Stories are a separate surface with their own ranking, and they
// reach the people who already follow but never see the feed post. This is
// the cheapest additional touchpoint that does not depend on the owner.
//
// Only posts already confirmed live are re-shared, and each slot is shared at
// most once per day.

interface StoryRecord {
  date: string;
  slot: number;
  platform: "instagram";
  media_id: string;
  story_id: string;
  created_at: string;
}

interface StoryRemoteClaim {
  schema_version: 1;
  date: string;
  slot: number;
  platform: "instagram";
  media_id: string;
  claimed_at: string;
}

function isSameSlotCandidate(value: unknown, slot: number): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { slot?: unknown };
  return record.slot === slot || String(record.slot) === String(slot);
}

function storyClaimPath(root: string, date: string, slot: number): string {
  return join(root, "data", "story-claims", date, `slot-${String(slot).padStart(2, "0")}-instagram.json`);
}

async function claimStoryRemotePost(input: {
  root: string;
  date: string;
  slot: number;
  mediaId: string;
}): Promise<"claimed" | "already_claimed"> {
  const path = storyClaimPath(input.root, input.date, input.slot);
  const claim: StoryRemoteClaim = {
    schema_version: 1,
    date: input.date,
    slot: input.slot,
    platform: "instagram",
    media_id: input.mediaId,
    claimed_at: new Date().toISOString()
  };
  await mkdir(join(input.root, "data", "story-claims", input.date), { recursive: true });
  try {
    // A Story create/publish sequence can commit remotely before any local
    // writer fails.  Keep the immutable claim as the no-retry authority.
    await writeFile(path, `${JSON.stringify(claim, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return "claimed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "already_claimed";
    throw error;
  }
}

function hasTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isUsableLiveMetaValue(value: unknown): value is string {
  if (!hasTrimmedNonEmptyString(value)) return false;
  return !/^(?:\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    value
  );
}

function assertLiveStoryMetaConfig(config: ReturnType<typeof getConfig>): void {
  const invalid = [
    ["META_GRAPH_API_VERSION", config.graphApiVersion, /^v\d+(?:\.\d+)?$/],
    ["META_ACCESS_TOKEN", config.metaAccessToken],
    ["IG_USER_ID", config.instagramUserId]
  ].filter(([, value, format]) =>
    !isUsableLiveMetaValue(value) || (format instanceof RegExp && !format.test(value))
  );
  if (invalid.length > 0) {
    throw new Error(`invalid or missing live Meta config: ${invalid.map(([name]) => name).join(", ")}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function optionalReadbackString(record: Record<string, unknown>, field: string): string | undefined {
  if (!(field in record) || record[field] === undefined || record[field] === null) return undefined;
  const value = record[field];
  if (!hasTrimmedNonEmptyString(value)) {
    throw new Error(`Story remote readback field ${field} is blank or malformed`);
  }
  return value;
}

function assertPublishedStoryReadback(input: {
  payload: unknown;
  storyId: string;
  isVideo: boolean;
  config: ReturnType<typeof getConfig>;
}): void {
  const record = asRecord(input.payload);
  if (!record) throw new Error("Story remote readback is not an object");
  const id = optionalReadbackString(record, "id");
  if (id !== input.storyId) {
    throw new Error(`Story remote readback id does not bind to published id ${input.storyId}`);
  }

  if (record.owner !== undefined && record.owner !== null) {
    const owner = typeof record.owner === "string" ? record.owner : asRecord(record.owner)?.id;
    if (!hasTrimmedNonEmptyString(owner) || owner !== input.config.instagramUserId) {
      throw new Error("Story remote readback owner does not match IG_USER_ID");
    }
  }
  for (const ownerField of ["owner_id", "instagram_user_id"]) {
    const owner = optionalReadbackString(record, ownerField);
    if (owner !== undefined && owner !== input.config.instagramUserId) {
      throw new Error(`Story remote readback ${ownerField} does not match IG_USER_ID`);
    }
  }

  const productType = optionalReadbackString(record, "media_product_type");
  if (productType !== undefined && productType.toUpperCase() !== "STORIES") {
    throw new Error(`Story remote readback media_product_type is not STORIES: ${productType}`);
  }
  const mediaType = optionalReadbackString(record, "media_type");
  const expectedMediaType = input.isVideo ? "VIDEO" : "IMAGE";
  if (mediaType !== undefined && !["STORIES", expectedMediaType].includes(mediaType.toUpperCase())) {
    throw new Error(`Story remote readback media_type does not match planned ${expectedMediaType} media`);
  }

  const permalink = optionalReadbackString(record, "permalink");
  if (permalink !== undefined) {
    try {
      if (new URL(permalink).protocol !== "https:") throw new Error("non-HTTPS permalink");
    } catch {
      throw new Error("Story remote readback permalink is malformed");
    }
  }
  for (const statusField of ["status_code", "status"]) {
    const status = optionalReadbackString(record, statusField);
    if (status !== undefined && !["FINISHED", "PUBLISHED"].includes(status.toUpperCase())) {
      throw new Error(`Story remote readback ${statusField} is not publishable: ${status}`);
    }
  }
}

async function verifyPublishedStoryRemote(input: {
  storyId: string;
  isVideo: boolean;
  config: ReturnType<typeof getConfig>;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const response = await input.fetchImpl(
    `https://graph.facebook.com/${input.config.graphApiVersion}/${input.storyId}?fields=id,owner,owner_id,instagram_user_id,media_type,media_product_type,permalink,status_code&access_token=${input.config.metaAccessToken}`
  );
  let payload: unknown = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`Story remote readback failed with HTTP ${response.status}`);
  }
  assertPublishedStoryReadback({ ...input, payload });
}

async function publishStory(
  mediaUrl: string,
  isVideo: boolean,
  config: ReturnType<typeof getConfig>,
  fetchImpl: typeof fetch,
  sleepImpl: (milliseconds: number) => Promise<void> =
    (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<string> {
  const base = `https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}`;
  const params = new URLSearchParams({
    media_type: "STORIES",
    access_token: config.metaAccessToken ?? ""
  });
  params.set(isVideo ? "video_url" : "image_url", mediaUrl);

  const create = await fetchImpl(`${base}/media`, { method: "POST", body: params });
  const created = (await create.json()) as { id?: string; error?: { message?: string } };
  if (!create.ok || !hasTrimmedNonEmptyString(created.id)) {
    throw new Error(created.error?.message ?? `Story container failed with ${create.status}`);
  }

  // Video stories need the container to finish processing; images are ready
  // immediately. Polling mirrors the Reel path.
  if (isVideo) {
    let finished = false;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const status = await fetchImpl(
        `https://graph.facebook.com/${config.graphApiVersion}/${created.id}?fields=status_code&access_token=${config.metaAccessToken}`
      );
      const payload = (await status.json()) as { status_code?: string };
      if (!status.ok) {
        throw new Error(`Story container ${created.id} status readback failed with HTTP ${status.status}`);
      }
      if (payload.status_code === "FINISHED") {
        finished = true;
        break;
      }
      if (payload.status_code === "ERROR" || payload.status_code === "EXPIRED") {
        throw new Error(`Story container ${created.id} is not publishable: ${payload.status_code}`);
      }
      if (attempt < 10) await sleepImpl(5000);
    }
    if (!finished) {
      throw new Error(
        `Story container ${created.id} remained IN_PROGRESS after the bounded readiness poll; ` +
          "media_publish was not attempted and recovery remains uncertain."
      );
    }
  }

  const publish = await fetchImpl(`${base}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: created.id, access_token: config.metaAccessToken ?? "" })
  });
  const published = (await publish.json()) as { id?: string; error?: { message?: string } };
  if (!publish.ok || !hasTrimmedNonEmptyString(published.id)) {
    throw new Error(published.error?.message ?? `Story publish failed with ${publish.status}`);
  }
  await verifyPublishedStoryRemote({ storyId: published.id, isVideo, config, fetchImpl });
  return published.id;
}

export async function shareLivePostsToStories(options: {
  date?: string;
  slot?: number;
  root?: string;
  fetchImpl?: typeof fetch;
  writeJsonAtomicImpl?: typeof writeJsonAtomic;
  sleepImpl?: (milliseconds: number) => Promise<void>;
} = {}): Promise<
  Array<{ slot: number; story_id?: string; skipped?: string }>
> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;
  const fetchImpl = options.fetchImpl ?? fetch;
  const writeLog = options.writeJsonAtomicImpl ?? writeJsonAtomic;

  const recordPath = join(root, "data", "stories", `${date}.json`);
  const existing = await readJsonFile<unknown>(recordPath, []);

  let content: Awaited<ReturnType<typeof loadDailyContent>>;
  try {
    content = await loadDailyContent(date, root);
  } catch (error) {
    if (config.dryRun) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    const blockedSlots = options.slot === undefined ? [1, 2, 3] : [options.slot];
    return blockedSlots.map((slot) => ({
      slot,
      skipped: `canonical public approval for ${date} is unverified; automatic Story publish is blocked: ${detail}`
    }));
  }
  const targetSlots = (content?.slots ?? []).filter((slot) => options.slot === undefined || slot.slot === options.slot);
  if (!content && !config.dryRun && options.slot !== undefined) {
    return [{
      slot: options.slot,
      skipped: `canonical public approval for ${date} is unverified; automatic Story publish is blocked: current calendar is missing`
    }];
  }
  // Dry-run is an inspection path and deliberately preserves its existing
  // per-slot behavior even when the calendar has later become tampered.
  if (content?.tampered && !config.dryRun) {
    return targetSlots.map((slot) => ({
      slot: slot.slot,
      skipped: `calendar for ${date} is tampered; automatic Story publish is blocked`
    }));
  }

  const posted = await loadPostLog(date, root);
  const results: Array<{ slot: number; story_id?: string; skipped?: string }> = [];
  let firstFailure: unknown;

  if (!Array.isArray(existing)) {
    return targetSlots.map((slot) => ({
      slot: slot.slot,
      skipped: `story log for ${date} is malformed; automatic Story publish is blocked`
    }));
  }

  for (const slot of targetSlots) {
    if (existing.some((entry) => isSameSlotCandidate(entry, slot.slot))) {
      results.push({ slot: slot.slot, skipped: "already shared" });
      continue;
    }
    const live = findStrictLiveTransportEntry(posted, {
      date,
      slot: slot.slot,
      platform: "instagram"
    });
    if (!live) {
      results.push({ slot: slot.slot, skipped: "not an unambiguous live Instagram transport" });
      continue;
    }
    if (config.dryRun) {
      results.push({ slot: slot.slot, skipped: "dry run" });
      continue;
    }

    // Do not turn a missing/placeholder credential into a durable no-retry
    // claim, and do not even probe a public asset until the live Graph target
    // is valid for this Story.
    try {
      assertLiveStoryMetaConfig(config);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({
        slot: slot.slot,
        skipped: `live Meta config for ${date} is invalid; automatic Story publish is blocked: ${detail}`
      });
      continue;
    }

    // Check next to the irreversible boundary. A calendar or approval sidecar
    // cannot authorize a Story, a public-media probe, or an immutable no-retry
    // claim unless it is canonical at this exact point.
    try {
      await assertCanonicalPublicPublicationApproval(date, root);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({
        slot: slot.slot,
        skipped: `canonical public approval for ${date} is unverified; automatic Story publish is blocked: ${detail}`
      });
      continue;
    }

    // The calendar carries a video URL for every slot, including days whose
    // video was deferred and never rendered. Handing Meta a 404 produced a
    // container in ERROR state (2026-08-11 slot 1), so the video URL is used
    // only when it is actually fetchable; otherwise the slot's image is.
    let videoUrl = slot.public_video_url;
    if (videoUrl) {
      try {
        await verifyPublicAssetUrl(videoUrl, fetchImpl);
      } catch {
        videoUrl = undefined;
      }
    }
    const imageUrl = slot.public_image_url;
    const mediaUrl = videoUrl || imageUrl;
    if (!mediaUrl) {
      results.push({ slot: slot.slot, skipped: "no public media url" });
      continue;
    }

    // Public-media probing awaits network I/O. Re-check the immutable release
    // decision before turning that probe into a no-retry claim or Graph POST.
    try {
      await assertCanonicalPublicPublicationApproval(date, root);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({
        slot: slot.slot,
        skipped: `canonical public approval for ${date} is unverified; automatic Story publish is blocked: ${detail}`
      });
      continue;
    }

    let claim: "claimed" | "already_claimed";
    try {
      claim = await claimStoryRemotePost({ root, date, slot: slot.slot, mediaId: live.post_id });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({
        slot: slot.slot,
        skipped: `Story remote claim cannot be recorded; automatic Story publish is blocked: ${detail}`
      });
      continue;
    }
    if (claim === "already_claimed") {
      results.push({
        slot: slot.slot,
        skipped: `remote Story claim already exists for ${date} slot ${slot.slot}; automatic retry is blocked pending recovery`
      });
      continue;
    }
    try {
      const storyId = await publishStory(mediaUrl, Boolean(videoUrl), config, fetchImpl, options.sleepImpl);
      const record: StoryRecord = {
        date,
        slot: slot.slot,
        platform: "instagram",
        media_id: live.post_id,
        story_id: storyId,
        created_at: new Date().toISOString()
      };
      try {
        await writeLog(recordPath, [...existing, record]);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Story ${storyId} may be live for ${date} slot ${slot.slot}, but local log commit failed: ${detail}. ` +
            "Automatic retry is blocked pending recovery."
        );
      }
      existing.push(record);
      results.push({ slot: slot.slot, story_id: storyId });
    } catch (error) {
      // A story is a bonus surface: its failure must never look like a
      // publishing failure or block another tuple.  It does remain visible as
      // a non-zero outcome after the loop because the immutable claim means a
      // remote state may now require manual recovery.
      results.push({ slot: slot.slot, skipped: error instanceof Error ? error.message : String(error) });
      firstFailure = firstFailure ?? error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const results = await shareLivePostsToStories({
    date: getOption(args, "date"),
    slot: getNumberOption(args, "slot"),
    root: getOption(args, "root")
  });
  for (const result of results) console.log(JSON.stringify(result));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
