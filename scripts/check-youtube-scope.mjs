// Answer one question before 14:00: can this refresh token actually upload a video?
//
// The 2026-09-15 publish audit filed the upload scope as NOT DETERMINED. The last
// successful upload was 2026-09-09 and videos.list has been returning 403
// "insufficient scopes" since 2026-09-05, which is consistent with a token that
// carries only the readonly/analytics scopes. Finding that out at 14:00, mid-publish,
// is the worst possible time, so this asks Google directly.
//
// It refreshes the token and reads tokeninfo. It never uploads, never prints the
// token, and never writes anything.
//
// Usage: node scripts/check-youtube-scope.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// .env is not exported into this process; read the three names we need, values never printed.
const env = {};
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const need = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.log("MISSING:", missing.join(", "));
  console.log("VERDICT: cannot upload - credentials incomplete");
  process.exit(1);
}

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: env.YT_CLIENT_ID,
    client_secret: env.YT_CLIENT_SECRET,
    refresh_token: env.YT_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const payload = await res.json();
if (!res.ok || !payload.access_token) {
  console.log(`TOKEN REFRESH FAILED: HTTP ${res.status} ${payload.error ?? ""} ${payload.error_description ?? ""}`);
  console.log("VERDICT: cannot upload - refresh token is dead, re-run npm run youtube-auth");
  process.exit(1);
}
console.log(`token refresh: OK (expires in ${payload.expires_in}s)`);

// The refresh response often carries the granted scopes; tokeninfo is authoritative.
const info = await fetch(
  `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(payload.access_token)}`
).then((r) => r.json());

const scopes = String(info.scope ?? payload.scope ?? "").split(/\s+/).filter(Boolean);
console.log("granted scopes:");
for (const s of scopes) console.log("  -", s);

const UPLOAD = "https://www.googleapis.com/auth/youtube.upload";
const FULL = "https://www.googleapis.com/auth/youtube";
const canUpload = scopes.includes(UPLOAD) || scopes.includes(FULL);

console.log();
if (canUpload) {
  console.log(`VERDICT: CAN upload (${scopes.includes(UPLOAD) ? "youtube.upload" : "youtube"} is granted)`);
} else {
  console.log("VERDICT: CANNOT upload - neither youtube.upload nor youtube is granted.");
  console.log("         The owner must re-authorise with the upload scope before any Short can be posted.");
}
process.exit(canUpload ? 0 : 2);
