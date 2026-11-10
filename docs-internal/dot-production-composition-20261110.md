# dot: production composition and sitemap drift repair

## Original defect

The release publisher's isolated generator test compared its 145 non-post URLs with a 213-URL live non-post sitemap. Production actually overlays laundry main and renders journal months. Exact investigation: release 145; main overlay 208; the real journal renderer adds July–November 2026, yielding 213. All 68 live-only vs release paths have real HTML in main overlay. No missing page was invented and no live fixture was expanded merely to turn CI green.

## Change and safeguards

- Preserve release's exact generated URL set against its own checked-in override sitemap, 145 count, byte comparisons, noindex exclusions, uniqueness and dates.
- Move live equality to an independent required CI job, not behind Vitest. Checkout actual production main overlay and root merger, recording resolved commit SHAs. Sources missing or network failure remain errors.
- Copy checked-in publisher output into a temporary directory, run real snapshot, generated-owned overlay exclusions, merge, journal rendering, verify, then strict v4 shell. Never write to source checkouts or deploy.
- Preserve generated-owned post/RSS/feed bytes before the design shell and original AI sitemap URL entries. Check every final sitemap target exists, has exactly its own canonical and no robots/googlebot noindex. Recheck after strict shell.
- Exact composed/live non-post set equality remains required. Both live and composed outputs require the posts hub plus 1–30 articles. Rotating article membership can differ between the pinned publisher snapshot and live, just as in the original gate.
- Record live retrieval time and SHA-256. Do not update fixtures or auto-sync content on drift. Inspect publisher/main/root commit provenance instead.

## Verification

- 13 Python negative/control tests passed: missing overlay/month, duplicate sitemap, equal-count wrong URL, foreign canonical, noindex, lost posts hub/articles, stale generated-owned overwrite and missing feed.
- Focused original generator override test passed with exact 145-set comparison.
- TypeScript noEmit passed.
- Full Linux Vitest: 2053 passed, 39 failed, 54 skipped. These remaining failures are Windows/PowerShell/media environment cases already recorded in the parent CI repair; this is not a full green claim. Exact Windows CI for this commit must still be checked.
- Full CLI actual composition plus strict shell passed: 244 final URLs (213 non-post + 31 post), exact live non-post parity, all target/canonical/indexability checks. Main overlay commit cd4d02b0b52df7bdcf130c39a63c10784969f6e8; root main 9a30b5a31ca99760b19a93bda26c6a609e9823c5; publisher base #317 7e15a01ce481afba464d761c289a32de76299e32. Live sitemap SHA-256 a7c5b59a5599ef72d0da8e97ab19b1ac3c420948cd556a03d90e87cf09f0edfb, fetched during this 2026-11-10 validation.
- Separately rendered all 269 public articles through the #317 candidate generator and combined #315 homepage overlay + #58 root scripts with main's remaining files. Exact sitemap snapshot parity and the same complete merge/strict-shell checks passed with 244 URLs. This is an integration test, not browser visual QA or proof of Google indexing.
- Independent review identified that a same-job post-Vitest gate could be skipped. Fixed by creating an independent job, and re-review confirmed the warning gap was closed.

## Local reproduction and integration order

Use a normal publisher checkout with docs present, a sparse clone of laundry main with seo-overrides, and a sparse root-site clone with .github/scripts. Python 3.12 and Node 22 are enough for the composition checker; it does not need npm packages.

    python -m unittest discover -s scripts -p test_production_composition.py
    python scripts/check-production-composition.py --generated-root docs --overlay-repo PATH_TO_LAUNDRY_MAIN --root-repo PATH_TO_ROOT_SITE

This draft stacks on #317, which stacks on #316. Related homepage fixes remain #315 and root #58. Merging a release-generator PR alone does not regenerate production: Pages consumes existing root artifacts plus laundry main overlay. An authorized publish must use real approved source records and correct refs, regenerate/mirror artifacts, then pass these gates. No merge, deployment, paid action, social publication or indexing submission was performed here.
