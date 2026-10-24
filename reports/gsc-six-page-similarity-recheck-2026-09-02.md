# GSC 六頁正文相似度重驗（2026-09-02）

## 範圍與方法

以 live HTTPS `GET` 讀取目前六個 `Discovered - currently not indexed` URL，只取 `<main>` 文字，移除 HTML／script／style 後計算字元 3-gram Jaccard。這是站內近重複的診斷訊號，不是 Google 的 duplicate 判定，也不能取代 URL Inspection。

## 結果

| 頁面組合 | 3-gram Jaccard |
|---|---:|
| `business-bulk-laundry` × `taichung-citywide-laundry-pickup` | 0.220 |
| `taichung-xitun-laundry` × `taichung-citywide-laundry-pickup` | 0.180 |
| `fabric-storage` × `business-bulk-laundry` | 0.160 |
| `taichung-xitun-laundry` × `business-bulk-laundry` | 0.160 |
| `taichung-xitun-laundry` × `taichung-laundry-service-search` | 0.160 |
| 其餘 10 組 | 0.100–0.160 |

六頁正文長度介於約 1,883–3,267 字元，均已通過 live HTTP／canonical／noindex 稽核；沒有在這個簡單 lexical 訊號中看到「幾乎是同一頁」的明顯組合。

## 判讀

1. 目前沒有證據支持「六頁因字面近重複而必然未收錄」；不能因此宣稱內容品質已被 Google 接受。
2. 最高重疊的是企業大量衣物與全市收送，兩者確實共享收送／衣物語境；這支持維持單一內鏈變因與清楚意圖邊界，不同時改寫兩頁。
3. 下一個最有資訊量的資料仍是新鮮 GSC URL Inspection、非品牌 query/page exposure 與 GA4 organic／LINE；未到排程窗口前不手動重抓。

## 控制

- 本輪不改 `src/`、`scripts/`、live HTML、schema、Sitemap 或發布紀錄。
- 不因自訂相似度分數重送 IndexNow、要求建立索引或新增 URL。
- 7／28 日判定仍以第一方 GSC／GA4 資料為準；資料缺失保持 `PENDING`／`INCONCLUSIVE`。
