# GSC 六頁 live 內鏈圖稽核（2026-08-31 19:06 Asia/Taipei）

## 範圍

從 live `sitemap.xml` 讀取 32 個 URL，逐頁 GET HTML，統計六個 `Discovered - currently not indexed` 目標的本站 `<a href>` 來源。這是 read-only crawl graph 檢查，不修改 HTML、不重送 IndexNow。

## 結果

| 目標頁 | 原始 href 次數 | 不同來源頁 | 判讀 |
|---|---:|---:|---|
| `services/fabric-storage.html` | 57 | 32 | 有全站內鏈，非零 inlink 缺口 |
| `services/taichung-xitun-laundry.html` | 70 | 32 | 有全站內鏈，非零 inlink 缺口 |
| `services/business-bulk-laundry.html` | 41 | 32 | 有全站內鏈，非零 inlink 缺口 |
| `services/taichung-citywide-laundry-pickup.html` | 64 | 32 | 有全站內鏈，非零 inlink 缺口 |
| `services/taichung-laundry-price-list.html` | 41 | 32 | 有全站內鏈，非零 inlink 缺口 |
| `guides/taichung-laundry-service-search.html` | 14 | 11 | 有內鏈，但來源集中於 11 頁 |

零 inlink 目標：`0/6`。

## 判讀

六頁都已被 live 內部連結發現，且五頁由全站 32 頁連入；因此目前不能把「沒有內鏈」當成主要解釋。下一個實驗應優先測答案／snippet、頁面差異與 GSC crawl／quality 訊號；搜尋指南可補少量正文情境連結，但不應以大量導覽連結製造假改善。

原始 href 次數包含導覽與重複 CTA；判定以不同來源頁為主。此結果仍不等於 Google 已抓取或收錄，需等待下一次 GSC inspection／Page Indexing 資料。

