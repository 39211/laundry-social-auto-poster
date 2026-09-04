---
id: design-sixiangjia
kind: design-system
updated_at: 2026-09-05
status: active
---

# DESIGN.md｜私享家（洗衣／洗鞋）

> Agent 做任何公開頁、POS 外觀、落地頁前先讀本檔。來源：Hallmark＋Taste＋UI/UX Pro Max 核心，對齊台灣洗護店。

## 產品讀法（Brief）
- **誰：** 台中西屯洗鞋／洗衣客人；怕洗壞名牌、要信任、要價目清楚。
- **不是：** 通用 SaaS、紫漸層 AI 模板、假 metric。
- **成功條件：** 一眼看出「洗鞋／洗衣服務」；價格與流程不糊；行動＝LINE／來電／到店。

## 三轉盤（Taste 預設｜信任優先）
- `DESIGN_VARIANCE: 4`（穩、可信，不要實驗站）
- `MOTION_INTENSITY: 3`（微動即可；尊重 `prefers-reduced-motion`）
- `VISUAL_DENSITY: 5`（價目／流程資訊夠，不空曠裝腔）

## 禁止（Hallmark 高頻 AI 味）
1. 紫／粉／藍漸層 hero、漸層字
2. Inter／Roboto／Open Sans 單字體打全站
3. 三欄等寬 icon＋兩行標題＋三行說明卡片
4. 卡片套卡片、左側粗色條卡
5. 100vh 置中一句話＋單一 CTA
6. `#000`／`#fff` 純黑純白無色溫
7. 假數字（「+47%」「50,000+ 信任」）— 沒有來源就不寫
8. 假瀏覽器／假手機 chrome
9. 標題用斜體當強調（標題永遠 roman）
10. Sticky「Logo｜Features｜Pricing｜Docs｜CTA」AI 導覽

## 必做
- 顯示字＋內文字配對（兩套，不要一套打天下）
- 色票用 named token；元件不內嵌亂寫 hex
- 互動元件至少想過：default／hover／focus-visible／disabled／loading／error
- 手機 320／375／414／768：無橫向捲動；點擊文字不換兩行擠爆
- 對比 ≥ 4.5:1；按鈕 ≥ 44×44
- 圖必一眼看出產品（鞋／衣／門市）

## 落地頁節奏（建議）
痛點（不敢送洗）→ 證明（實拍前後）→ 價目錨點 → 流程 → LINE／來電 CTA。  
不要複製「hero→三特色→logo牆→假證言→footer」。

## 動效
- 優先 CSS；需要時間軸／ScrollTrigger 才用已裝的 GSAP skills
- 動效要有意義（引導視線），不要無限 loop 裝飾

## 交卷
改 UI 要附：對照本檔哪幾條；截圖；若有假數字＝FAIL。
