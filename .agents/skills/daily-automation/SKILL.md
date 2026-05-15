---
name: daily-automation
description: Daily Codex Project Automation workflow for 私享家洗衣店.
---

# Daily Automation Skill

This project uses Codex Project Automation as the runtime for content and image generation.

## Morning Generation
Run at 06:30 Asia/Taipei:
1. Use `laundry-content`.
2. Run `npm run generate`.
3. Use `laundry-image`.
4. Run `npm run generate-image-manifest`.
5. Use built-in `image_gen` once per manifest item.
6. Save final images into `docs/assets/YYYY-MM-DD/slot-XX.png`.
7. Run `npm run validate-images`.
8. Run `npm run publish-pages`.
9. If `origin` is configured, this commits and pushes `docs/assets/YYYY-MM-DD/`, `docs/content-calendar/YYYY-MM-DD.json`, and `docs/index.html`; if no remote exists, report that GitHub Pages publishing is not configured. Never commit `.env`, `data/posted-log/`, tokens, or secret-looking text files.

## Posting Runs
Run at the configured slot times:
1. Use `meta-publisher`.
2. Run `npm run post-current-slot`.
3. Keep dry-run unless the owner has explicitly set `DRY_RUN=false`.

## Slot Times
07:30, 09:30, 11:30, 13:30, 15:30, 17:30, 19:30, 21:00, 22:00, 23:00.
