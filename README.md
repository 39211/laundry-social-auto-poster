# 私享家洗衣店 Codex Automation

This project generates the daily 私享家洗衣店 social content package for Facebook and Instagram.

The current private-launch baseline is 2 posts per day:

- Slot 1: 11:30 knowledge post
- Slot 2: 19:30 situation post

## Daily Generation

Run with the Asia/Taipei date:

```bash
npm run generate-context -- --date YYYY-MM-DD
npm run generate -- --date YYYY-MM-DD
npm run generate-image-manifest -- --date YYYY-MM-DD
npm run generate-video-candidate-manifest -- --date YYYY-MM-DD
```

Then open `data/image-prompts/YYYY-MM-DD.json`, generate exactly one built-in image per manifest item, and save each final PNG to:

```text
docs/assets/YYYY-MM-DD/slot-XX.png
```

After each image is saved:

```bash
npm run mark-image-source -- --date YYYY-MM-DD --slot X --source gpt-image-2
```

Finish with:

```bash
npm run validate-publishable-images -- --date YYYY-MM-DD
npm run generate-public-site
```

`generate-public-site` only copies approved slots into the public SEO/AIO/GEO feeds. Before `data/approved-log/YYYY-MM-DD.json` exists, generated captions remain private draft content under `data/content-calendar/`.

## Public AI And SEO Feed

The public hosting source is the static `docs/` directory. It can be served by GitHub Pages, Netlify, or any HTTPS static host. `PUBLIC_SITE_BASE_URL` controls the SEO/AIO/GEO canonical site and AI/search entry points. `PUBLIC_ROOT_PAGES_REPO` optionally mirrors the generated `docs/` contents into a root GitHub Pages repository such as `39211/39211.github.io`, so the public site can live at a short URL like `https://39211.github.io/`. `PUBLIC_IMAGE_BASE_URL` controls image asset URLs used by Meta publishing and public image metadata; it can be the same host or a separate image host.

Current rule: use the root GitHub Pages site as the public SEO/AIO/GEO canonical site. The project GitHub Pages path can remain a deployment backup, and Netlify can remain the temporary image asset host until images are moved to GitHub Pages or another stable HTTPS host.

Business identity data is maintained in:

```text
data/business-profile.json
```

Update that file when the store phone, LINE URL, opening hours, holiday-hour overrides, map IDs, or social links change. Do not edit `src/generatePublicSite.ts` for ordinary business-profile changes. Concrete holiday opening hours are only emitted to schema when `holiday_hours_rule.overrides[]` has exact dates and `verified_by_owner: true`.

Run:

```bash
npm run generate-public-site
```

This updates:

- `docs/index.html`
- `docs/assets/services/fabric-storage-inspection.png`
- `docs/services/shoe-bag-care.html`
- `docs/services/white-shoe-cleaning.html`
- `docs/services/fabric-storage.html`
- `docs/services/taichung-xitun-laundry.html`
- `docs/llms.txt`
- `docs/robots.txt`
- `docs/sitemap.xml`
- `docs/social-posts.json`
- `docs/latest.json`
- `docs/services.json`
- `docs/answers.json`
- `docs/geo-targets.json`
- `docs/llms.jsonl`
- `docs/.nojekyll`

`social-posts.json` is the full AI-readable feed of approved scheduled posts. `latest.json` contains the newest approved daily package. `services.json`, `answers.json`, `geo-targets.json`, and `llms.jsonl` provide service-level SEO, answer-engine, local-intent, and line-delimited AI ingestion records. If `PUBLIC_SITE_BASE_URL` is set, canonical pages and AI/search entry points use absolute URLs. If `PUBLIC_IMAGE_BASE_URL` is set, image fields use absolute asset URLs; otherwise image paths fall back to the site base or relative paths until the real HTTPS host is configured.

Only scheduled slots approved for both Facebook and Instagram are copied to `docs/content-calendar/YYYY-MM-DD.json` and linked from SEO/AIO/GEO entry points. Manually published posts must be backfilled into the private content calendar and approved log before they become public SEO assets.

The homepage keeps the newest 7 approved content dates expanded for customers. Older approved posts remain in `social-posts.json`, `ai-discovery.json`, `llms.txt`, `llms-full.txt`, `llms.jsonl`, and the JSON feed, and render inside a collapsed homepage archive so long-running history such as 90 days stays available without making the first page unwieldy.

## Approval And Publishing Chain

Daily posting is intentionally split into three stages:

1. `06:30` generation automation creates the private content calendar, image prompt manifest, non-blocking video candidate manifest, final images, image source records, and runs `validate-publishable-images`.
   Video candidates carry a memory hook, conflict, one dominant action, payoff, CTA, 9:16 first-frame direction, and a manual SuperGrok motion prompt. They remain image posts until a returned MP4 passes the Reel gates; see `docs/video-content-workflow.md`.
