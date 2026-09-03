# Index-growth 100 milestone gate — 2026-08-31

## Current arithmetic (live evidence)

- Live sitemap: **32 unique URLs**.
- GSC: **26 indexed**, **6 discovered - currently not indexed**.
- Isolated first batch: **24 candidate guides**; generated sitemap is 56 unique URLs, but those 24 URLs are currently live 404 and therefore do not count toward the live milestone.
- `clothing-mold-airing` is currently held as **draft** by the safety review. Therefore the conservative deployable ceiling is **23 candidates / 55 live URLs** until that page passes its safety rewrite; only a fully accepted batch could reach 56.
- If all 24 candidates pass production review and deploy, the live sitemap target becomes **56**, not 100. A further **44 distinct, evidence-backed pages** is then required before a 100-URL sitemap claim is possible; if the safety draft remains excluded, the gap is **45**.

## Release shape

Do not publish 44 pages in one unreviewed dump. Use four cohorts of up to 11 pages, with each cohort having one primary intent family and a separate evidence packet:

1. material/problem decisions (shoes and bags);
2. garment care and storage decisions;
3. bedding and household textile decisions;
4. B2B workflow and service-selection decisions.

Each page must earn a slot with a distinct user job, first-party or traceable source evidence, claim-level provenance, a real content revision, a safety review where relevant, and contextual links to an existing service or guide. City-name substitution alone is a rejection. No page is counted merely because a file, sitemap entry, HTTP 200, or IndexNow response exists.

## Measurement gate per cohort

Record the baseline before release and compare the same cohort at day 7 and day 28:

- GSC impressions, clicks, CTR, average position, and indexed/discovered state;
- GA4 sessions and engaged sessions;
- AI referral sessions when measured;
- LINE click events;
- live sitemap URL count and HTTP/canonical/schema audit.

Keep unavailable values as `null` or `unmeasured`. Verdict remains `PENDING` until the predeclared rule is met. `ADOPT` requires the 28-day rule; `RETEST` is allowed only when the 7-day signal is directionally useful but underpowered; `REJECT` requires a failed rule or a quality/safety regression.

## First cohort priority from observed demand

The strongest non-brand first-party signals currently available are `勃肯鞋會臭嗎`, `娃娃送洗台中`, and `絨毛娃娃清洗店`. Use them to prioritize materially different shoe-odor and plush-doll decision content, while keeping the existing indexed pages as controls. The sample is too small to infer market volume; it only sets test order.

## Go / no-go

`GO` only after PR #30's production exact-host, single resolver/count authority, immutable claim provenance, real revision/cohort/hash, and clothing-mold safety gaps are fixed and independently reviewed. Then deploy HTML/SEO output, verify the live sitemap, and inspect representative URLs in GSC. Until that evidence exists, the 100-page milestone is **not achieved** and 150/200 planning stays intentionally deferred.
