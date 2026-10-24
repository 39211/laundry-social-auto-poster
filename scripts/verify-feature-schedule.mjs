// Independently confirm what was actually queued, rather than trusting the
// publisher's own stdout. Reads the Graph API for the Facebook video and the
// YouTube Data API for the Short. Prints no tokens.
//
// Usage: node scripts/verify-feature-schedule.mjs 2026-09-15
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const date = process.argv[2] ?? "2026-09-15";

const env = {};
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const log = JSON.parse(readFileSync(join(root, "data", "feature-posted-log", `${date}.json`), "utf8"));
const row = (p) => log.find((r) => r.platform === p && (r.status === "scheduled" || r.status === "success"));

const fb = row("facebook");
if (!fb) {
  console.log("facebook  NO ROW in the feature log");
} else {
  const v = env.GRAPH_API_VERSION || "v25.0";
  const url =
    `https://graph.facebook.com/${v}/${fb.post_id}` +
    `?fields=id,status,published,scheduled_publish_time,title,description,permalink_url` +
    `&access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.error) {
    console.log(`facebook  HTTP ${r.status} ${j.error.message}`);
  } else {
    // The Graph API takes scheduled_publish_time as unix seconds but hands it BACK
    // as an ISO-8601 string ("2026-09-15T06:00:00+0000"). Comparing the returned
    // value to a unix number therefore always "fails" and says the schedule is
    // wrong when it is right. Parse whichever form arrives.
    const rawAt = j.scheduled_publish_time;
    const n = Number(rawAt);
    const ms = Number.isFinite(n) && n > 0 ? n * 1000 : Date.parse(String(rawAt));
    const at = Number.isFinite(ms) ? new Date(ms).toISOString() : `(unparsable: ${JSON.stringify(rawAt)})`;
    console.log(`facebook  id=${j.id}`);
    console.log(`          published=${j.published}  scheduled_publish_time=${at}`);
    console.log(`          video status=${JSON.stringify(j.status ?? {})}`);
    console.log(`          permalink=${j.permalink_url ?? "(not yet)"}`);
    const expectMs = new Date(`${date}T14:00:00+08:00`).getTime();
    const phase = j.status?.publishing_phase ?? {};
    console.log(
      `          -> time ${ms === expectMs ? "MATCHES" : `DOES NOT MATCH (expected ${new Date(expectMs).toISOString()})`}` +
      `, publish_status=${phase.publish_status ?? "?"}, upload=${j.status?.uploading_phase?.bytes_transferred ?? "?"} bytes` +
      `, copyright_matches=${j.status?.copyright_check_status?.matches_found ?? "?"}`
    );
  }
}

const yt = row("youtube");
if (!yt) {
  console.log("youtube   NO ROW in the feature log");
} else {
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YT_CLIENT_ID,
      client_secret: env.YT_CLIENT_SECRET,
      refresh_token: env.YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  }).then((r) => r.json());
  const r = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${yt.post_id}`,
    { headers: { Authorization: `Bearer ${t.access_token}` } }
  );
  const j = await r.json();
  if (j.error) {
    // The refresh token carries only youtube.upload, so a read is expected to 403.
    // That is not evidence the upload failed - say so plainly instead of guessing.
    console.log(`youtube   id=${yt.post_id}  read-back HTTP ${r.status}: ${j.error.message}`);
    console.log("          this token has only the upload scope, so videos.list cannot confirm it.");
    console.log("          NOT VERIFIED from here - check YouTube Studio for the scheduled Short.");
  } else {
    const v = j.items?.[0];
    console.log(`youtube   id=${yt.post_id}  title=${v?.snippet?.title}`);
    console.log(`          privacyStatus=${v?.status?.privacyStatus}  publishAt=${v?.status?.publishAt}`);
    console.log(`          uploadStatus=${v?.status?.uploadStatus}`);
  }
}
