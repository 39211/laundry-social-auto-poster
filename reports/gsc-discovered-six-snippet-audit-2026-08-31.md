# GSC「已發現未收錄」六頁 live snippet 稽核（2026-08-31）

## 範圍

來源是 `data/insights/gsc-index/2026-08-31.json` 的六個 `Discovered - currently not indexed` URL。每頁以 live HTTPS GET 讀取，不改 HTML、不重新提交。

## 結果

| live 頁面 | HTTP | 正文字元 | meta 品牌先行 | answer box 品牌先行 | canonical | JSON-LD | 下一個安全實驗 |
|---|---:|---:|---:|---:|---:|---:|---|
| `services/fabric-storage.html` | 200 | 2,852 | 是 | 否 | self | 可解析 | 將收納前乾燥判斷置於 snippet 首句；保留檢查流程 |
| `services/taichung-xitun-laundry.html` | 200 | 3,298 | 是 | 是 | self | 可解析 | 把西屯服務範圍答案前置，避免品牌地址先佔摘要 |
| `services/business-bulk-laundry.html` | 200 | 2,144 | 是 | 否 | self | 可解析 | 先寫批量交件判斷，再保留合法服務事實 |
| `services/taichung-citywide-laundry-pickup.html` | 200 | 2,638 | 否 | 是 | self | 可解析 | 固定目前答案先行版本，觀察 crawl／impressions |
| `services/taichung-laundry-price-list.html` | 200 | 1,857 | 否 | 否 | self | 可解析 | 保持參考價免誤解，測試答案先行摘要 |
| `guides/taichung-laundry-service-search.html` | 200 | 2,115 | 是 | 是 | self | 可解析 | 將分流條件前置，不增加城市複製頁 |

彙總：六頁 HTTP 200、canonical self、JSON-LD 可解析與 noindex `0/6`；meta description 品牌先行 `4/6`，answer box 品牌先行 `3/6`。

## 判讀

- 這六頁不是被 robots 或 HTTP 阻擋；目前 GSC 狀態是「已發現未收錄」，因此優先變因應是 snippet／正文情境內鏈與內容差異，而不是再增加 sitemap 提交次數。
- `taichung-citywide-laundry-pickup` 與 `taichung-laundry-price-list` 的 meta 已答案先行，但 answer box 並非都同步；實驗必須分別驗 meta、OG、Twitter 與頁面答案，不可只看其中一個欄位。
- 不建立地名複製頁、不虛構批量價格或案例；每次只改一個 snippet／情境內鏈變因，7 日觀察 crawl／impressions，28 日且資料完整才可判定。

## 邊界

本稽核證明可抓取與摘要排列問題，不證明 Google 已收錄。修正仍需在授權 PR 分支通過 resolver、provenance、safety、host gate、mutation 與獨立複審後，才可 HTML-only overlay；部署後再做 GSC inspection 與一次 IndexNow。

## 20:20 live snippet recheck

- 六頁再次以 live HTTPS GET 核對：HTTP 200 `6/6`、self-canonical `6/6`、JSON-LD 可解析 `6/6`。
- answer box 品牌／地址先行 `3/6`：`taichung-citywide-laundry-pickup`、`taichung-xitun-laundry`、`taichung-laundry-service-search`。
- meta description 品牌／地址先行 `4/6`：`fabric-storage`、`business-bulk-laundry`、`taichung-xitun-laundry`、`taichung-laundry-service-search`。
- 此 recheck 只確認目前 snippet 表面狀態；不改 source、不部署、不重送 IndexNow，主變因仍是答案先行與情境內鏈。

### 20:21 count correction verification

逐頁腳本重跑後確認彙總為 answer brand-leading `3/6`、meta brand-leading `4/6`；已修正上一段的 meta 計數，後續以此值為準。
