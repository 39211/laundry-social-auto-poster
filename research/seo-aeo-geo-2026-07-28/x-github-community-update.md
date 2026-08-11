# 私享家 SEO / AIO / GEO 社群實務更新

日期：2026-07-28  
研究管道：Grok X Search、X 直接貼文網址、GitHub 公開專案與文件  
目的：把 2026 年社群正在使用的方法，轉成私享家可執行、可驗證、不可灌水的內容與量測規格。

## 判決

目前最值得採用的做法，不是再增加更多技術標籤，而是把以下四件事接成同一條線：

1. 依客人問題建立固定搜尋意圖題組。
2. 每篇內容提供可直接回答的段落與第一手門市證據。
3. 分開記錄品牌提及、可點擊來源引用、被引用頁面與推薦位置。
4. 用固定問題面板按引擎與題組做 Day 0 / 7 / 28 複盤，再接 LINE 詢問、預約與營收。

`llms.txt`、schema、robots 與 AI crawler access 繼續保留，但它們代表可讀性或導覽，不等於已被推薦、被引用或帶來營收。

## X 上的高訊號討論

以下均屬實務工作者的公開討論，不視為官方排名因子或流量保證。

| 主題 | 實務觀察 | 直接網址 |
|---|---|---|
| SEO 與 GEO 底層 | 可索引性、品牌共識與引擎差異仍重要；不把 llms.txt 或特殊 schema 當成已證實捷徑 | https://x.com/harpreetchatha_/status/2069991843367198774 |
| 平台差異 | 同一品牌在不同答案引擎的來源、提及與引用可能不同 | https://x.com/harpreetchatha_/status/2077034332833907195 |
| 索引實驗 | 索引狀態與 AI 答案變化需要時間序列觀察，不能只看一次結果 | https://x.com/harpreetchatha_/status/2077237788588790234 |
| 問題面板 | 從買家問題、競品引用缺口、逐引擎監測與固定週期建立 AI share of voice | https://x.com/Mrinalini_sen99/status/2080141408296665188 |
| 引用延遲 | 頁面狀態改變後仍可能暫時出現在 AI 引用中，單次引用曲線不能直接當成功 | https://x.com/top5seo/status/2081793078445183306 |
| 在地實體 | NAP、評論、FAQ、服務區域與真實在地內容要形成一致的店家實體 | https://x.com/zachwillx/status/2081734358608798078 |
| 提及與引用 | 品牌被文字提到，不等於網站被附上來源連結 | https://x.com/1414sergiy/status/2080302938938040498 |
| 提及與引用 | 量測時需拆開 mention、citation 與 recommendation | https://x.com/deveshkhanal/status/2080444526293045678 |
| 題組與引擎 | AI 能見度要按問題類型與引擎拆分，不用全站單一分數取代 | https://x.com/izhongyuting/status/2081050461684306354 |
| 固定 prompt | 使用固定 prompt library 與固定週期，才能比較前後變化 | https://x.com/manuelarrufat/status/2081792180033659045 |
| llms.txt 質疑 | 社群中有多個案例質疑其排名效果，應把它視為導覽層 | https://x.com/levelsio/status/1905676526533652584 |
| llms.txt 用途 | 另一派主張它對 agents 與文件導覽有用，但這仍不同於 SEO 排名證據 | https://x.com/HamelHusain/status/1905717423950751961 |

## GitHub 實作佐證

| 專案 | 可借用的做法 | 私享家採用方式 |
|---|---|---|
| https://github.com/danishashko/geo-aeo-tracker | 固定 prompt、多引擎、引用頻率、競品引用缺口、歷史比較 | 建立固定問題面板、逐引擎記錄與 Day 0 / 7 / 28 趨勢 |
| https://github.com/coreyhaines31/marketingskills/blob/main/skills/ai-seo/SKILL.md | citation rate、share of voice、recommendation rate、source attribution 分開量測 | 不再把「有提到」等同「有引用」，並保存 cited URL |
| https://github.com/Auriti-Labs/geo-optimizer-skill | crawler evidence、agent access、brand mention、linked citation 是不同證據 | 稽核繼續檢查可讀性，但成效複盤另看真實答案與來源 |
| https://github.com/AnswerDotAI/llms-txt | llms.txt 是推論時的精簡導覽提案 | 保留既有檔案，但不宣稱它會提高排名 |
| https://github.com/sybrew/the-seo-framework/issues/732 | 公開社群對 llms.txt 是否值得作為 SEO 功能仍有爭議 | 不投入大量時間製造更多同類技術檔案 |

`geo-aeo-tracker` 的完整跨引擎抓取需要 Bright Data、OpenRouter 或其他 API 金鑰。私享家目前先採用其量測資料模型，不自行加入付費依賴或未授權的自動查詢。

## 私享家六個搜尋意圖題組

1. `local-discovery`：台中洗衣店、西屯洗衣店、青海路洗衣店、逢甲洗鞋、台中洗包包。
2. `problem-diagnosis`：白鞋泛黃、鞋子淋雨、包包提把、棉被潮味、娃娃能否清洗。
3. `service-comparison`：自行處理或送洗、局部或整體、西裝乾洗、精品材質判斷。
4. `trust-proof`：選店條件、門市如何看材質、真實案例、風險與處理界線。
5. `pickup-logistics`：台中市免費收送、到府收送、床組收送、公司大量衣物送洗。
6. `aftercare`：雨季通風、鞋櫃濕氣、寢具收納、外套煙味與包包受潮。

## 每篇內容的新合格條件

每篇 90 天內容至少要有：

- `search_intent`
- `target_queries`
- `evidence_type`
- 一個可立即回答的客戶問題
- 物件、材質、問題位置與門市判斷
- 不誇大的處理界線
- 對應的人類可讀服務頁或指南頁

不得使用：

- 只替換地名的薄頁
- 自稱最好、第一或保證恢復新品
- 捏造評論、價格、案例或成效
- 把 AI 生成圖冒充真實客戶案例
- 把 crawler visit、brand mention、linked citation 或預約混成同一個指標

## 28 天量測

固定引擎：

- Google Web
- Google AI Overview
- ChatGPT Search
- Perplexity
- Bing Copilot
- Gemini
- Grok Search

固定檢查點：

- Day 0：建立相同問題、引擎、地區與記錄格式的基準。
- Day 7：看抓取、索引、提及與引用的早期變化，不因一次波動重寫策略。
- Day 28：按引擎與題組比較，並接 GSC、AI cited URL、LINE 點擊、有效詢問、預約與營收。

每筆結果分開記錄：

- `brand_mention`
- `linked_citation`
- `cited_url`
- `recommendation_position`
- `answer_accuracy`
- `ai_referral`
- `line_click`
- `qualified_inquiry`
- `booking_or_revenue`

## 已落地位置

- 共用策略：`src/searchVisibilityStrategy.ts`
- 90 天母表：`content-playbooks/2026-07-11_90-day-view-growth-playbook.json`
- 人類搜尋指南：`docs/guides/taichung-laundry-service-search.html`
- 機器可讀策略：`docs/search-visibility.json`
- AI 入口：`docs/ai-discovery.json`、`docs/llms.txt`
- 每日公開貼文：`docs/social-posts.json` 與個別 `docs/posts/*.html`

## 成效界線

這次完成的是內容架構、可讀頁面與量測規格，不是排名或流量成果。是否有效，必須等公開部署、索引與至少 28 天的跨引擎及 LINE 轉換資料後再判斷。
