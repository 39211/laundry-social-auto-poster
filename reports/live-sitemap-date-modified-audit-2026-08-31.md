# live sitemap／JSON-LD `dateModified` 一致性稽核（2026-08-31）

## 方法

- 讀取 live `sitemap.xml` 的 32 個 `<loc>/<lastmod>`。
- 逐頁 GET HTML，解析 JSON-LD graph 內所有 `dateModified`，以每頁最新日期與 sitemap `lastmod` 比對。
- 本次只讀取，不改頁面、sitemap 或提交。

## 結果

| 檢查 | 結果 |
|---|---:|
| sitemap pages checked | 32 |
| sitemap lastmod 與 JSON-LD 最新 dateModified 完全一致 | 32/32 |
| 缺少 JSON-LD dateModified | 0/32 |
| future-dated sitemap lastmod | 0 |

## 判讀

目前 sitemap 更新訊號與頁面結構化資料一致，沒有發現因日期漂移造成的明顯抓取訊號矛盾。這仍不能證明 Google 已收錄；六頁 `Discovered - currently not indexed` 的下一個主變因維持 snippet 與正文情境內鏈。
