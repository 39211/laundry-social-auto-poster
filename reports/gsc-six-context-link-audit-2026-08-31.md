# GSC 六頁情境內鏈 live audit（2026-08-31）

## 範圍

以 `docs-internal/index-growth-100-six-page-link-brief-2026-08-31.md` 的 14 個建議目標為準，逐頁讀取六個 live HTML，檢查目標 href 是否存在，再對已存在的目標做 live HEAD。這是 read-only 檢查。

## 結果

| 來源頁 | 建議目標 | href 是否存在 | 目標 live |
|---|---|---:|---:|
| 全市收送 | `services/taichung-laundry-price-list.html` | 是 | 200 |
| 全市收送 | `guides/taichung-laundry-service-search.html` | **否** | — |
| 大量衣物 | `local/zhongke-office-laundry.html` | 是 | 200 |
| 大量衣物 | `services/taichung-citywide-laundry-pickup.html` | 是 | 200 |
| 價目表 | `guides/white-shoe-yellowing.html` | **否** | — |
| 價目表 | `guides/luxury-dry-cleaning.html` | **否** | — |
| 西屯洗衣 | `guides/taichung-laundry-service-search.html` | 是 | 200 |
| 西屯洗衣 | `local/fengjia-laundry-pickup.html` | 是 | 200 |
| 搜尋指南 | 五個服務／在地頁目標 | 皆是 | 200 |
| 布品收納 | `guides/bedding-storage-check.html` | 是 | 200 |

彙總：建議 href 存在 `11/14`；已存在的 11 個目標 live HTTP 200 `11/11`。缺口集中在全市收送頁 1 條、價目表 2 條；不是 live 404。

## 判讀與實驗邊界

- 三條缺口可以在授權 PR 中以正文情境段落補上，anchor 必須描述下一個判斷，不得只加到導覽或 footer。
- 目標頁均已 live 200；補連結不會新增 URL，也不應觸發重複 IndexNow。上線後才重新檢查 crawler、GSC inspection 與 7 日 impressions。
- 西屯頁與搜尋指南目前已有正文中相同意圖的連結；維持一個主變因，避免同時改寫 snippet、標題與多條內鏈而無法判斷效果。