2. `10:20` approval automation reviews the generated package, writes `data/approved-log/YYYY-MM-DD.json` with `npm run approve-post`, then runs `npm run generate-public-site` so approved content enters SEO/AIO/GEO.
3. `11:30` and `19:30` publishing automations run `npm run post-current-slot` for the due slot.

`post-current-slot` must find an approved-log record for the same date, slot, and platform before it writes `data/posted-log/YYYY-MM-DD.json` or calls Meta. Missing approval records stop the run before any Facebook or Instagram publish attempt.

If a generated calendar has an empty `public_image_url`, `post-current-slot` builds the final image URL from `PUBLIC_IMAGE_BASE_URL` at publish time.

Early Instagram media performance can be checked with the read-only insights script:

```bash
npm run fetch-instagram-insights -- --post-id 18097273807967885
```

The script only calls Meta Graph API with `GET`, sends the access token in the `Authorization` header, and prints the raw Meta response. To override the default media metrics, pass a comma-separated list:

```bash
npm run fetch-instagram-insights -- --post-id 18097273807967885 --metrics reach,likes,comments,shares,saved,total_interactions
```

Refresh both platforms, rebuild the 72-hour review, and update the 90-day KPI snapshot in one read-only Meta workflow:

```powershell
npm.cmd run sync-meta-insights
```

The daily sync uses a rolling 90-day window by default. Instagram collects `views`, reach, saves, shares, and interactions. Facebook uses the current `post_media_view` / `post_total_media_view_unique` metrics plus reaction, comment, and share summaries. Empty Meta datasets remain `null`; they are never converted to zero. The command writes platform reports under `data/insights/`, then refreshes `output/operations/72-hour-review.json`, `output/operations/90-day-kpi.artifact.json`, and `output/operations/meta-insights-sync.json`.

Live posting also requires a real `.env` with:

```text
DRY_RUN=false
META_ACCESS_TOKEN=
FB_PAGE_ID=
IG_USER_ID=
PUBLIC_IMAGE_BASE_URL=
PUBLIC_SITE_BASE_URL=
PUBLIC_ROOT_PAGES_REPO=
```

Keep `DRY_RUN=true` when testing the chain without publishing to Meta.

## IndexNow For Bing And Copilot

`sitemap.xml` is the Google-focused map of canonical human-facing HTML pages. AI-readable files remain available through `ai-sitemap.xml`, `robots.txt`, and the discovery JSON files, but are not mixed into the Google sitemap.

Set `INDEXNOW_KEY` once, run `npm.cmd run generate-public-site`, then publish the generated `docs/indexnow-key.txt` with the normal Pages deployment. Check the payload without sending it with `npm.cmd run submit-indexnow`; only use `npm.cmd run submit-indexnow -- --live` after the public key file is reachable. The command submits canonical HTML URLs only and never prints the key.

## Content Rules

- Every caption opens from the exact object or situation in the slot.
- The second paragraph is exactly `私享家洗衣店`.
- Each caption includes one concrete inspection paragraph before the CTA.
- Each caption ends with 2-4 light hashtags, including `#私享家洗衣店`.
- Every slot includes `visual_route`.
- Instagram captions ask for a direct message, never for a profile-link tap. Instagram captions carry no tappable link, and the first 30 days of account insights recorded zero profile-link taps. Facebook keeps LINE, where links work.
- Every caption carries one low-effort question before the follow CTA. The first 34 measured Instagram posts produced zero comments, and comments carry the most distribution weight.
- `macro-detail` stays under 10% of topic seeds. Across the first 34 measured posts it produced the weakest results of the three visual routes: 82 mean views, 0.28% engagement, and no saves.

## Platform Priority

Instagram is the primary platform. Facebook is kept as a synchronized archive: publishing is already automated at near-zero marginal cost, so posting continues, but no separate creative effort is spent on it. Over the first 36 measured Facebook posts the Page recorded 1 reaction, 0 comments, and 0 shares.
- Daily visuals should be realistic shop-photo images unless the date has a major holiday or a qualified care-consequence activity.
- Do not use local SVG/template fallback images for final publishable assets.

## 90-Day Publishing And KPI Dashboard

Generate the private 90-day operating snapshot with the Asia/Taipei due-time denominator:

```bash
npm run generate-operations-dashboard
```

The command reconciles both daily slots across content, media, FB/IG approval, FB/IG publishing, public SEO/AEO/GEO sync, and exact `views` insight rows. It writes:

- `output/operations/90-day-kpi.artifact.json` — canonical dashboard artifact
- `output/operations/90-day-kpi.sqlite` — reproducible source snapshot
- `output/operations/queries/*.sql` — executed source queries

Missing Meta insight permissions and follower-growth sources are reported as data-access issues, never interpreted as zero performance. This command is read-only against Meta and does not approve or publish posts.

Use `--as-of`, `--start-date`, `--days`, or `--output` when reproducing a historical cutoff or a shorter review window.

## Verification

```bash
npm run typecheck
npm test
```

`npm test` skips publish-pages tests when the local machine has no `git` executable.
