# PR #74 independent SEO / AEO / GEO / GA4 audit — 2026-09-07

## Verdict and boundary

PR #74 improves intake wording and contextual price/pickup links on four shoe guides. It is not evidence that indexing, search exposure, AI citations, enquiries, or revenue improved. Its merge commit is `aa3fdd435887879c341cb7fb2a1c23864ebc9397`; this follow-up starts from `2262458ccdfa547dffa09be607e3babf5ee8631f` on `hermes/seo-luxury-question-titles`, which is two commits ahead. The analytics defects below are inherited issues, not changes introduced by #74.

This branch changes one source module plus isolated tests and this report. It does not change generated public HTML/JS, business claims, prices, photos, accepted-content locks, sitemaps, publishing semantics, OAuth credentials, production settings, or social posts. No deployment or merge is authorized by a green test result.

## Executed verification

The original `src/searchContentAnalytics.ts` was read through GitHub and reconstructed locally with exact Git blob identity `987a967464141f1196331e918afda5b9a9c576f6`. The modified source blob is `eb4021660aa4dd84acbdbf361b272432e75c0a6d`.

On Node 22.16.0, 30 identical VM/DOM/gtag contract cases produced 18 pass / 12 fail before the patch and 30 pass / 0 fail after it. These 12 failing cases correspond to two root defects, not 12 independent bugs. Two additional mutation cases then verified that removing either repair is rejected: final suite 32 pass / 0 fail. Standalone strict TypeScript checking of the changed source module passed. The command used by the new Vitest wrapper also passed locally.

Reproduce the candidate with a current Node 22 version supporting the transform-types flag:

```sh
node --experimental-transform-types --test scripts/verify-search-content-analytics.mjs
npm run typecheck
npx vitest run test/searchContentAnalyticsContract.test.ts test/shoeGuideIntake.test.ts test/publicSite.test.ts test/indexGrowthPages.test.ts
npm test
```

Only the first command and the isolated changed-module typecheck were executed locally. The full repository installation, full-project typecheck, Vitest suite, and real-browser GA4 ingestion were not rerun in the audit container: external downloads were blocked. PR #74's existing GitHub CI run `34082049724` was inspected and reported success; that is a different run, not validation of this branch. Check this branch's own CI separately.

All local runtime tests use a mocked DOM and gtag. They send no network requests and create no production GA4 events.

## Fixed in this branch

1. `view_item` previously used flat `item_id`, `item_name`, and `item_category` parameters. They now appear inside the required `items` array. No price, currency, revenue, or value is invented; `view_service` remains unchanged.
2. Navigation classification previously matched only URL pathnames. External sites with `/services/...html`, `/guides/...html`, `/local/...html`, or `/go/line.html` could be recorded as the site's own funnel steps. It now requires the same origin. Existing relative/absolute internal routes and telephone events remain covered.

The existing runtime guard is strengthened for both defects. Source-page clicks still cannot emit canonical `line_click` or confirmed `generate_lead`. These repairs do not prove that production analytics were previously polluted; they establish reproducible weaknesses in the code's input handling.

## Separately reproduced, NOT fixed here

The complete `src/ga4AiTraffic.ts` blob `c3acd532b9056363a4de12aa2cf680de46d4bd52` was reconstructed and hash-verified. Exact reader/classifier function bodies were extracted, TypeScript-erased, and executed with injected fake responses. This is source-level isolated verification, not full-module integration or a live GA4 API test.

| Probe | Observed result | Required follow-up |
|---|---|---|
| 201 available rows, API returns pages of 200 | Only 200 returned; one request | Implement offset/rowCount pagination, bounded termination and completeness checks |
| HTTP 503 with JSON message but no Google-shaped `error` object | Resolves to empty rows | Reject unsuccessful HTTP/invalid payloads; never record an error as measured zero |
| `chat.deepseek.com` / `ai-assistant` | Classified as `other` | Support current native AI medium/channel; preserve historical source classification |
| `google` / missing medium | Classified as `google_organic` | Treat unknown medium as unknown/other rather than evidence of organic acquisition |

The landing-page query also omits sessionMedium, so the native AI classification fix must cover both source totals and landing-page detail. Do not claim a 200-row cap caused today's low traffic without the actual property data. API completeness, metadata/threshold flags, malformed metrics, explicit dates/time zones, and summary consumers need integration tests before changing this report contract.

## Website and measurement observations

A retrieved homepage representation exposes internal SEO process text to customers, including wording about pages being in the process of indexing and linking from indexed pages. Move implementation/audit explanations to internal documentation. Replace them with customer-facing decisions: suitability, inspection boundaries, actual pricing basis, pickup procedure and real work evidence. Do not infer a Google penalty or Core Web Vitals failure from this observation.

