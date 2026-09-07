# GSC 六頁 AI answer coverage 稽核（2026-08-31）

## 範圍

以 live `answers.json` 與 `ai-discovery.json` 檢查 GSC 六個 `Discovered - currently not indexed` 頁面是否有可引用的第一方答案與 source URL。這是 read-only 稽核，不代表任何外部 AI 已引用。

## 結果

| 頁面 | answers.json source entries | ai-discovery entry | 首筆答案是否對題 |
|---|---:|---:|---:|
| `services/fabric-storage.html` | 5 | service_pages | 是（收納前乾燥／味道／髒污判斷） |
| `services/taichung-xitun-laundry.html` | 7 | service_pages | 是（西屯地址／服務範圍／LINE） |
| `services/business-bulk-laundry.html` | 5 | service_pages | 是（大量制服／布品與照片詢問） |
| `services/taichung-citywide-laundry-pickup.html` | 8 | service_pages | 是（全市收送與最低消費界線） |
| `services/taichung-laundry-price-list.html` | 5 | service_pages | 是（參考價與非固定價限制） |
| `guides/taichung-laundry-service-search.html` | 5 | support_pages | 是（依物件／問題／材質分流） |

彙總：六頁都有 `answers.json` 的 page-matched source URL（`35` 筆合計），也都在 `ai-discovery.json` 的 service/support index；不是 AI discovery 入口完全漏頁。

## 判讀

- 目前更像是 Google indexing selection／crawl timing／snippet 與頁面內鏈問題，而不是缺少 AEO answer source。這是排查優先序，不是因果證明。
- 首筆答案含有第一方事實與處理界線；保留「不可推論保證成果、價格需依物件判斷」等限制，不為了摘要而誇大。
- 後續實驗仍採「答案先行 snippet＋一條情境內鏈」，並以 GSC inspection、impressions、GA4 landing sessions 與 LINE click 的 7／28 日資料判定；缺資料保持 null。
