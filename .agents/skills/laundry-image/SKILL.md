---
name: laundry-image
description: Generate daily image assets for 私享家洗衣店 using Codex built-in imagegen.
---

# 私享家洗衣店 Image Skill

Use the built-in `image_gen` tool. Do not use the CLI fallback and do not require `OPENAI_API_KEY`.

## Workflow
1. Run `npm run generate-image-manifest -- --date YYYY-MM-DD`.
2. Open `data/image-prompts/YYYY-MM-DD.json`.
3. For each of the 10 manifest items, call the built-in `image_gen` tool once.
4. Move or copy each final image into its `target_path`, for example `docs/assets/YYYY-MM-DD/slot-01.png`.
5. Run `npm run validate-images -- --date YYYY-MM-DD`.

## Visual Rules
- Prefer clean square social images suitable for FB/IG.
- Use modern Taiwanese self-service laundromat scenes, clean clothes, towels, bedding, rain-day or lifestyle details.
- Avoid people unless a prompt explicitly needs them.
- Avoid fake logos, fake storefront names, fake addresses, fake phone numbers, and unreadable text.
- If text appears, it must be minimal and Traditional Chinese, but no text is safer.

## Built-in Save Rule
The built-in image tool may save under Codex's generated image directory. Final project assets must be copied into `docs/assets/YYYY-MM-DD/`.
