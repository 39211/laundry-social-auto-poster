# GSC discovered-page diagnostic — 2026-08-31

## Evidence set

交叉比對：

- `data/insights/gsc-index/2026-08-31.json` 的 coverage state；
- `output/operations/indexing-push-2026-08-31.json` 的 live `text_length`／`internal_links` audit。

這是最後已知 GSC 快照；它早於 live sitemap 更新 12 小時 23 分 31 秒，因此不能當成更新後即時索引因果證明。

## Distribution

| GSC state | Pages | Median stripped text | Median internal links | Range of text |
|---|---:|---:|---:|---:|
| Discovered - currently not indexed | 6 | 2,244.5 | 25 | 1,679–3,110 |
| Submitted and indexed | 26 | 1,431.5 | 27 | 961–51,938 |

## Interpretation

六個未收錄頁並不是最薄的頁面；它們的正文中位數反而高於已收錄組，內鏈中位數只少 2 條。這不能證明內鏈是唯一原因，但足以否定「只加字數就會收錄」的假設。當前最有證據的動作是：

1. 補正文情境內鏈到已 live、HTTP 200 且意圖不同的頁面；
2. 讓 GSC 快照在 sitemap 更新後重新產生，再觀察 crawl／inspection；
3. 以真實 query、landing session、LINE click 驗證需求，不以字數、IndexNow 200 或 URL 數量代替收錄證據。

## Decision

`PENDING`：不可由此資料宣稱已找到單一排名原因，也不應批量擴寫六頁或建立城市變體。此結果支持既有 [six-page live link gap](six-page-live-link-gap-2026-08-31.md) 與 freshness 修正，待 production gate 修復並取得新鮮 GSC evidence 後再判定。
