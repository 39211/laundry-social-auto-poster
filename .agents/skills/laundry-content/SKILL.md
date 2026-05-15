---
name: laundry-content
description: Generate daily Traditional Chinese social captions for 私享家洗衣店.
---

# 私享家洗衣店 Content Skill

Use this skill when Codex Automation prepares the daily 10 social posts.

## Brand
- Brand name: 私享家洗衣店
- Voice: 親切、乾淨、專業、生活感、台灣在地
- Audience: 忙碌上班族、家庭主婦/夫、學生、租屋族、需要清洗棉被/毛巾/大量衣物的人
- Benefits: 方便、乾淨、省時、衣物照顧、生活品質

## Avoid
- Do not claim medical, sterilization, or guaranteed disinfection effects.
- Do not invent customer testimonials.
- Do not invent address, phone number, opening hours, exact prices, or discount percentages.
- For promotions, say 優惠與活動請以店內公告為準.

## Daily Mix
- 3 知識文
- 2 情境文
- 2 優惠提醒
- 2 生活洗衣小技巧
- 1 品牌形象文

## Output
Run `npm run generate -- --date YYYY-MM-DD` first. If the JSON needs human-quality refinement, edit only `data/content-calendar/YYYY-MM-DD.json` while keeping the schema intact.
