# 一塊印模式移植到私享家：實作與驗證紀錄

日期：2026-09-03（Asia/Taipei）

## 判決

**部分正確。** 一塊印可公開驗證的優勢不是「AI 自動發文」本身，而是完整的搜尋漏斗：高意圖問題頁先回答問題，再連到產品／解決方案，最後量測電話與 LINE。這套結構可移植到私享家；印刷內容、品牌、版型與「200 以上曝光是由哪一項改動造成」不能複製或宣稱已證明。

「200 以上曝光」屬 GSC 的 search impressions 概念，不是 GA4 的「索引量」。GA4 用來看 session、頁面與事件；Google 是否索引及搜尋曝光仍以 GSC 為準。沒有一塊印私有 GSC／GA4 匯出，因此本次只能驗證公開架構與私享家實作，不能證明單一因果。

## 公開樣本實測

- [一塊印 sitemap](https://iprinter.com.tw/sitemap.xml)：128 個 URL。
- [每日問答入口](https://iprinter.com.tw/daily/)：93 個 `daily/day-N/` 問答頁；抽樣與全站掃描顯示頁面有獨立 title、description、canonical、BlogPosting／FAQ 結構與大量內鏈。
- [知識入口](https://iprinter.com.tw/knowledge/)：把問題內容集中成可爬取的主題入口。
- [Day 90 範例](https://iprinter.com.tw/daily/day-90/)：答案先行、摘要、表格、延伸文章、產品／方案卡與聯絡 CTA 同頁串接。
- [公開 GA4 事件腳本](https://iprinter.com.tw/scripts/analytics-events.js)：區分文章瀏覽、文章到產品／方案、電話、LINE；`generate_lead` 只由確認成功的表單流程送出。

2026-09-03 公開全站掃描結果：128/128 HTTP 200、0 canonical mismatch、0 重複 title 群組、0 重複 description 群組；93 個 daily 頁平均約 2,621 個可見字元，平均約 31 個內部連結。這些是公開架構證據，不是排名因果證明。

## 私享家已完成移植

1. 建立 `/knowledge/` 洗護知識庫，把鞋子問題放第一組，再接洗包、衣物／床被、選擇判斷與在地服務。
   首頁只顯示各群組的精選答案，完整清單留在知識庫，避免把首頁做成關鍵字牆。
2. 保留現有 fail-closed catalog：只有 accepted 且有來源綁定的問答頁能進生成器；draft／rejected 不進 sitemap。
3. 將 sitemap 從既有 32 個來源 URL 擴成 57 個候選 URL：`32 + 24 accepted answers + 1 knowledge hub`。
4. `posts/` 仍為 `noindex, follow` 且不進 sitemap，避免把短社群文當成一塊印的厚實 daily 頁來冒充。
5. 新增 GA4 搜尋漏斗事件：
   - `view_knowledge_hub`
   - `view_search_answer`
   - `view_service`
   - `click_answer_from_hub`
   - `click_service_from_hub`
   - `click_service_from_answer`
   - `click_phone`
   - `click_line_cta`
6. `line_click` 仍只由 `/go/line.html` 轉址頁送出；來源頁不重複送。沒有確認成交的流程不送 `generate_lead`。
7. `npm run ga4-report -- --date YYYY-MM-DD` 現在會從 GA4 Data API 讀回上述八個漏斗事件及 `line_click`，寫入當月 leads ledger；未授權或讀取失敗時標為 `unmeasured`，不把缺資料寫成 0。

## 產物驗證

- Sitemap audit：57 URL、0 duplicate、全部同 canonical origin、0 future lastmod、robots 正確引用 sitemap。
- 逐 URL 本機 HTML 稽核：57/57 檔案存在、57/57 self-canonical、0 重複 title 群組、0 重複 description 群組、57/57 有對應搜尋漏斗 instrumentation。
- 內容粗略厚度（移除 script/style/tag 後）：57 頁平均約 2,256 可見字元；最低 805 字元的是既有 `shirt-suit-dry-cleaning.html`，不是這批新增問答。新增 accepted 問答的正文回歸底線為 950 字元；這不是排名門檻，來源、差異化、停手條件與內容鎖才是品質判定，不能為湊整數編造內容。
- 產物一致性閘門會逐筆比對 `social-posts.json`、公開日曆與 `ai-discovery.json` 的主題／文案／圖片，並核對 sitemap 內 HTML 的 PNG 真實尺寸；已有 WebP 時必須保留 `<picture>`。
- 搜尋事件閘門會在模擬瀏覽器中實際觸發每個頁面與 CTA，不只找事件名稱字串；共同維度與 `answer_id`／`service_id` 缺失也會變紅。聚焦測試 56/56 通過；完整單工測試 748 通過、16 跳過。第一次高並行全套測試有 9 個既有案例碰到 5 秒逾時，這 9 個檔案改成單工重跑為 175/175 通過。

## 7／28 天判定，不把提交當收錄

- Day 0：記錄部署 commit、sitemap hash、57 個 URL 清單、GSC 與 GA4 基線。
- Day 7：只查新 URL 是否 discovered／crawled／indexed；未索引頁按 GSC 原因分組，不重複提交製造假進度。
- Day 28：看新增頁的非品牌 impressions、clicks、GA4 organic sessions、`view_search_answer → click_service_from_answer → click_line_cta → line_click` 漏斗。
- ADOPT：新頁至少 70% indexed，且出現非品牌曝光，並至少有一個答案到服務或聯絡事件。
- RETEST：已 crawl 但曝光為 0，或有曝光卻完全沒有服務／聯絡行為；依查詢意圖、答案開頭、服務連結與第一方證據逐頁修正。
- REJECT／MERGE：28 天仍 crawled-not-indexed，且與既有頁高度重複；整併而不是再堆新 URL。

## 尚未證明

- 這 25 個新增 sitemap 候選尚未因「產生檔案」而自動成為 Google 已索引頁。
- 尚未取得一塊印私有 GSC／GA4 資料，不能把 200+ impressions 全歸因於任何單一技術。
- GitHub push／PR 不等於正式網站部署；部署後才開始 Day 0 計時。
