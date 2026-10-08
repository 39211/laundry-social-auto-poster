// GSC 漏洞報表:Striking Distance / Cannibalization / Low CTR
//
// query+page 兩維度拉 N 天,算出三張表。與外面流傳的版本有兩處刻意不同:
//
// 1. 門檻是相對的,不是寫死 impressions >= 100。這家店 90 天總曝光是四位數,
//    寫死 100 會讓報表永遠是空的,然後人會以為「沒有問題」。門檻改成用實際
//    分布算(預設取該站 impressions 的百分位),並把用了什麼門檻印在報表裡。
// 2. 每張表都附「這個結論站得住嗎」的欄位。單次點擊在 n=1 時的信賴區間橫跨
//    十幾倍,把它當成 CTR 訊號會做出錯誤決策,所以低 CTR 那張表會標出哪些列
//    的樣本數根本不足以判斷。
//
// 用法:
//   node scripts/gsc-gap-report.mjs                 # 預設 90 天
//   node scripts/gsc-gap-report.mjs --days 28
//   node scripts/gsc-gap-report.mjs --start 2026-06-01 --end 2026-08-31

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

// GSC 的資料要 2-3 天才停止變動,所以 endDate 預設退 3 天,和收集器的
// DATA_LAG_DAYS 一致。不退的話最後幾天會低報,看起來像掉了。
const LAG_DAYS = 3;
const dayMs = 86400000;
const today = new Date(`${opt("today", new Date(Date.now() - 0).toISOString().slice(0, 10))}T00:00:00Z`);
const endDate = opt("end", new Date(today.getTime() - LAG_DAYS * dayMs).toISOString().slice(0, 10));
const days = Number(opt("days", 90));
const startDate = opt("start", new Date(new Date(`${endDate}T00:00:00Z`).getTime() - (days - 1) * dayMs).toISOString().slice(0, 10));

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GSC_CLIENT_ID,
      client_secret: env.GSC_CLIENT_SECRET,
      refresh_token: env.GSC_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`token refresh failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function queryAll(token, dimensions) {
  const site = env.GSC_SITE_URL;
  const rows = [];
  // rowLimit caps at 25000 per request; startRow pages past it. This site will
  // never need page two, but a report that silently truncates is worse than a
  // slow one.
  for (let startRow = 0; ; startRow += 25000) {
    const res = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: 25000, startRow })
      }
    );
    const body = await res.json();
    if (!res.ok) throw new Error(`searchAnalytics failed: ${JSON.stringify(body.error ?? body)}`);
    const batch = body.rows ?? [];
    rows.push(...batch);
    if (batch.length < 25000) break;
  }
  return rows;
}

const pct = (arr, p) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};

// Wilson score interval — a CTR built on two clicks is not a CTR. This is what
// stops "position 1, CTR 0%" from being read as a title problem when the whole
// row is one impression.
function wilson(clicks, impressions) {
  if (impressions === 0) return [0, 0];
  const z = 1.96;
  const p = clicks / impressions;
  const d = 1 + (z * z) / impressions;
  const c = p + (z * z) / (2 * impressions);
  const s = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * impressions)) / impressions);
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

const token = await accessToken();
const raw = await queryAll(token, ["query", "page"]);
const df = raw.map((r) => ({
  query: r.keys[0],
  page: r.keys[1],
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position
}));

const impressions = df.map((r) => r.impressions);
const totalImpressions = impressions.reduce((a, b) => a + b, 0);
const totalClicks = df.reduce((a, b) => a + b.clicks, 0);

// Relative thresholds: p75 of this site's own rows, floored at 5 so a quiet
// window cannot produce a report full of single-impression noise.
const STRIKING_MIN_IMPRESSIONS = Math.max(5, pct(impressions, 0.75));
const LOWCTR_MIN_IMPRESSIONS = Math.max(10, pct(impressions, 0.8));

const striking = df
  .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= STRIKING_MIN_IMPRESSIONS)
  .sort((a, b) => b.impressions - a.impressions);

const byQuery = new Map();
for (const r of df) {
  if (!byQuery.has(r.query)) byQuery.set(r.query, []);
  byQuery.get(r.query).push(r);
}
// Real cannibalisation is two pages that both get MEANINGFUL exposure for one
// query. Two rows where the second has a single impression is not a conflict,
// it is Google sampling. Require the runner-up to hold >=20% of the query's
// impressions before calling it.
const cannibal = [];
for (const [query, rowsForQuery] of byQuery) {
  if (rowsForQuery.length < 2) continue;
  const sorted = [...rowsForQuery].sort((a, b) => b.impressions - a.impressions);
  const total = sorted.reduce((a, b) => a + b.impressions, 0);
  const runnerShare = sorted[1].impressions / total;
  if (total < STRIKING_MIN_IMPRESSIONS || runnerShare < 0.2) continue;
  cannibal.push({ query, total_impressions: total, pages: sorted.length, runner_share: runnerShare, rows: sorted });
}
cannibal.sort((a, b) => b.total_impressions - a.total_impressions);

const lowCtr = df
  .filter((r) => r.position <= 5 && r.ctr < 0.03 && r.impressions >= LOWCTR_MIN_IMPRESSIONS)
  .map((r) => {
    const [lo, hi] = wilson(r.clicks, r.impressions);
    return { ...r, ctr_lo: lo, ctr_hi: hi, conclusive: hi < 0.03 };
  })
  .sort((a, b) => b.impressions - a.impressions);

const outDir = join(ROOT, "output", "operations", "gsc-gap-report");
mkdirSync(outDir, { recursive: true });
const stamp = endDate;
const csv = (rows, cols) =>
  [cols.join(","), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");

writeFileSync(join(outDir, `striking-distance-${stamp}.csv`), csv(striking, ["query", "page", "clicks", "impressions", "ctr", "position"]), "utf8");
writeFileSync(join(outDir, `low-ctr-${stamp}.csv`), csv(lowCtr, ["query", "page", "clicks", "impressions", "ctr", "ctr_lo", "ctr_hi", "conclusive", "position"]), "utf8");
writeFileSync(
  join(outDir, `cannibalization-${stamp}.csv`),
  csv(cannibal.flatMap((c) => c.rows.map((r) => ({ ...r, group_total: c.total_impressions, runner_share: c.runner_share }))),
    ["query", "page", "clicks", "impressions", "position", "group_total", "runner_share"]),
  "utf8"
);
writeFileSync(
  join(outDir, `summary-${stamp}.json`),
  JSON.stringify(
    {
      window: { startDate, endDate, days: Math.round((new Date(endDate) - new Date(startDate)) / dayMs) + 1, lag_days: LAG_DAYS },
      totals: { rows: df.length, impressions: totalImpressions, clicks: totalClicks, ctr: totalImpressions ? totalClicks / totalImpressions : 0 },
      thresholds: { striking_min_impressions: STRIKING_MIN_IMPRESSIONS, lowctr_min_impressions: LOWCTR_MIN_IMPRESSIONS, note: "relative to this site's own p75/p80, not a fixed 100" },
      counts: { striking: striking.length, cannibalization_queries: cannibal.length, low_ctr: lowCtr.length, low_ctr_conclusive: lowCtr.filter((r) => r.conclusive).length }
    },
    null,
    2
  ),
  "utf8"
);

console.log(JSON.stringify({
  window: `${startDate} .. ${endDate}`,
  rows: df.length,
  impressions: totalImpressions,
  clicks: totalClicks,
  thresholds: { striking: STRIKING_MIN_IMPRESSIONS, lowCtr: LOWCTR_MIN_IMPRESSIONS },
  striking: striking.length,
  cannibalization: cannibal.length,
  low_ctr: lowCtr.length,
  low_ctr_conclusive: lowCtr.filter((r) => r.conclusive).length,
  out: outDir
}, null, 2));

console.log("\n=== Striking Distance (8-20 名, 曝光 >= 門檻) ===");
for (const r of striking.slice(0, 15)) {
  console.log(`  ${String(Math.round(r.position * 10) / 10).padStart(5)}  imp ${String(r.impressions).padStart(4)}  clk ${String(r.clicks).padStart(3)}  ${r.query}  ->  ${r.page.replace("https://sixiangjialaundry.com", "")}`);
}
console.log("\n=== Cannibalization (同一 query 兩頁以上都拿到有意義曝光) ===");
for (const c of cannibal.slice(0, 10)) {
  console.log(`  ${c.query}  (合計 imp ${c.total_impressions}, 第二名佔 ${Math.round(c.runner_share * 100)}%)`);
  for (const r of c.rows.slice(0, 3)) console.log(`      imp ${String(r.impressions).padStart(4)}  pos ${String(Math.round(r.position * 10) / 10).padStart(5)}  ${r.page.replace("https://sixiangjialaundry.com", "")}`);
}
console.log("\n=== Low CTR (前 5 名但 CTR < 3%) ===");
for (const r of lowCtr.slice(0, 15)) {
  console.log(`  pos ${String(Math.round(r.position * 10) / 10).padStart(4)}  imp ${String(r.impressions).padStart(4)}  clk ${String(r.clicks).padStart(3)}  CTR ${(r.ctr * 100).toFixed(1)}%  ${r.conclusive ? "[樣本足夠]" : "[樣本不足,不可據此改標題]"}  ${r.query}`);
}
