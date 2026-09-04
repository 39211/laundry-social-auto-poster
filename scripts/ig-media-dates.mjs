// Three-source publish verification, source 3: platform truth via the Instagram
// Graph API. Lists the account's recent media grouped by Taipei date so a
// posted-log entry can be checked against what actually exists on Instagram.
//
//   node scripts/ig-media-dates.mjs          (reads META_ACCESS_TOKEN / IG_USER_ID from ./.env)
//
// Prints one line per day: "YYYY-MM-DD | HH:MM:SS TYPE caption || ...". A day
// with no line has nothing on the platform, whatever the local ledger says.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const token = process.env.META_ACCESS_TOKEN || env.META_ACCESS_TOKEN;
const ig = process.env.IG_USER_ID || env.IG_USER_ID;
const version = env.META_GRAPH_API_VERSION || "v21.0";
if (!token || !ig) throw new Error("META_ACCESS_TOKEN / IG_USER_ID missing");
const url = `https://graph.facebook.com/${version}/${ig}/media?fields=id,timestamp,media_type,permalink,caption&limit=25&access_token=${token}`;
const res = await fetch(url);
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 300));
const byDay = {};
for (const m of body.data ?? []) {
  const taipei = new Date(new Date(m.timestamp).getTime() + 8 * 3600 * 1000);
  const day = taipei.toISOString().slice(0, 10);
  const time = taipei.toISOString().slice(11, 19);
  (byDay[day] ??= []).push(`${time} ${m.media_type} ${(m.caption ?? "").split("\n")[0].slice(0, 30)}`);
}
for (const day of Object.keys(byDay).sort()) console.log(`${day} | ${byDay[day].join(" || ")}`);
