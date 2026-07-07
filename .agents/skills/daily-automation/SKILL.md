---
name: daily-automation
description: Daily Codex Project Automation workflow for the laundry social publishing project.
---

# Daily Automation Skill

## Morning Generation
Run for the current Asia/Taipei date:
1. Use `laundry-content`.
2. Run `npm run generate-context -- --date YYYY-MM-DD`.
3. Run `npm run generate -- --date YYYY-MM-DD`.
4. Use `laundry-image`.
5. Run `npm run generate-image-manifest -- --date YYYY-MM-DD`.
6. Use built-in `image_gen` / gpt-image-2 exactly once per manifest item.
7. Save final images into `docs/assets/YYYY-MM-DD/slot-XX.png`.
8. After each saved image, run `npm run mark-image-source -- --date YYYY-MM-DD --slot X --source gpt-image-2`.
9. Run `npm run validate-publishable-images -- --date YYYY-MM-DD`.
10. Run `npm run generate-public-site` so `docs/llms.txt`, `docs/social-posts.json`, `docs/latest.json`, `docs/robots.txt`, and `docs/sitemap.xml` include the newest daily package.

## Rules
- Daily cadence is exactly 2 slots: 11:30 knowledge and 19:30 situation.
- Do not use local SVG/template fallback images for final publishable assets.
- Do not approve posts, write approved-log entries, write posted-log entries, or publish unless the user explicitly asks.
- Daily content must keep `visual_route` on every slot.
- Public AI/SEO feed files in `docs/` are allowed during morning generation; they are not approval or posted logs.
