import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  hasPublishableApproval,
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  readJsonFile,
  writeJsonAtomic
} from "./logging";
import { projectRoot } from "./paths";
import { loadPostedPackage } from "./publicSitePostedPackage";
import { getZonedDateParts } from "./scheduler";
import { utmCampaign, utmTagged } from "./utm";
import { assertVideoReviewApproved } from "./videoReviewGate";

// Uploads the day's published Reel to YouTube as a Short. The owner asked for
// every Reel to reach YouTube as well; FB/IG stay the primary chain and this
// runs after them, off its own schedule, so a YouTube fault can never block
// the Meta publishing that the 90-day programme is measured on.
//
// Credentials are the owner's: a one-time OAuth consent via `youtube-auth`
// writes the refresh token straight into .env without it ever passing through
// chat. Every upload declares altered/synthetic content, matching the C2PA
// stance on the images — the account never pretends generated footage is
// camera footage.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status";

interface YouTubeLogEntry {
  date: string;
  slot: number;
  video_id: string;
  title: string;
  uploaded_at: string;
  /** Present only on dual-Reel A/B days that have an ab-test-plan entry. */
  ab_variant?: AbVariant;
  /** P4: RFC3339 UTC publishAt used when this Short was queued private. */
  scheduled_publish_at?: string;
  /** P4: "scheduled" on the ahead path so the live uploader treats it as already sent. */
  video_status?: "scheduled" | "public";
  /** sha256 of the file that was uploaded or scheduled. */
  video_sha256?: string;
}

