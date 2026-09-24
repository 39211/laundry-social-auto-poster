# GSC 索引趨勢重建（2026-09-02）

## 結論

「8/21 後完全沒有新增」不精確：8/21–8/26 曾由 10 增至 20，8/30 快照為 26；但 8/31 維持 26，9/1 反而降為 25。9/1 同時出現 1 頁 `Crawled - currently not indexed`，所以目前是「最近幾天停滯並有一頁退回」，不是單純 sitemap 沒提交。

## 快照序列

| Inspection 日期 | GSC 已知 URL | Indexed | Discovered 未索引 | Crawled 未索引 |
|---|---:|---:|---:|---:|
| 2026-08-21 | 24 | 10 | 11 | 0 |
| 2026-08-22 | 24 | 19 | 5 | 0 |
| 2026-08-23 | 25 | 20 | 4 | 0 |
| 2026-08-24 | 25 | 20 | 5 | 0 |
| 2026-08-25 | 25 | 20 | 5 | 0 |
| 2026-08-26 | 26 | 20 | 5 | 0 |
| 2026-08-30 | 32 | 26 | 5 | 0 |
| 2026-08-31 | 32 | 26 | 6 | 0 |
| 2026-09-01 | 32 | 25 | 6 | 1 |

8/27–8/29 沒有 inspection 快照檔，因此不能把那段空白解讀成「沒有變化」。

## 已確認的狀態變化

`https://sixiangjialaundry.com/local/fengjia-laundry-pickup.html` 在 8/31 是 `Submitted and indexed`，9/1 變成 `Crawled - currently not indexed`。這是目前唯一能由相鄰快照直接定位的 indexed → crawled-not-indexed 變化；原因尚不能由 inspection 摘要推定。

## 今日方策與控制

1. 先等 9/2 23:15 的新鮮 inspection，重點確認逢甲頁是否回到 indexed，以及 6 個 discovered 頁是否有任何狀態移動。
2. 不因單日 -1 就重建頁面、改 canonical 或大量提交；若逢甲頁連續兩個新鮮快照仍 crawled-not-indexed，才設計一個單一內容／意圖 treatment。
3. Sitemap 33 URL、IndexNow 200 與 HTTP 200 只證明可發現／可抓取，不替代 indexed 狀態。
4. 7／28 日實驗判定仍需非品牌 GSC exposure、GA4 organic 與 LINE；缺資料保留 `null`。

## 證據

- `data/insights/gsc-index/2026-08-21.json` 至 `2026-09-01.json`
- `reports/index-growth-goal-audit-2026-09-02.md`
- `output/operations/sitemap-health.json`

本輪只讀快照，未修改 `src/`、`scripts/`、live HTML、Sitemap、schema 或發布紀錄。
