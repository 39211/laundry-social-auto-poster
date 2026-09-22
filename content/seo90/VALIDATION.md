# 2026-09-22 SEO90 驗證紀錄

狀態：GO_PREVIEW_ONLY，HOLD_PUBLIC。沒有正式部署或搜尋收錄驗收。

## 實際執行

- 原始隔離基線：缺 `PUBLIC_SITE_BASE_URL`，suite 啟動失敗，exit 1；6 個已收集測試過不代表基線過。
- 補上測試網址：原網站與 sitemap **47/47** 通過。
- 新模組初版 **25/25** 通過，但獨立複查仍找到真缺陷，保留當時 FAIL 證據。
- 修復後完整相關 suite 先 **83/83**（新 36＋既有 47），0 failed、0 skipped；typecheck exit 0。
- 獨立 reviewer 重跑 **36/36** 與 **10/10 反例**，最終沒有本切片未解阻擋；同為 GPT 家族，不是跨家族。
- 真首批：6 短版預覽稿（未達完整母文900中文字元門檻）、24 張真 imagegen 圖、7 HTML、42 個本機連結與24個媒體 hash 全部通過。90 個提案日期連續；0 website approvals、0 releases。
- 瀏覽器：索引桌面排版與首篇390px手機畫面已看；首篇4圖載入，scrollWidth375≤viewport390；沒有橫向溢出。沒有宣稱逐台手機測試或全網站正式驗收。
- W4 未改原 generator；W5 已在隔離分支接入 `generatePublicSite.ts`，正式 `docs` 仍未修改／部署。

## 實際修復過的問題

1. 字串 false 誤當 true：現在布林類型嚴格驗證。
2. 物件／數字混入文字：schema 拒絕，不能輸出 `[object Object]`。
3. 四 ID 共用同圖：比對 PNG 解碼後像素，重編碼也不能混過。
4. junction 指向 docs：解析實體既存祖先路徑後拒絕。
5. 不存在日期：canonical 與時間用真日曆驗證。
6. 核准前已釋出：modified 不可早於核准；首次歷史日期不由 build 重設。
7. 改 caption／alt 沒使核准失效：完整 asset manifest hash 納入核准。
8. 缺 approval 例外：正常 held，不把未核准版發布。
9. 檢查後來源變動：輸出已驗證 frozen bytes。
10. 第二店索引帶私享家文字：改用品牌 registry。
11. approvedBy 物件／空白：要求有效文字。
12. toString／constructor 冒充 registry ID：改成 own-key 查詢。

完整原始與複驗紀錄保存在工作樹外 `../evidence/`、`../*-tests-*.json`、`../typecheck-*.log`；原錯誤沒有被改寫為通過。行為反例不同於正式 fault-injection mutation run，本輪不冒稱已做獨立突變套件。

## 下一閘

Pro R2 複審後才接正式 source→generator→網站導覽／文章／sitemap；整合輸出需單獨驗證。任何 API 接受、fixture published 或本機頁面都不能代替真站回讀。

## W5 最新實跑

- `all-tests-w5-r3.json`：97/97、0 failed、0 skipped（37 核心＋13 接線＋47 既有）；`typecheck-w5-r5.log` exit 0。
- 真六篇私稿 `current-six-public-gate.json`：6 held，0 publicFiles、0 sitemapEntries、0 relatedServices、dailyIndexPath=null。
- `first-batch-audit-r3.json`：7 頁、42 本機連結、24 圖片 hash、90 個連續日期全過。預覽網址 http://127.0.0.1:60027/daily/，僅 localhost。
- 增加既有 posts／sitemap／service bytes 不變、固定 public-ready 來源、私稿不外洩、合成核准正路、path/id collision、Windows junction、重跑與移除來源的保護性拒绝。
- 未實作正式 release writer。重跑既有 SEO90 文章會 collision，移除來源會要求 reconciliation；已有頁面保持原樣。這是保護性限制，不是自動更新／撤稿已完成。
- W5 獨立複審：49/49 獨立重跑＋字數／私稿／跨日期同 slug 等探針；最終97項JSON由審查員核對，沒有宣稱97項全由審查員重跑。裁定 Can ship GO_PREVIEW_ONLY＋W5零公開整合，HOLD_PUBLIC。證據 evidence/independent-w5-review.md；同為 GPT 家族。

## W9：首批完整母文與逐圖品管（2026-09-22）

本節取代先前「0完整母文／6短稿」的當前量。現在為5篇完整母文通過獨立內部核稿、1篇安全帽held、84篇brief。5篇合計20張圖；第6篇的4張候選圖不計完成配額。
原24張PNG未覆蓋；白襯衫第三張另以imagegen產生修正版並通過獨立真圖複核。LINE文章的三項清單／小標錯位已修；安全帽文字改正，但服務與整組素材仍待確認。
真候選驗證：6頁noindex、24資產SHA/歸屬、public模式0頁/0 sitemap/6件held。69件payload含圖ZIP已新目錄開箱逐件SHA核對；桌面與390px代表頁可讀，私有手機預覽圖卡單欄。
公開GitHub僅記錄狀態、來源SHA、驗證與缺陷；未核准全文、圖片、含圖ZIP留本機與Obsidian，不放公開repo或sitemap。0店主核准、0正式release、0部署／社群發文。
本輪文字編輯與核稿接線由Codex完成，另一GPT席複審，非跨家族；沿用Grok4.7實作的release引擎，沒有宣稱新增Grok派工。
下一節點：補足實際七天內容並做兩店隔離重建；安全帽若未確認，須用已確認服務的內容補位，不能拿held湊數。
