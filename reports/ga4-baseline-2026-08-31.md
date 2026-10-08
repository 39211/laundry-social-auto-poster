# GA4 索引增長實驗基線（2026-08-31）

## 範圍

只讀整理目前已存在的 `data/insights/ga4-traffic/` 日檔（2026-08-26～08-30）。今日 08-31 檔案尚未到晚間排程，故不代跑、不補寫。

## 可量測數字

| 日期 | sessions | engaged sessions | AI sessions | Google organic sessions | AI engaged sessions |
|---|---:|---:|---:|---:|---:|
| 2026-08-26 | 17 | 7 | 0 | 0 | 0 |
| 2026-08-27 | 10 | 0 | 0 | 1 | 0 |
| 2026-08-28 | 4 | 0 | 0 | 0 | 0 |
| 2026-08-29 | 5 | 2 | 0 | 0 | 0 |
| 2026-08-30 | 6 | 0 | 0 | 0 | 0 |
| **合計（5 日）** | **42** | **9** | **0** | **1** | **0** |

`ai_landing_pages` 在這 5 個檔案均為空陣列。GA4 彙總目前沒有 `LINE click` 欄位；LINE click 應保持 `null/unmeasured`，不能由 sessions 推算。

## 判讀與限制

- AI sessions `0` 是 GA4 檔案明確回報的值；不是把缺檔當成 0。08-31 仍是 `unmeasured`，等待排程。
- Google organic 只有 2026-08-27 的 1 session；樣本太小，不能判定 SEO 趨勢或收錄效果。
- 這份基線只用於 7／28 日實驗比較，不能替代 GSC indexed count、URL Inspection 或 live sitemap 證據。

