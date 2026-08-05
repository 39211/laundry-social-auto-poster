---
name: meta-publisher
description: Publish or dry-run publish 私享家洗衣店 content through Meta Graph API scripts.
---

# Meta Publisher Skill

Use this skill for Facebook Page and Instagram professional account publishing.

## Safety
- Default is dry-run. Keep `DRY_RUN=true` until the owner explicitly switches to live posting.
- Never print access tokens.
- All tokens come from `.env`.
- `PUBLIC_IMAGE_BASE_URL` is required even for dry-run posting. It must be the real public HTTPS asset base URL, such as the Netlify site URL or a GitHub Pages URL.
- The same `PUBLIC_IMAGE_BASE_URL` is also used by `npm run generate-public-site` to write absolute AI/SEO URLs in `docs/llms.txt`, `docs/social-posts.json`, `docs/latest.json`, `docs/robots.txt`, and `docs/sitemap.xml`.
- Do not use browser automation, Chrome plugin, Computer Use plugin, or unavailable Facebook/Instagram plugins.

## Commands
- Current slot: `npm run post-current-slot`
- Specific dry-run slot: `npm run post-current-slot -- --date YYYY-MM-DD --slot 1 --dry-run --skip-url-check`
- Live mode only after explicit approval: set `DRY_RUN=false` and run without `--dry-run`.
- `post-current-slot` must find approved-log records for the target date, slot, and platform before writing posted-log or calling Meta.
- If `public_image_url` is empty in the content calendar, `post-current-slot` builds it from `PUBLIC_IMAGE_BASE_URL` at publish time.
- A planned Reel or mixed carousel keeps its video route only when the local MP4, source record, review, and public URL pass. If the video is missing or invalid but the approved images pass, resolve the submission explicitly to an image or image carousel, record `VIDEO_DEFERRED` plus the exact cause and `video_defer_kind`, and enqueue repair for the next production cycle.
- One approved-log record per date, slot and platform covers that slot's whole media package. Downgrading a deferred video to its approved images does not require a new approval, and `--preflight-only` reports a deferral without writing it to the repair queue.
- Never send a still image through a Reel endpoint or claim that the fallback post contains video. The public caption stays customer-facing; the failure marker is operational metadata only.

## API Shape
- Facebook uses `/{page_id}/photos` with `url`, `caption`, and `published=true`.
- Facebook Reels use the official `me/video_reels` start, hosted upload, and finish flow.
- Instagram photos use `/{ig_user_id}/media` with `image_url`; Reels use `media_type=REELS`, `video_url`, and `share_to_feed=true`, then `/{ig_user_id}/media_publish`.
- Make exactly one Meta write attempt per platform. On the first platform failure, record that single failed attempt through `post-current-slot`, stop immediately, and do not try the second platform or retry an ambiguous/non-idempotent write.
- Successful dry-run entries use `status: "success"` and `dry_run: true`.
- Do not duplicate a dry-run or live post already logged for the same date, slot, and platform.

## Recovery
- Read `data/video-repair-queue/queue.json` during the next evening or morning production cycle. A repaired video is attached to a later suitable unpublished content package, marked ready with `resolve-video-repair --ready`, and changed to `RESOLVED` only after both platforms actually publish the replacement date and slot.
- Video failure alone must not create a missed text/image publication when its approved image fallback is valid. Missing/invalid images, missing approval, inactive policy, unreachable public assets, duplicates, or Meta errors still block publishing.
- A missed slot may be recovered later on the same Asia/Taipei date only when `data/publishing-policy.json` explicitly allows same-day catch-up and no live success is already logged.
- Never backfill a prior date unless the owner separately authorizes that exact backfill.
- Run the same approval, media, public URL, and duplicate gates before recovery. `post-current-slot` remains the only posted-log writer.
