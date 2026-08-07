import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

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

/** Title and description come from the day's own copy, not a new voice. */
export function buildShortMetadata(input: { topic: string; caption: string }): {
  title: string;
  description: string;
} {
  // YouTube titles cap at 100 characters; the hook is already short. #Shorts
  // in title or description is what routes the upload into the Shorts shelf.
  // The geo suffix is what YouTube/Google video search matches for "台中洗鞋"
  // queries — the bare hook alone carries no locality at all.
  const geoSuffix = /[鞋包靴]/.test(input.topic) ? "台中洗鞋洗包 免費收送" : "台中洗衣店 免費收送";
  const title = `${input.topic}`.slice(0, 70) + `｜${geoSuffix} #Shorts`;
  const description = [
    input.caption.split("\n\n").slice(0, 3).join("\n\n"),
    "台中市全區免費到府收送｜私享家洗衣店(西屯青海路二段365號)",
    "LINE 傳照片先估:0968327653",
    "服務與案例:https://39211.github.io/",
    "#Shorts #台中洗衣店 #台中洗鞋 #西屯洗鞋 #逢甲洗鞋 #洗包"
  ].join("\n\n");
  return { title, description };
}

export async function uploadShort(input: {
  date: string;
  slot?: number;
  root?: string;
  fetchImpl?: typeof fetch;
}): Promise<YouTubeLogEntry | { skipped: string }> {
  const root = projectRoot(input.root);
  const slotNumber = input.slot ?? 2;
  const fetchImpl = input.fetchImpl ?? fetch;

  const logPath = join(root, "data", "youtube-log", `${input.date}.json`);
  const existing = await readJsonFile<YouTubeLogEntry[]>(logPath, []);
  if (existing.some((entry) => entry.slot === slotNumber)) {
    return { skipped: `already uploaded for ${input.date} slot ${slotNumber}` };
  }

  // YouTube is a secondary shelf: never upload a Short before the same date+slot
  // Reel is live on Instagram. Dry-run and non-reel Meta posts do not open the gate.
  const posted = await loadPostLog(input.date, root);
  const igLiveReel = posted.some(
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

  if (!credentials()) {
    return { skipped: "credentials not configured; run npm run youtube-auth" };
  }

  const content = await loadDailyContent(input.date, root);
  const slot = content?.slots.find((item) => item.slot === slotNumber);
  if (!slot?.local_video_path) {
    return { skipped: `no video in ${input.date} slot ${slotNumber}` };
  }

  const video = await readFile(join(root, ...slot.local_video_path.split("/")));
  const { title, description } = buildShortMetadata({
    topic: slot.topic,
    caption: slot.instagram_caption ?? ""
  });

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

  const abVariant = planSlot(planForDate(await loadAbTestPlan(root), input.date), slotNumber)?.variant;
  const entry: YouTubeLogEntry = {
    date: input.date,
    slot: slotNumber,
    video_id: payload.id,
    title,
    uploaded_at: new Date().toISOString(),
    ...(abVariant ? { ab_variant: abVariant } : {})
  };
  await writeJsonAtomic(logPath, [...existing, entry]);
  return entry;
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
  const result = await uploadShort({ date, slot, root });
  console.log(JSON.stringify(result, null, 2));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
