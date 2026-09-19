# 私享家索引增長更好方法（2026-08-31）

## 判決

目前主要問題不是 Googlebot 被擋，也不是 sitemap 提交次數不足，而是三件事混在同一個循環裡：監控、既有頁修復、以及新頁發布。更好的方法是改成「事件觸發、先救六頁、單頁 pilot、通過後才分批放量」。

## 目前證據

- live sitemap：32 URL；最新 GSC 快照：26 indexed、6 `Discovered - currently not indexed`。
- GSC 快照產生於 `2026-08-30T17:41:02Z`；六頁目前 HTTP `Last-Modified` 是 `2026-08-31T06:04:33Z` 左右。快照比目前 live 部署早約 12 小時 23 分，不能用舊快照判定新版本失敗。
- 六個未收錄頁的正文中位數 2,244.5 字元，高於已收錄組的 1,431.5；只增加字數不是合理主變因。
- 從 26 個已收錄頁的正文（排除 header、nav、footer、script、style）計算 distinct inbound source：已收錄頁組中位數 7，六個未收錄頁中位數 8.5。整體不是內鏈量不足。
- 六頁正文 inbound：企業大量洗衣 2、價目頁 5、布品收納 7、西屯洗衣 10、搜尋指南 10、全市收送 17。只有前兩頁明顯值得做精準內鏈實驗。
- 六頁 4-gram Jaccard 最高 0.1426；西屯洗衣與搜尋指南為 0.1043。這不足以證明重複頁，不能在沒有 GSC query/canonical 證據時先合併。
- meta description 品牌先行 4/6、answer box 品牌先行 3/6；這是第二階段 snippet 實驗，不是目前未收錄的既定因果。
- IndexNow 已成功一次，重複送出不會讓 Google 更快。PR #30 的 24 候選頁仍有六組 fail-open mutation，且沒有獨立審核，不能部署。

## Google 官方邊界

- [Google crawling and indexing FAQ](https://developers.google.com/search/help/crawling-index-faq)：sitemap 能協助發現，不保證收錄或排名。
- [Ask Google to recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)：少量 URL 可用 URL Inspection 請求一次；重複請求不會加速，且仍不保證收錄。
- [Link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)：重要頁應從至少一個可發現頁取得可爬 `<a href>`，anchor 必須描述目標內容。
- [How Google Search works](https://developers.google.com/search/docs/fundamentals/how-search-works)：頁面即使可抓取，也可能因品質、需求或設計而不被索引。
- [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) 與 [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)：為相近查詢或地名大量複製頁，可能構成 doorway／scaled-content abuse。

## 新流程：事件觸發，不再輪詢製造工作量

| 觸發事件 | 只執行一次的動作 | 禁止事項 |
|---|---|---|
| live sitemap/hash 改變 | live HTTP/canonical/noindex/schema audit；成功後一次 IndexNow/Bing 提交 | sitemap 未變時重複提交 |
| 新 GSC index snapshot 到達 | 比較 last crawl、Google canonical、coverage、impressions | 缺資料寫成 0 |
| 部署後第 7 天 | 判 `PENDING` 或 `RETEST`；確認 Google 是否已抓取 | 提前判成功或失敗 |
| 部署後第 28 天 | 依預先門檻判 `ADOPT`／`RETEST`／`REJECT` | 只看 HTTP 200 或提交狀態 |
| release gate 全綠 | 部署下一個小 cohort | 24 頁一次全放 |
| 沒有新事件 | 不執行寫入，不重複發通知 | 用重跑稽核冒充成長 |

## 第一階段：先處理六個 live 未收錄頁

1. 等第一份晚於 `2026-08-31T06:04:34Z` 的新鮮 GSC inspection；目前 26/6 只能當舊基線。
2. 使用 Search Console URL Inspection 對六頁各請求一次重抓；不連續重送。
3. 第一個單變因只做兩頁正文情境內鏈：
   - `services/business-bulk-laundry.html`：從制服／襯衫與寢具批量情境的已收錄頁各增加一條自然連結。
   - `services/taichung-laundry-price-list.html`：從白鞋清潔與精品乾洗的價格判斷段各增加一條自然連結。
4. 全市收送已有 17 個已收錄正文來源，維持 control；布品收納、西屯洗衣、搜尋指南也先不加連結。
5. 若新鮮 GSC 證明已抓取仍不收錄，再做第二個單變因：把 4 個品牌先行 meta、3 個品牌先行 answer box 改為答案先行；不要與內鏈同批改。
6. 衣物收納頁只在取得真實案例、檢查步驟與可公開照片 provenance 後補強，不虛構案例。

## 第二階段：PR #30 先修 gate，再做單頁 pilot

PR #30 必須先讓下列六組 mutation 真正「拿掉就紅、還原就綠」：citation provenance、revision、正文 hash、安全語意、registry provenance、publish-state resolver。再加獨立審核與 production exact-host/live closure。

第一個新頁 pilot 只選 `guides/shoe-odor-source.html`，原因是目前唯一直接對應第一方非品牌 query 的候選：`勃肯鞋會臭嗎` 有 2 impressions。其餘 23 頁先維持候選，不因 inventory 完整就發布。

## 第三階段：通過 pilot 後才分批放量

- pilot 28 日達標後，每批 4–6 頁；每頁必須有獨立意圖、真實 demand/evidence、唯一答案、來源與影像 provenance、可爬內鏈、self-canonical、schema、safety gate。
- 建議實驗門檻（營運規則，不是 Google 保證）：28 日內 cohort `>=70%` indexed 且出現非品牌 impressions 才 `ADOPT`；40–69% 或只有 crawl 前進為 `RETEST`；資料完整且 `<40%` indexed、或被 canonical/duplicate 合併，則 `REJECT`／整併。
- 現在 26/32 的表面收錄率是 81.25%。若此比例長期維持，100 indexed 約需 124 live URL；新頁通常較慢，因此規劃應以約 130–140 個高品質 live URL 作容量假設，而不是把 sitemap 做到 100 就宣稱達標。這是規劃推估，不是收錄保證。
- 先達成並驗證 100 indexed，再規劃 150／200。

## 工具定位

- Searchable：監測 AI citation/competitor visibility，不能替 Google 建索引。
- Perplexity：驗 crawler 與實際 citation，不能證明 Google indexed。
- Julius AI：只分析去識別化 GSC/GA4 彙總，不能創造搜尋需求。
- Clay：只適合合法 B2B 名單與 CRM enrichment，與自然搜尋收錄不是同一條管線。

## 下一個真正動作

今晚排程後先取得新鮮 GA4/GSC；如果 GSC inspection 仍早於目前 live `Last-Modified`，狀態維持 `UNMEASURED`，不改頁。若快照已新鮮，按上面的六頁分流開始第一個兩頁內鏈實驗；PR #30 在六組 mutation 與獨立審核通過前不部署。
