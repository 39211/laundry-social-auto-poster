/**
 * Publish ONE off-calendar feature Reel to Facebook, Instagram and YouTube.
 *
 * Owner directive 2026-09-15: put the finished shoe-wash film out at 14:00 today.
 * That is a fourth publication on a day whose calendar already holds slot 1 (11:30
 * carousel), slot 3 (12:00 Reel) and slot 2 (20:30 Reel), so this lane deliberately
 * touches none of the slot machinery:
 *
 *   - it never writes data/posted-log or data/youtube-log, because publish-sentinel,
 *     watchdog-patrol and day-audit all read those to decide whether a SLOT published.
 *     A feature row in there would make a missing slot look published.
 *   - it keeps its own per-platform log at data/feature-posted-log/<date>.json, the
 *     same shape as the campaign-poster lane, so a second run cannot double-post.
 *   - it takes the video by URL and never re-derives it from the calendar.
 *
 * WHY MOST OF THE WORK HAPPENS EARLY. 14:00 is already a three-way contention point
 * in Task Scheduler: Laundry-Publish-1400 (catchup-publish) and Laundry-Reel-Produce
 * both fire then, and both touch this repo and git. Facebook and YouTube can both be
 * handed a publish time and will release the post themselves, so those two are queued
 * hours ahead on the platform side and cannot be hurt by local contention. Instagram's
 * API has no scheduling at all, so it is the only thing that has to run at 14:00.
 *
 *   --schedule     queue Facebook + YouTube for --at. Run this early.
 *   --publish-ig   post the Instagram Reel now. This is the 14:00 job.
 *
 * Both modes need --live. Without it nothing leaves the machine, because DRY_RUN=false
 * already sits in .env and every getConfig() caller on this box is live by default.
 *
 * Usage:
 *   npx tsx src/postFeatureReel.ts --date 2026-09-15 --schedule --at 14:00 --live
 *   npx tsx src/postFeatureReel.ts --date 2026-09-15 --publish-ig --live
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

import { getConfig } from "./config.js";
import { postFacebookReel } from "./postFacebook.js";
import { postInstagramReel } from "./postInstagram.js";
import type { PostInput, PostResult } from "./types.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";

/** A 56 MB fetch-by-URL takes Meta well past the 50 s the slot lane allows. */
const IG_POLL = { maxAttempts: 48, intervalMs: 5000 };

export interface FeatureReel {
  date: string;
  slug: string;
  video_url: string;
  local_video_path: string;
  facebook_caption: string;
  instagram_caption: string;
  youtube_title: string;
  youtube_description: string;
  youtube_tags: string[];
}

interface FeatureLogEntry {
  platform: "facebook" | "instagram" | "youtube";
  slug: string;
  status: "success" | "scheduled" | "failed";
  post_id?: string;
  scheduled_publish_at?: string;
  error?: string;
  at: string;
}

function projectRoot(root?: string): string {
  return root ?? process.cwd();
}

function logPath(date: string, root: string): string {
  return join(root, "data", "feature-posted-log", `${date}.json`);
}

async function readLog(date: string, root: string): Promise<FeatureLogEntry[]> {
  const p = logPath(date, root);
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(await readFile(p, "utf8")) as FeatureLogEntry[];
  } catch {
    return [];
  }
}

async function appendLog(date: string, root: string, entry: FeatureLogEntry): Promise<void> {
  const p = logPath(date, root);
  await mkdir(dirname(p), { recursive: true });
  const rows = await readLog(date, root);
  rows.push(entry);
  await writeFile(p, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

/** Already done on this platform for this slug? The whole idempotency story. */
function alreadyDone(rows: FeatureLogEntry[], slug: string, platform: string): FeatureLogEntry | undefined {
  return rows.find(
    (r) => r.slug === slug && r.platform === platform && (r.status === "success" || r.status === "scheduled")
  );
}

/** Unix seconds for HH:MM Taipei on the given date. */
export function taipeiUnix(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}:00+08:00`).getTime() / 1000);
}

async function loadReel(date: string, root: string): Promise<FeatureReel> {
  const p = join(root, "data", "feature-reels", `${date}.json`);
  if (!existsSync(p)) throw new Error(`No feature reel defined at ${p}`);
  return JSON.parse(await readFile(p, "utf8")) as FeatureReel;
}

// --- YouTube -------------------------------------------------------------
// postYouTube.ts keeps credentials(), accessToken() and postShortMultipart()
// private, and its uploadShort() is gated on the slot calendar plus a live
// Instagram slot Reel, neither of which an off-calendar film can satisfy. Rather
// than loosen gates on the daily publisher, the three primitives are restated
// here. They are small, and this lane writes a different log, so the two cannot
// interfere.

function ytCredentials(): { clientId: string; clientSecret: string; refreshToken: string } | undefined {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

async function ytAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const creds = ytCredentials();
  if (!creds) throw new Error("YouTube credentials are not configured; run npm run youtube-auth.");
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token"
    })
  });
  const payload = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`YouTube token refresh failed: ${payload.error_description ?? response.status}`);
  }
  return payload.access_token;
}

async function ytUpload(
  video: Buffer,
  metadata: Record<string, unknown>,
  token: string,
  fetchImpl: typeof fetch
): Promise<{ id: string }> {
  const boundary = `sxjfeature${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const response = await fetchImpl(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body: Buffer.concat([head, video, tail])
  });
  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(`YouTube upload failed: ${payload.error?.message ?? response.status}`);
  }
  return { id: payload.id };
}

