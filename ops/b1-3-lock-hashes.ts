// B1-3 helper (commander, 2026-10-31): recompute protected content hashes after the owner-approved
// wording change (D15). Prints only slugs whose current hash differs from the frozen value.
// Run: npx tsx ops/b1-3-lock-hashes.ts [--cohort]   (needs PUBLIC_SITE_BASE_URL set, like the tests)
// Index-growth locks first (generatePublicSite fails closed at import while they mismatch), then --cohort.
import {
  INDEX_GROWTH_CATALOG,
  PROTECTED_INDEX_GROWTH_LOCKS,
  PROTECTED_LIVE_COHORT_HASHES,
  PROTECTED_LIVE_COHORT_SLUGS,
  protectedSupportContentHash
} from "../src/indexGrowthPages";

const changed: Record<string, { kind: string; old: string; now: string }> = {};
for (const page of INDEX_GROWTH_CATALOG) {
  const lock = PROTECTED_INDEX_GROWTH_LOCKS[page.slug];
  if (!lock) continue;
  const now = protectedSupportContentHash(page);
  if (now !== lock.body_hash) changed[page.slug] = { kind: "index-growth", old: lock.body_hash, now };
}
if (process.argv.includes("--cohort")) {
  const { publicSupportPages } = await import("../src/generatePublicSite");
  const pages = publicSupportPages();
  for (const slug of PROTECTED_LIVE_COHORT_SLUGS) {
    const page = pages.find((item) => item.slug === slug);
    if (!page) throw new Error(`missing ${slug}`);
    const now = protectedSupportContentHash(page);
    if (now !== PROTECTED_LIVE_COHORT_HASHES[slug]) changed[slug] = { kind: "live-cohort", old: PROTECTED_LIVE_COHORT_HASHES[slug], now };
  }
}
console.log(JSON.stringify(changed, null, 1));