function credentials(): { clientId: string; clientSecret: string; refreshToken: string } | undefined {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  const refreshToken = process.env.YT_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

async function accessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const creds = credentials();
  if (!creds) throw new Error("YouTube credentials are not configured; run npm run youtube-auth first.");
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

async function postShortMultipart(
  metadata: {
    snippet: { title: string; description: string; categoryId: string; defaultLanguage: string };
    status: Record<string, unknown>;
  },
  video: Buffer,
  fetchImpl: typeof fetch
): Promise<string> {
  const boundary = `sixiangjia-${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, video, tail]);

  const token = await accessToken(fetchImpl);
  const response = await fetchImpl(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length)
    },
    body
  });
  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(`YouTube upload failed: ${payload.error?.message ?? response.status}`);
  }
  return payload.id;
}

// R5 / scheduleAhead.ts slotPublishUnixTime: interpret wall-clock as Taipei
// (+08:00), never the host timezone. This machine's bash TZ falls back to GMT.
function taipeiSlotUnix(date: string, time: string, timezoneOffset = "+08:00"): number {
  return Math.floor(new Date(`${date}T${time}:00${timezoneOffset}`).getTime() / 1000);
}

function rfc3339Utc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function skipped(reason: string): { status: "skipped"; reason: string } {
  return { status: "skipped", reason };
}

/** Title and description come from the day's own copy, not a new voice. */
export function buildShortMetadata(input: { topic: string; caption: string; date: string; slot?: number }): {
  title: string;
  description: string;
} {
  // YouTube titles cap at 100 characters; the hook is already short. #Shorts
  // in title or description is what routes the upload into the Shorts shelf.
  // The geo suffix is what YouTube/Google video search matches for "台中洗鞋"
  // queries — the bare hook alone carries no locality at all.
  const geoSuffix = /[鞋包靴]/.test(input.topic) ? "台中洗鞋洗包 免費收送" : "台中洗衣店 免費收送";
  const title = `${input.topic}`.slice(0, 70) + `｜${geoSuffix} #Shorts`;
  // AI answer engines quote YouTube descriptions, so the first line has to
  // stand alone as a fact rather than continue the video, and the link has to
  // land on the page that answers this topic. A generic home-page link gives a
  // reader nowhere to go and gives a crawler no topical connection.
  const campaign = utmCampaign(input.date, input.slot ?? 2, "reel");
  const tracking = { source: "youtube" as const, campaign };
  const deepLink = utmTagged(guideLinkFor(input.topic), tracking);
  const lineUrl = utmTagged(`${SITE}/go/line.html?source=yt`, tracking);
  const description = [
    `台中西屯的私享家洗衣店在處理${topicObject(input.topic)}時的判斷方式;台中市全區免費到府收送,清潔費另依物件判斷。`,
    input.caption.split("\n\n").slice(0, 3).join("\n\n"),
    priceLineFor(input.topic),
    "門市:台中市西屯區青海路二段365號(至善國中對面)｜LINE 傳照片先估:0968327653",
    `一鍵加 LINE:${lineUrl}`,
    "儲值優惠:滿1000送100、儲3000送400、儲6000送1000",
    `這個主題的完整說明:${deepLink}`,
    "#Shorts #台中洗衣店 #台中洗鞋 #西屯洗鞋 #逢甲洗鞋 #洗包"
  ]
    .filter(Boolean)
    .join("\n\n");
  return { title, description };
}

// R8: custom domain is the canonical host; the github.io origin 301s but drops
// a hop that some AI crawlers will not follow, including UTM query strings.
const SITE = "https://sixiangjialaundry.com";

/** Public price for the topic's object family; empty when it is ambiguous. */
function priceLineFor(topic: string): string {
  const families = [/鞋|靴/, /包|袋/, /衣|裝|衫|服/, /被|床|寢|毯|枕/].filter((f) => f.test(topic));
  if (families.length !== 1) return "";
  if (/白鞋|球鞋|運動鞋|帆布/.test(topic)) return "參考價:一般運動鞋 $250、皮類運動鞋 $300(水洗價)";
  if (/皮鞋|靴/.test(topic)) return "參考價:皮鞋 $400、低靴 $350、高靴 $550(水洗價)";
  if (/書包|背包/.test(topic)) return "參考價:背包 $500(水洗價)";
  if (/包|袋/.test(topic)) return "參考價:一般包 $600、皮包 $1000、名牌包 $1500(水洗價)";
  if (/皮衣/.test(topic)) return "參考價:皮衣 $1200、特殊皮衣 $2000";
  if (/襯衫|制服/.test(topic)) return "參考價:襯衫 $70、整燙 $50(水洗價)";
  if (/西裝|大衣|外套/.test(topic)) return "參考價:長大衣 $300、羽絨外套 $280(水洗價,乾洗另計)";
  if (/被|床|寢|毯|枕/.test(topic)) return "參考價:棉被單人 $350、雙人 $500、羽絨羊毛被 $800(水洗價)";
  return "";
}

/** Deep link to the page that answers this topic, not the site root. */
export function guideLinkFor(topic: string): string {
  if (/白鞋|泛黃/.test(topic)) return `${SITE}/guides/white-shoe-yellowing.html`;
  if (/雨|淋濕|進水/.test(topic)) return `${SITE}/guides/rainy-shoe-care.html`;
  if (/鞋|靴/.test(topic)) return `${SITE}/services/white-shoe-cleaning.html`;
  if (/行李箱|行李/.test(topic)) return `${SITE}/guides/bag-handle-cleaning.html`;
  if (/包|提把|包角|背包/.test(topic)) return `${SITE}/guides/bag-handle-cleaning.html`;
  if (/皮衣|皮革|發霉/.test(topic)) return `${SITE}/guides/leather-jacket-care.html`;
  if (/羽絨/.test(topic)) return `${SITE}/guides/down-jacket-cleaning.html`;
  if (/西裝|襯衫|肩線|領口/.test(topic)) return `${SITE}/guides/shirt-suit-dry-cleaning.html`;
  if (/棉被|寢具|床組|被單|枕/.test(topic)) return `${SITE}/guides/bedding-duvet-cleaning.html`;
  if (/窗簾|沙發|布品|收納/.test(topic)) return `${SITE}/services/fabric-storage.html`;
  if (/娃娃|絨毛|玩偶/.test(topic)) return `${SITE}/guides/plush-doll-cleaning.html`;
  if (/乾洗/.test(topic)) return `${SITE}/guides/dry-cleaning-guide.html`;
  return `${SITE}/services/taichung-xitun-laundry.html`;
}

function topicObject(topic: string): string {
  const match = topic.match(/^[^，,。:：]{2,8}/);
  return match ? match[0] : "衣物";
}

function youtubeLogSha(entry: YouTubeLogEntry): string | undefined {
  const sha = entry.video_sha256?.trim().toLowerCase();
  return sha || undefined;
}

function normalizeYoutubeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

export async function fetchYoutubeOembedTitle(
  videoId: string,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { title?: unknown };
    return typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function scheduledPublishDue(entry: YouTubeLogEntry, now: Date): boolean {
  if (!entry.scheduled_publish_at) return false;
  const at = Date.parse(entry.scheduled_publish_at);
  return !Number.isNaN(at) && at <= now.getTime();
}

export async function uploadShort(input: {
  date: string;
  slot?: number;
  root?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<YouTubeLogEntry | { skipped: string }> {
  const root = projectRoot(input.root);
  const slotNumber = input.slot ?? 2;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();

  const logPath = join(root, "data", "youtube-log", `${input.date}.json`);
  const existing = await readJsonFile<YouTubeLogEntry[]>(logPath, []);

  // YouTube is a secondary shelf: never upload a Short before the same date+slot
  // Reel is live on Instagram. Dry-run and non-reel Meta posts do not open the gate.
  const posted = await loadPostLog(input.date, root);
  const igLiveReel = posted.find(
    (entry) =>
      entry.slot === slotNumber &&
      entry.platform === "instagram" &&
      !entry.dry_run &&
      (entry.status === "success" || entry.status === "posted") &&
      entry.published_media_type === "reel"
  );
  if (!igLiveReel) {
    return {
      skipped: `no IG live reel for ${input.date} slot ${slotNumber}; YouTube waits for Instagram`
    };
  }

  const content = await loadDailyContent(input.date, root);
  const postedPackage = await loadPostedPackage(input.date, root);
  const postedPkgSlot = postedPackage?.slots.find((item) => item.slot === slotNumber);
  const slot = postedPkgSlot ?? content?.slots.find((item) => item.slot === slotNumber);
  if (!slot?.local_video_path) {
    return { skipped: `no video in ${input.date} slot ${slotNumber}` };
  }

  const topic = igLiveReel.topic || postedPkgSlot?.topic || slot.topic;
  const { title, description } = buildShortMetadata({
    topic,
    caption: slot.instagram_caption ?? "",
    date: input.date,
    slot: slotNumber
  });

  const video = await readFile(join(root, ...slot.local_video_path.split("/")));
  const fileSha = createHash("sha256").update(video).digest("hex");
  const postedSha = igLiveReel.video_sha256?.trim().toLowerCase();
  if (postedSha && postedSha !== fileSha) {
    return {
      skipped: `on-disk video sha does not match posted-log reel for ${input.date} slot ${slotNumber}`
    };
  }
  const liveSha = postedSha || fileSha;

  const slotEntries = existing.filter((entry) => entry.slot === slotNumber);
  const sameSha = slotEntries.find((entry) => youtubeLogSha(entry) === liveSha);
  if (sameSha) {
    return { skipped: `already uploaded for ${input.date} slot ${slotNumber}` };
  }

  let logChanged = false;
  for (const entry of slotEntries) {
    const oembedTitle = await fetchYoutubeOembedTitle(entry.video_id, fetchImpl);
    if (scheduledPublishDue(entry, now) && oembedTitle && entry.video_status === "scheduled") {
      entry.video_status = "public";
      logChanged = true;
    }
    if (oembedTitle && normalizeYoutubeTitle(oembedTitle) === normalizeYoutubeTitle(title)) {
      if (logChanged) await writeJsonAtomic(logPath, existing);
      return { skipped: `already live on YouTube for ${input.date} slot ${slotNumber}` };
    }
  }
  if (logChanged) await writeJsonAtomic(logPath, existing);

  if (!credentials()) {
    return { skipped: "credentials not configured; run npm run youtube-auth" };
  }

  const metadata = {
    snippet: { title, description, categoryId: "22", defaultLanguage: "zh-Hant" },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
      // Generated footage is declared as altered content, the same honesty the
      // image pipeline keeps with C2PA. Never strip this to dodge the label.
      containsSyntheticMedia: true
    }
  };

  const videoId = await postShortMultipart(metadata, video, fetchImpl);

  const abVariant = planSlot(planForDate(await loadAbTestPlan(root), input.date), slotNumber)?.variant;
  const entry: YouTubeLogEntry = {
    date: input.date,
    slot: slotNumber,
    video_id: videoId,
    title,
    uploaded_at: new Date().toISOString(),
    video_status: "public",
    video_sha256: liveSha,
    ...(abVariant ? { ab_variant: abVariant } : {})
  };
  await writeJsonAtomic(logPath, [...existing, entry]);
  return entry;
}

// R1: D+3 wrapper path. Does not replace uploadShort (P1 live fallback).
export async function scheduleYouTubeShort(input: {
  date: string;
  slot: number;
  root?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{
  status: "scheduled" | "skipped";
  reason?: string;
  video_id?: string;
  scheduled_publish_at?: string;
}> {
  const root = projectRoot(input.root);
  const slotNumber = input.slot;
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();

  // R4: one log covers live uploads and ahead schedules; never hit the network.
  const logPath = join(root, "data", "youtube-log", `${input.date}.json`);
  const existing = await readJsonFile<YouTubeLogEntry[]>(logPath, []);
  if (existing.some((entry) => entry.slot === slotNumber)) {
    return skipped("already uploaded or scheduled");
  }

  // R3 ① calendar has this slot as reel or mixed-carousel.
  let content;
  try {
    content = await loadDailyContent(input.date, root);
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  }
  if (!content) {
    return skipped(`no content calendar for ${input.date}`);
  }
  const slot = content.slots.find((item) => item.slot === slotNumber);
  if (!slot) {
    return skipped(`no slot ${slotNumber} in ${input.date} calendar`);
  }
  if (slot.media_type !== "reel" && slot.media_type !== "mixed-carousel") {
    return skipped(
      `slot ${slotNumber} media_type is ${slot.media_type ?? "missing"}, not reel or mixed-carousel`
    );
  }

  // R3 ② local_video_path present and the file is on disk.
  if (!slot.local_video_path) {
    return skipped(`no video in ${input.date} slot ${slotNumber}`);
  }
  const videoPath = join(root, ...slot.local_video_path.split("/"));
  if (!existsSync(videoPath)) {
    return skipped(`video file missing: ${slot.local_video_path}`);
  }

  // R3 ③ P2: same publishable-approval test scheduleAhead uses, both platforms.
  const approvals = await loadApprovalLog(input.date, root);
  if (
    !hasPublishableApproval(approvals, slotNumber, "facebook") ||
    !hasPublishableApproval(approvals, slotNumber, "instagram")
  ) {
    return skipped("no publishable approval for both platforms");
  }

  // R5 / P3 / P5: calendar slot time as Taipei, plus 45 minutes, RFC3339 UTC.
  const slotUnix = taipeiSlotUnix(input.date, slot.time);
  if (!slot.time || Number.isNaN(slotUnix)) {
    return skipped(`invalid slot time ${slot.time ?? "missing"}`);
  }
  const publishAtUnix = slotUnix + 45 * 60;
  const scheduledPublishAt = rfc3339Utc(publishAtUnix);
  const secondsOut = publishAtUnix - Math.floor(now.getTime() / 1000);
  if (secondsOut < 15 * 60) {
    return skipped("publishAt too close; live path owns it");
  }
  if (secondsOut > 30 * 24 * 3600) {
    return skipped("beyond D+30 window");
  }

  // R3 ④ sha and prompt_hash must both match; catch so a failed gate never uploads.
  try {
    await assertVideoReviewApproved({
      date: input.date,
      slot: slotNumber,
      videoPath: slot.local_video_path,
      videoPrompt: slot.video_prompt ?? "",
      root
    });
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error));
  }

  if (!credentials()) {
    return skipped("credentials not configured; run npm run youtube-auth");
  }

  const video = await readFile(videoPath);
  const videoSha256 = createHash("sha256").update(video).digest("hex");
  const { title, description } = buildShortMetadata({
    topic: slot.topic,
    caption: slot.instagram_caption ?? "",
    date: input.date,
    slot: slotNumber
  });

  // R2: private + publishAt; keep the synthetic-media declaration the live path sends.
  const metadata = {
    snippet: { title, description, categoryId: "22", defaultLanguage: "zh-Hant" },
    status: {
      privacyStatus: "private",
      publishAt: scheduledPublishAt,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true
    }
  };

  const videoId = await postShortMultipart(metadata, video, fetchImpl);
  const abVariant = planSlot(planForDate(await loadAbTestPlan(root), input.date), slotNumber)?.variant;
  const entry: YouTubeLogEntry = {
    date: input.date,
    slot: slotNumber,
    video_id: videoId,
    title,
    uploaded_at: new Date().toISOString(),
    scheduled_publish_at: scheduledPublishAt,
    video_status: "scheduled",
    video_sha256: videoSha256,
    ...(abVariant ? { ab_variant: abVariant } : {})
  };
  await writeJsonAtomic(logPath, [...existing, entry]);
  return {
    status: "scheduled",
    video_id: videoId,
    scheduled_publish_at: scheduledPublishAt
  };
}

/**
 * One-time OAuth consent. Runs a loopback listener, opens the consent URL,
 * exchanges the code and writes YT_REFRESH_TOKEN into .env directly — the
 * token never appears on stdout.
 */
async function runAuthFlow(root: string): Promise<void> {
  const clientId = process.env.YT_CLIENT_ID;
  const clientSecret = process.env.YT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Put YT_CLIENT_ID and YT_CLIENT_SECRET into .env first (Google Cloud Console -> OAuth client, type Desktop app, YouTube Data API v3 enabled)."
    );
  }

  const { code, port } = await new Promise<{ code: string; port: number }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const received = url.searchParams.get("code");
      response.end(received ? "授權完成，可以關閉這個分頁。" : "missing code");
      if (received) {
        const address = server.address();
        const boundPort = typeof address === "object" && address ? address.port : 0;
        server.close();
        resolve({ code: received, port: boundPort });
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      consent.searchParams.set("client_id", clientId);
      consent.searchParams.set("redirect_uri", `http://127.0.0.1:${port}`);
      consent.searchParams.set("response_type", "code");
      consent.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload");
      consent.searchParams.set("access_type", "offline");
      consent.searchParams.set("prompt", "consent");
      console.log("\n請用瀏覽器開啟以下網址完成授權：\n");
      console.log(consent.toString());
      console.log("\n(等待授權中……)");
    });
    setTimeout(() => reject(new Error("Authorization timed out after 10 minutes.")), 600_000).unref();
  });

  const exchange = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}`
    })
  });
  const tokens = (await exchange.json()) as { refresh_token?: string; error_description?: string };
  if (!exchange.ok || !tokens.refresh_token) {
    throw new Error(`Token exchange failed: ${tokens.error_description ?? exchange.status}`);
  }

  // The token goes straight into .env; it is never printed.
  const envPath = join(root, ".env");
  const env = await readFile(envPath, "utf8");
  const line = `YT_REFRESH_TOKEN=${tokens.refresh_token}`;
  const next = env.includes("YT_REFRESH_TOKEN=")
    ? env.replace(/YT_REFRESH_TOKEN=[^\r\n]*/, line)
    : `${env.trimEnd()}\n${line}\n`;
  await writeFile(envPath, next, "utf8");
  console.log("授權完成，refresh token 已寫入 .env(未顯示)。之後每天的 Reel 會自動上傳 YouTube。");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "auth")) {
    await runAuthFlow(root);
    return;
  }

  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const slot = getNumberOption(args, "slot") ?? 2;
  // R6: --schedule-ahead takes the new path; omitting it leaves live uploadShort.
  const result = getFlag(args, "schedule-ahead")
    ? await scheduleYouTubeShort({ date, slot, root })
    : await uploadShort({ date, slot, root });
  console.log(JSON.stringify(result, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
