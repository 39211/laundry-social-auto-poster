import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";

// Reports how the 90-day plan is distributed across the routes that decide what
// a post looks like and where it sends the reader. A route that dominates is a
// route the account is betting on without having decided to.

const config = getConfig();
const rows: Array<Record<string, string>> = [];
for (let offset = 0; offset < 90; offset += 1) {
  const date = new Date(Date.UTC(2026, 6, 11 + offset)).toISOString().slice(0, 10);
  for (const slot of buildDailyContent(date, config).slots) {
    rows.push({
      visual: slot.visual_route ?? "(none)",
      traffic: slot.traffic_route ?? "(none)",
      role: slot.content_role ?? "(none)",
      media: slot.media_type ?? "(none)",
      page: slot.seo_sync_page ?? "(none)"
    });
  }
}

console.log(`total slots: ${rows.length}`);
for (const key of ["visual", "traffic", "role", "media", "page"]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key] ?? "", (counts.get(row[key] ?? "") ?? 0) + 1);
  console.log(`\n--- ${key} ---`);
  for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const share = ((count / rows.length) * 100).toFixed(1);
    console.log(`  ${String(count).padStart(4)}  ${share.padStart(5)}%  ${name}`);
  }
}
