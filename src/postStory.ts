import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
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
  story_id: string;
  created_at: string;
}

async function publishStory(
  mediaUrl: string,
  isVideo: boolean,
  config: ReturnType<typeof getConfig>,
  fetchImpl: typeof fetch
): Promise<string> {
  const base = `https://graph.facebook.com/${config.graphApiVersion}/${config.instagramUserId}`;
  const params = new URLSearchParams({
    media_type: "STORIES",
    access_token: config.metaAccessToken ?? ""
  });
  params.set(isVideo ? "video_url" : "image_url", mediaUrl);

  const create = await fetchImpl(`${base}/media`, { method: "POST", body: params });
  const created = (await create.json()) as { id?: string; error?: { message?: string } };
  if (!create.ok || !created.id) {
    throw new Error(created.error?.message ?? `Story container failed with ${create.status}`);
  }

  // Video stories need the container to finish processing; images are ready
  // immediately. Polling mirrors the Reel path.
  if (isVideo) {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const status = await fetchImpl(
        `https://graph.facebook.com/${config.graphApiVersion}/${created.id}?fields=status_code&access_token=${config.metaAccessToken}`
      );
      const payload = (await status.json()) as { status_code?: string };
      if (payload.status_code === "FINISHED") break;
      if (payload.status_code === "ERROR" || payload.status_code === "EXPIRED") {
        throw new Error(`Story container ${created.id} is not publishable: ${payload.status_code}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  const publish = await fetchImpl(`${base}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: created.id, access_token: config.metaAccessToken ?? "" })
  });
  const published = (await publish.json()) as { id?: string; error?: { message?: string } };
  if (!publish.ok || !published.id) {
    throw new Error(published.error?.message ?? `Story publish failed with ${publish.status}`);
  }
  return published.id;
}

export async function shareLivePostsToStories(options: { date?: string; root?: string } = {}): Promise<
  Array<{ slot: number; story_id?: string; skipped?: string }>
> {
  const root = projectRoot(options.root);
  const config = getConfig();
  const date = options.date || getZonedDateParts(new Date(), config.timezone).date;

  const recordPath = join(root, "data", "stories", `${date}.json`);
  const existing = await readJsonFile<StoryRecord[]>(recordPath, []);
  const content = await loadDailyContent(date, root);
  const posted = await loadPostLog(date, root);
  const results: Array<{ slot: number; story_id?: string; skipped?: string }> = [];

  for (const slot of content?.slots ?? []) {
    if (existing.some((entry) => entry.slot === slot.slot)) {
      results.push({ slot: slot.slot, skipped: "already shared" });
      continue;
    }
    const live = posted.some(
      (entry) =>
        entry.slot === slot.slot &&
        entry.platform === "instagram" &&
        !entry.dry_run &&
        (entry.status === "success" || entry.status === "posted")
    );
    if (!live) {
      results.push({ slot: slot.slot, skipped: "not live on Instagram" });
      continue;
    }
    if (config.dryRun) {
      results.push({ slot: slot.slot, skipped: "dry run" });
      continue;
    }

    const videoUrl = slot.public_video_url;
    const imageUrl = slot.public_image_url;
    const mediaUrl = videoUrl || imageUrl;
    if (!mediaUrl) {
      results.push({ slot: slot.slot, skipped: "no public media url" });
      continue;
    }
    try {
      const storyId = await publishStory(mediaUrl, Boolean(videoUrl), config, fetch);
      existing.push({ date, slot: slot.slot, story_id: storyId, created_at: new Date().toISOString() });
      await writeJsonAtomic(recordPath, existing);
      results.push({ slot: slot.slot, story_id: storyId });
    } catch (error) {
      // A story is a bonus surface: its failure must never look like a
      // publishing failure or block the rest of the day.
      results.push({ slot: slot.slot, skipped: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const results = await shareLivePostsToStories({
    date: getOption(args, "date"),
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
