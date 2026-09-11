# 私享家每日 SEO／GA4 檢查：2026-09-07

## 實際完成

- 核對既有 ga4 heartbeat：ACTIVE，每日 Asia/Taipei 08:45、23:45；未建立重複任務。
- 讀取今日 IndexNow、昨日曝光審查與 GA4、最近 URL inspection；保留既有未提交工作。
- 即時讀取 sitemap：89 個 URL。今日既有 IndexNow 報告記錄成功提交 5 URL、HTTP 200；本回合沒有再次提交。
- 確認沒有 GSC／GA4 Node writer 執行後，因昨日 GSC collection failed，補跑一次 gsc-search-analytics -- --no-fail。結果 unmeasured：Token has been expired or revoked。沒有變更 OAuth，也沒有反覆重試。

## 已量測與未知

| 指標 | 9/5 快照 | 9/6 快照 |
|---|---:|---:|
| GA4 sessions | 19 | 5 |
| Google organic sessions | 2 | 1 |
| AI referral sessions | 0 | 0 |

以上是當日約 23:10 抓取值，非最終結算。樣本少，不能判定 SEO 改動造成下降。

最近 inspection 生成時間為 9/6 02:11（台北），89 URL 中 35 indexed、41 discovered not indexed、12 unknown、1 excluded by noindex；不是今日即時收錄數。今日 GSC impressions/clicks/CTR/indexed count 一律 null／unmeasured，不沿用曝光審查中的舊零值。

證據：output/operations/indexing-push-2026-09-07.json、output/operations/seo-exposure-review-2026-09-06.json、data/insights/ga4-traffic/2026-09-05.json、2026-09-06.json、data/insights/gsc-index/2026-09-06.json。

## 今日方策與判定

- 現象：流量低，GSC 成效蒐集授權失效，無法驗證新頁曝光成效。
- 可能原因：OAuth 失效導致量測中斷；流量下降原因尚未證實。
- 今日優先：恢復既有 GSC 帳號授權後取得新鮮 query/page 資料，優先選洗鞋、洗包、在地收送的既有服務頁。尚未執行新內容實驗。
- 固定控制：不新增相似 URL、不改標題與答案框、不重複提交、不改 src/scripts/Windows 排程與社群發布紀錄。
- 第 7 日：以經記錄的實際部署為 Day 0，比較同一 URL cohort 抓取與非品牌曝光；沒有完整資料則 PENDING。
- 第 28 日：以同一 cohort 的完整前後窗口，核對非品牌曝光／點擊、自然搜尋工作階段與 LINE 點擊；資料缺漏或無對照時 INCONCLUSIVE，不宣稱因果。

今日新增的是失效原因的直接證據；尚無證據可宣稱新增 Google 收錄或曝光。IndexNow 成功不等於 Google 已收錄。
