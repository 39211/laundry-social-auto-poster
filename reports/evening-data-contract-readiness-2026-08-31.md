# 晚間 GA4／GSC 資料契約 readiness（2026-08-31）

## 時點

檢查時間 2026-08-31 19:53（Asia/Taipei），尚未到 23:10 GA4／23:15 GSC Windows 排程；今日檔案不存在，因此本報告不執行補跑，也不把缺值寫成 0。

## 已有檔案的欄位檢查

| 資料 | 最新檔案 | 必要欄位觀察 | 判定 |
|---|---|---|---|
| GA4 | `data/insights/ga4-traffic/2026-08-30.json` | `totals.sessions`、AI／Google organic、`by_source.engaged_sessions` 存在；根層沒有 `totals.engaged_sessions`；沒有 `line_click` | `PARTIAL_SCHEMA`；engaged sessions 可由來源列彙總，LINE click 保持 `null/unmeasured` |
| GSC | `data/insights/gsc/2026-08-27.json` | `totals.clicks`、`impressions`、`ctr`、`position` 與 query/page arrays 均存在 | `SCHEMA_PASS`；檔案日期落後，不代表今日資料 |

## 晚間執行規則

1. 排程產生今日 GA4 檔後，先確認 sessions、來源列 engaged sessions、AI／Google organic 與 `ai_landing_pages`；沒有 `line_click` 就保留 `null`。
2. 只有今日 GA4 檔缺失、失敗或 freshness 不合格，且沒有相同 writer 執行時，才依 heartbeat 規則補跑；不能因欄位缺少而自行造欄位或補 0。
3. GSC OAuth 若失效，標為 `blocked/unmeasured`，不建立或更新憑證；GSC 缺檔也不推論為零曝光。
4. 7／28 日實驗判定前，先確認同一欄位契約與日期窗，避免把 schema 差異誤當流量變化。

## 目前狀態

`WAIT_FOR_SCHEDULE`。這是資料品質準備證據，不是 GA4/GSC 成效結果；今日尚未執行 `ga4-ai-traffic`，也未補跑 GSC。