// --- modes ---------------------------------------------------------------

export async function scheduleFeature(opts: {
  date: string;
  at: string;
  root?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const root = projectRoot(opts.root);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const reel = await loadReel(opts.date, root);
  const config = getConfig();
  const publishAt = taipeiUnix(opts.date, opts.at);
  const iso = new Date(publishAt * 1000).toISOString();
  const rows = await readLog(opts.date, root);

  // Facebook: Meta holds it and releases it itself.
  const fbDone = alreadyDone(rows, reel.slug, "facebook");
  if (fbDone) {
    console.log(`facebook  SKIP  already ${fbDone.status} (${fbDone.post_id ?? "no id"})`);
  } else {
    const input: PostInput = {
      date: opts.date,
      slot: 0,
      caption: reel.facebook_caption,
      imageUrl: "",
      mediaType: "reel",
      videoUrl: reel.video_url,
      scheduledPublishTime: publishAt
    };
    try {
      const result: PostResult = await postFacebookReel(input, config, fetchImpl);
      await appendLog(opts.date, root, {
        platform: "facebook",
        slug: reel.slug,
        status: "scheduled",
        post_id: result.post_id,
        scheduled_publish_at: iso,
        at: new Date().toISOString()
      });
      console.log(`facebook  SCHEDULED for ${opts.at} Taipei  video_id=${result.post_id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(opts.date, root, {
        platform: "facebook",
        slug: reel.slug,
        status: "failed",
        error: message,
        at: new Date().toISOString()
      });
      console.log(`facebook  FAILED  ${message}`);
    }
  }

  // YouTube: uploaded private with publishAt, so YouTube releases it itself.
  const ytDone = alreadyDone(rows, reel.slug, "youtube");
  if (ytDone) {
    console.log(`youtube   SKIP  already ${ytDone.status} (${ytDone.post_id ?? "no id"})`);
    return;
  }
  if (!ytCredentials()) {
    console.log("youtube   SKIP  credentials not configured");
    return;
  }
  try {
    const token = await ytAccessToken(fetchImpl);
    const video = await readFile(join(root, ...reel.local_video_path.split("/")));
    const uploaded = await ytUpload(
      video,
      {
        snippet: {
          title: reel.youtube_title,
          description: reel.youtube_description,
          categoryId: "26",
          defaultLanguage: "zh-Hant",
          tags: reel.youtube_tags
        },
        status: {
          privacyStatus: "private",
          publishAt: iso,
          selfDeclaredMadeForKids: false
        }
      },
      token,
      fetchImpl
    );
    await appendLog(opts.date, root, {
      platform: "youtube",
      slug: reel.slug,
      status: "scheduled",
      post_id: uploaded.id,
      scheduled_publish_at: iso,
      at: new Date().toISOString()
    });
    console.log(`youtube   SCHEDULED for ${opts.at} Taipei  video_id=${uploaded.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendLog(opts.date, root, {
      platform: "youtube",
      slug: reel.slug,
      status: "failed",
      error: message,
      at: new Date().toISOString()
    });
    console.log(`youtube   FAILED  ${message}`);
  }
}

export async function publishInstagram(opts: {
  date: string;
  root?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const root = projectRoot(opts.root);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const reel = await loadReel(opts.date, root);
  const config = getConfig();
  const rows = await readLog(opts.date, root);

  const done = alreadyDone(rows, reel.slug, "instagram");
  if (done) {
    console.log(`instagram SKIP  already ${done.status} (${done.post_id ?? "no id"})`);
    return;
  }

  const input: PostInput = {
    date: opts.date,
    slot: 0,
    caption: reel.instagram_caption,
    imageUrl: "",
    mediaType: "reel",
    videoUrl: reel.video_url
  };
  try {
    const result = await postInstagramReel(input, config, fetchImpl, IG_POLL);
    await appendLog(opts.date, root, {
      platform: "instagram",
      slug: reel.slug,
      status: "success",
      post_id: result.post_id,
      at: new Date().toISOString()
    });
    console.log(`instagram PUBLISHED  media_id=${result.post_id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendLog(opts.date, root, {
      platform: "instagram",
      slug: reel.slug,
      status: "failed",
      error: message,
      at: new Date().toISOString()
    });
    console.log(`instagram FAILED  ${message}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const date = value("--date");
  if (!date) throw new Error("--date is required");
  const root = value("--root") ?? process.cwd();

  if (!args.includes("--live")) {
    const reel = await loadReel(date, root);
    console.log("DRY: --live not given, nothing was sent.");
    console.log(`  slug        ${reel.slug}`);
    console.log(`  video_url   ${reel.video_url}`);
    console.log(`  fb caption  ${reel.facebook_caption.split("\n")[0]}`);
    console.log(`  ig caption  ${reel.instagram_caption.split("\n")[0]}`);
    console.log(`  yt title    ${reel.youtube_title}`);
    return;
  }

  if (args.includes("--schedule")) {
    await scheduleFeature({ date, at: value("--at") ?? "14:00", root });
    return;
  }
  if (args.includes("--publish-ig")) {
    await publishInstagram({ date, root });
    return;
  }
  throw new Error("pass --schedule or --publish-ig");
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("src/postFeatureReel.ts");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