Direct fetches of the four live guide pages, robots.txt and sitemap.xml did not produce reliable current responses in this environment. Tool `Internal Error` is not evidence that the website returns an error. The intended eight-file production mirror and the current guide deployment remain unverified here.

Historical repository reports are small and stale: the 2026-09-02 GSC report describes a 2026-08-29 snapshot with 9 impressions and 0 clicks; the 2026-08-31 GA4 baseline describes Aug 26–30 with 42 sessions and 1 Google-organic session. These are not today's figures. This session did not obtain live GSC/GA4 property data. Missing LINE events, missing reports and unavailable values must not be relabelled as zero.

## Updated official guidance that changes the plan

- Google Search explicitly ignores llms.txt and similar AI-specific files for visibility/ranking. Keep existing files if other consumers use them; do not make more AI files the growth priority.
- Google stopped displaying FAQ rich results on 2026-05-07. Visible useful FAQs can remain, but FAQ rich-result work is not a current growth lever.
- GA4 introduced native AI Assistant traffic measurement on 2026-05-13. Its AI Assistants channel excludes Google's AI Overviews/AI Mode, which belong to Organic Search in GA4.
- Google's Generative AI performance report documentation states worldwide rollout as of 2026-08-31. It reports AI impressions, not a complete lead/revenue funnel; low-exposure sites might not show a report. Exported unavailable values can become zeros, so preserve availability metadata.
- The Search generative AI inclusion control is separately rolling out. Check it when present; the default is inclusion, or inheritance for child properties. Do not infer that this site's setting is excluded.
- Bing's AI Performance report provides citation visibility for supported Microsoft surfaces, not the entire AI ecosystem and not proof of visits or sales.
- Google's Indexing API is not a general laundry-guide indexing API; its supported content is JobPosting or BroadcastEvent embedded in VideoObject.

## Prioritized execution plan

First establish a truthful measurement baseline: canonical URL, deployment commit and timestamp, GSC index state, search and AI impressions, source/medium/channel, landing page, CTA event and confirmed enquiry/order. Preserve fetched_at, data_as_of, time zone, completeness and unavailable status. GSC day boundaries and the GA4 property time zone are not automatically identical.

Next inspect the four treatment guides plus their existing parent service, price and pickup pages in URL Inspection; distinguish discovered-not-indexed, crawled-not-indexed, canonical selection, and indexed-with-no-impressions. Fix the diagnosed cause, not all pages indiscriminately. Do not create near-duplicate URLs or mass-delete guides without this evidence.

Concentrate content improvements on existing revenue-intent pages and actual first-hand work: anonymous real before/after photos, material and original condition, process choices, limitations, final result, actual charge/time when approved, and who reviewed the case. AI illustrations are not customer-case evidence. No fabricated reviews, testimonials, prices or service promises.

Strengthen the real local-business profile, accurate service/category/hours/contact details, authentic review collection without incentives or review gating, and relevant local mentions. Do not promise that adding service areas defeats Google's distance factor.

Use a 28-day treatment/control observation window beginning at actual deployment, not merge time. Keep meaningful controls stable, compare the same query/page cohorts and date conventions, and report absolute counts alongside rates. Treat low-volume outcomes as inconclusive. Success is more qualified local enquiries and orders from known sources—not more commits, pages, sitemap submissions, or green tests.

## Primary references checked on 2026-09-07

- Google AI optimization: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google documentation updates / FAQ retirement: https://developers.google.com/search/updates
- GA4 recommended events: https://developers.google.com/analytics/devguides/collection/ga4/reference/events
- GA4 channel definitions: https://support.google.com/analytics/answer/9756891?hl=en-SG
- GA4 release notes: https://support.google.com/analytics/answer/9164320?hl=en-419
- GA4 pagination: https://developers.google.com/analytics/devguides/reporting/data/v1/basics
- GA4 RunReportResponse: https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/RunReportResponse
- GSC Generative AI report: https://support.google.com/webmasters/answer/16984139
- GSC AI inclusion control: https://support.google.com/webmasters/answer/16908024
- Bing AI Performance: https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c
- OpenAI publisher FAQ: https://help.openai.com/en/articles/12627856-publishers-and-developers-faq
- Local ranking guidance: https://support.google.com/business/answer/7091
- Indexing API scope: https://developers.google.com/search/apis/indexing-api/v3/using-api

## Release gate

Draft/review only. Require this branch's full CI, independent review, generated-artifact diff review, mobile-browser event-delivery validation without production test pollution, and explicit bounded deployment before considering the repair live. Neither deployment nor successful telemetry proves search growth.
