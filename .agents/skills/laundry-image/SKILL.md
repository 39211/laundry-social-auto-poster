---
name: laundry-image
description: Generate daily image assets for 私享家洗衣店 using Codex built-in image generation.
---

# Laundry Image Skill

## Workflow
1. Run `npm run generate-image-manifest -- --date YYYY-MM-DD`.
2. Open `data/image-prompts/YYYY-MM-DD.json`.
3. For each manifest item, call built-in image generation exactly once.
4. Save the final image into `docs/assets/YYYY-MM-DD/slot-XX.png`.
5. Run `npm run mark-image-source -- --date YYYY-MM-DD --slot X --source gpt-image-2`.
6. Finish with `npm run validate-publishable-images -- --date YYYY-MM-DD`.

## Visual Rules
- Daily final images should be realistic shop-photo visuals.
- Avoid poster layouts unless the content has a major holiday or qualified care-consequence activity.
- Avoid fake logos, storefront names, addresses, phone numbers, watermarks, and readable invented text.
- Do not use local SVG/template fallback images for publishable daily assets.
