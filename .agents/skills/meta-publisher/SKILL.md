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
- `PUBLIC_IMAGE_BASE_URL` is required even for dry-run posting. It must be the real GitHub Pages base URL.
- Do not use browser automation, Chrome plugin, Computer Use plugin, or unavailable Facebook/Instagram plugins.

## Commands
- Current slot: `npm run post-current-slot`
- Specific dry-run slot: `npm run post-current-slot -- --date YYYY-MM-DD --slot 1 --dry-run --skip-url-check`
- Live mode only after explicit approval: set `DRY_RUN=false` and run without `--dry-run`.

## API Shape
- Facebook uses `/{page_id}/photos` with `url`, `caption`, and `published=true`.
- Instagram uses `/{ig_user_id}/media` with `image_url` and `caption`, then `/{ig_user_id}/media_publish`.
- Retry up to 3 attempts.
- Successful dry-run entries use `status: "success"` and `dry_run: true`.
- Do not duplicate a dry-run or live post already logged for the same date, slot, and platform.
