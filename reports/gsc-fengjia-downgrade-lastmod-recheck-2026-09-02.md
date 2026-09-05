# GSC 逢甲頁狀態降級與 lastmod 複核（2026-09-02）

## 目的

確認 `local/fengjia-laundry-pickup.html` 從「已建立索引」變成「已檢索，目前尚未建立索引」是否可由 sitemap `lastmod`、canonical、robots 或線上內容變更解釋，避免把 Google 的重新評估誤判成技術故障。

## 實測證據

| 項目 | 2026-09-01 讀值 |
|---|---|
| live HTTP | 200 |
| live SHA-256 | `6a838ea77d3569f73461753c1a48e56c3c1f3038b2dbc20c6e9b0b2a2e10f967` |
| sitemap `lastmod` | `2026-08-29` |
| GSC 2026-08-31 | `Submitted and indexed`；最後抓取 `2026/8/30 下午 01:59:47` |
| GSC 2026-09-01 | `Crawled - currently not indexed`；最後抓取 `2026/9/1 上午 09:54:07` |
| canonical | 使用者 canonical 與 Google 選定 canonical 都是自身 URL |
| robots/meta | `index, follow, max-image-preview:large`；抓取成功 |

## 判定

**`REASSESSMENT_WITHOUT_LASTMOD_CHANGE`。** 狀態降級發生時，sitemap `lastmod` 仍是 2026-08-29，且 live 回應、canonical、robots 與抓取均正常。現有證據不能推出特定技術原因；較保守的解釋是 Google 在重新抓取後重新評估索引資格，但這仍是推測，不是已證實原因。

這次結果也不能解讀成整站索引下降：它只證明單一 URL 在兩個快照間改變了 GSC 狀態。既有 2026-09-01 快照為 25/32 已建立索引；live sitemap 為 33 URL。

## 控制與下一步

1. 等待 2026-09-02 23:15 GSC 排程產生新鮮 inspection；不在此之前改寫 canonical、robots、schema、sitemap 或正文。
2. 若同一 URL 在兩個新的新鮮快照仍是 `Crawled - currently not indexed`，才做一次內容／搜尋意圖處理；不以重複要求建立索引取代內容驗證。
3. 本輪不新增 URL、不重送 IndexNow；sitemap hash 未變且 2026-09-02 IndexNow 已成功，符合 no-op gate。
4. 7/28 日判定仍以非品牌曝光、GA4 自然搜尋與 LINE click 為主，缺資料保留 `null`，不得填 0。

## 證據邊界

HTTP 200、sitemap 提交或 IndexNow 成功只代表可取得／已通知，不等於 Google 已建立索引或帶來曝光。下一個可判定的觀測點是新鮮 GSC inspection 與後續 7/28 日成效。
