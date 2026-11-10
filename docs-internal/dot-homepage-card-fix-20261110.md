# Homepage card correction by dot — 2026-11-10

## What was wrong
The live R10 homepage uses posts-data.js + r9-core.js, despite retaining the r6-post CSS class. Changing legacy r6.js or a generated index.html alone would not fix both refresh paths. Daily cards selected original multi-megabyte PNGs even though equivalent WebP files already exist.

Five PNG cards observed in the homepage total 12,573,072 repository bytes; their existing WebP counterparts total 770,654 bytes (93.87% less). This is an asset-size comparison, not a measured page-speed, SEO ranking, traffic or conversion improvement. The YouTube thumbnail is unchanged.

## Changes in this repository
- posts-data.js exposes a restricted card-only thumbnail selector for same-site /assets/YYYY-MM-DD/slot-NN.png. Original p.image, feeds, articles, social captions and preview modal media are not replaced.
- r9-core.js cards try WebP, retry original PNG once on missing/unsupported derivative, then retain the existing readable missing-photo fallback.
- editorial_title takes priority over old curated/topic titles when supplied by the article rewrite pipeline. Original published FB/IG captions keep their existing labels and content.

## Verification
Base commit: cd4d02b0b52df7bdcf130c39a63c10784969f6e8.
Focused Vitest: test/r10PostsData.test.ts + test/r10CardImages.test.ts: 5 tests passed. node --check on posts-data.js and r9-core.js passed. Tests cover real adapter load, original media preservation, relative/absolute URLs, curated/remote/signed media, editorial title precedence and two-stage error fallback.

## Scope / handoff
Implemented and recorded by dot at the owner's request. This record describes the code defect and correction, not an attribution of blame to a prior author. This is a draft review branch only: no merge, deployment, IndexNow submission or publishing action was performed. The counterpart repository changes are needed to cover both interactive and no-JS paths. Existing WebP generation is not changed; new slots without derivatives still use original images. Browser visual/performance and production rollout verification have not been performed. Full laundry test/typecheck suite is left to exact-commit CI, not claimed as a local pass.
