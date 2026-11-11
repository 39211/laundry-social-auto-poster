# dot SEO 內容修補紀錄（2026-11-10）

執行者：dot。這份紀錄供維護者與後續 AI 接手，說明可重現的原問題、修改位置與驗證邊界，不推測先前作者的意圖。

## 來源與部署界線

- 公開站：https://sixiangjialaundry.com/ 。2026-11-10 取得公開 social-posts.json 與 sitemap.xml；當時 sitemap 含 30 篇可對應到 feed 的文章，另有 posts 清單頁。這不是 Google 已索引證明。
- 修補基底：release/sxj-live-2026-10，f6a3c83042cab52a14bf3bb0d011f2d564b1b561。main cd4d02b 的文章索引政策及產線與 release 不同，因此不把 main 版本直接搬到正式產線。
- 本 PR 不合併、不部署，不執行 IndexNow、不改排程、不發社群、不改影片權限、不混入 #314。
- main 已有避免標題重複品牌的 helper，但 release 尚未採用相同行為。本次只在 release 補等效條件，不搬入 main 的固定 noindex 政策。

## 原問題與修補

1. `careContextFor()` 將「外套」歸為襯衫／西裝；「毛衣」落入泛用衣物；「羽絨」可落入寢具。結果正文、FAQ、延伸閱讀與主題不一致。新增 `postTopicCare.ts`，以具體物件與情境優先辨識；混合物件須同時照顧兩者，未知主題不憑空推定。
2. 文章直接顯示 `search_intent` 等內部分類，並將不相干 `target_queries` 寫入正文與 BlogPosting.keywords。改為讀者可用的摘要、檢查點與經重寫的主題關鍵字。
3. 共用服務 case-study 表格將鞋與家用布品帶進毛衣等文章。移除文章共用表格，保留獨立服務頁原內容，文章改用具體正文與對應 FAQ。
4. description 只取原社群第一句，多為短反問。新摘要說明實際檢查方式與處理界線，帶入該篇主題；HTML／Open Graph／Twitter／JSON-LD 使用同一來源。
5. 「冬衣預約收送…店家服務免費」容易讓人誤會清洗免費。改成準備件數、時段與衣物狀況的標題；不改 URL，收送與清潔費用界線依既有正式資料保留。
6. 文章的公開正文重寫，不回寫已發 Facebook／Instagram 原稿、核准記錄或媒體；不把新文案稱為實際客戶成果。示意配圖不再一律標為門市紀錄。
7. 首頁在每日內容插入後，同步 canonical WebPage 與 sitemap 首頁日期，採原 authored 日期與實際納入貼文日期的最大值，不採 build clock。僅當首頁與 sitemap 都納入本次輸出時成對寫入；不動他頁。final root overlay 的對應修補另見 #58。
8. 文章模板實質改版日期固定為 2026-11-10，不使用 build clock。既有 canonical、發布日期、聯絡方式與服務事實保留。

## 不應誤判的既有狀況

- main 文章固定 noindex；release 依既有厚度／核准條件判斷。保留 release 原閘門，不能為讓測試過關而放寬，也不能把 main 的 noindex 套到正式站。
- main／release 已有 WebP 生成與 picture 輸出，不能單憑線上 PNG 就宣稱整個生成器完全沒有圖片最佳化。
- 正式首頁 `r6-post` 每日卡片確實使用五張大 PNG；但已查 main 與 release 的 renderer 是 `post-card`，與線上不同。額外路徑已由獨立修補定位：laundry 的 posts-data.js／r9-core.js 與 root 的 r10_homepage.py／seo_overlay_merge.py。圖片與 final overlay 日期修補見 [laundry #315](https://github.com/39211/laundry-social-auto-poster/pull/315) 及 [root #58](https://github.com/39211/39211.github.io/pull/58)，本 PR 不重複修改那些檔案。
- 日期不同用途必須分開：HTTP Last-Modified 不是內容日期，不能拿部署時間更新全部頁面。
- GSC 效能／Google 索引資料無法取得，沒有 CTR、排名或 CWV 改善保證。

## 逐頁改寫與驗證

見 [逐頁全文](dot-seo-page-rewrites-20261110.md) 與 [完整驗證紀錄](dot-seo-validation-20261110.md)。30 篇以真實公開資料產生，均保留原 canonical、發布日期與既有索引條件；最短文章 1,564 可見字，30/30 仍可索引，沒有放寬 1,200 字閘門。

網站專用 editorial_title / editorial_description / editorial_content 與原 topic、facebook_caption、instagram_caption 分開。#315 與 #58 優先採網站標題；標示為 FB/IG 原文的檢視仍保留歷史原稿，完整改寫由「閱讀全文」取得。

## 維護者接手

- 本 PR 需連同 #315 與 root #58 審閱整合，才能讓最終首頁的圖片、標題與日期全部生效。
- 不把這份 30 篇測試快照當 production calendar。部署前必須用當時的真實已核准 calendar／feature records 重新生成網站，再走既有發佈流程。
- root overlay 的 GENERATED_OWNED 包含 posts/、rss.xml、feed.json、ai-sitemap.xml；overlay_files() 不覆寫 generated posts。不要改成從舊 static posts 蓋回。
- 新來源案例要同時檢查主題標題、正文、FAQ、related links、keywords 與 schema，不只補 title。原始 social 投稿、憑證、價格及服務承諾不在本修補範圍。
- 未合併／未部署的 PR 不能描述成正式站已修好。Windows CI 需對該 PR exact head 查驗，不能採用其他分支的綠燈。


## Expanded object-specific correction

dot additionally corrected concrete legacy-topic misclassifications for shoe toe-cap ribbon, belts, wallets, ties, and paired cushion/sofa covers. New rules precede broad object rules and do not invent bag handles, shirt cuffs, or a beverage spill. Five regression tests cover these counterexamples. See the latest validation section for exact test limits and failed CI; this remains a draft pending integration and validation.
