# GSC「已發現但未索引」live 診斷 — 2026-09-02

## 結果

最新 GSC index snapshot（2026-09-01）列出 6 個 `Discovered - currently not indexed` URL。以 2026-09-02 live audit／IndexNow audit 的最新讀值交叉核對後，六頁均 HTTP 200、canonical 自指、沒有 `noindex`，且正文均高於 500 字元：

| URL | 正文字元 | 站內連結數 | canonical | noindex | GSC 狀態 |
|---|---:|---:|---|---|---|
| `services/fabric-storage.html` | 2,680 | 27 | self | 否 | Discovered |
| `services/taichung-xitun-laundry.html` | 3,110 | 34 | self | 否 | Discovered |
| `services/business-bulk-laundry.html` | 2,067 | 24 | self | 否 | Discovered |
| `services/taichung-citywide-laundry-pickup.html` | 2,474 | 21 | self | 否 | Discovered |
| `services/taichung-laundry-price-list.html` | 1,738 | 23 | self | 否 | Discovered |
| `guides/taichung-laundry-service-search.html` | 1,968 | 39 | self | 否 | Discovered |

## 判定

- 6/6 不是目前可見的 HTTP、canonical、noindex 或明顯薄正文故障；更符合「已發現、等待爬取／評估」狀態。
- 內鏈欄位採 `output/operations/indexing-push-2026-09-02.json` 的當日 audit；不要與舊日期的 text/link 統計混用。
- 這不代表 Google 會收錄，也不代表曝光已增加；仍需新鮮 URL Inspection／Page Indexing 證據。
- 暫不對六頁重複要求索引。先保留現有內鏈與 sitemap，避免把尚未證明的內容變因混在 pilot。

## 下一步

在今日 GSC 收集週期完成後，若 inspection 仍為 `Discovered`，才按優先序做單一頁面內容／意圖 treatment；若轉為 `Crawled - currently not indexed`，改做差異化內容審查，不再重送索引請求。
