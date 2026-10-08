# live 32 頁正文 boilerplate overlap audit（2026-08-31）

## 方法

- 逐頁 GET sitemap 內 32 頁，取 `<main>` 後移除 header／nav／footer／script／style，再抽取 `p`、`li`、`h2`、`h3` 文字區塊。
- 只計算長度至少 60 字元且在另一頁完全相同的區塊；以重複區塊字元數／該頁抽取區塊字元數作為診斷比例。
- 這是內容差異性的診斷訊號，不是 Google spam 判決，也沒有改 live。

## 結果

- 32 頁中發現 27 個跨頁完全重複的 60+ 字元區塊。
- 頁面重複字元比例最高的樣本：

| 頁面 | 抽取區塊 | 重複比例 |
|---|---:|---:|
| `guides/shirt-suit-dry-cleaning.html` | 2 | 1.00 |
| `guides/leather-jacket-care.html` | 3 | 1.00 |
| `guides/school-uniform-care.html` | 3 | 1.00 |
| `guides/down-jacket-cleaning.html` | 4 | 0.79 |
| `guides/luxury-bag-mold.html` | 5 | 0.61 |
| `guides/dry-cleaning-guide.html` | 5 | 0.52 |
| `guides/taichung-laundry-service-search.html` | 7 | 0.45 |

重複區塊主要是處理界線、材質風險與收送事實；部分共用是合理的品牌／安全內容，不能只因重複就刪除。

## 判讀與下一步

- 這提供一個比 title／meta 重複更細的內容品質假設：短 guide 若大部分可讀正文是共用段落，Google 可能較難判斷其獨立價值；目前只能標為 `REVIEW`，不能直接歸因於未收錄。
- 下一個安全實驗是為每個目標頁補一段與其查詢意圖直接相關、可驗證且不重複的判斷／限制，再以 7／28 日 GSC 與 GA4 觀察；不可用關鍵字堆疊或地名複製代替。
- 先處理 GSC 六頁與第一 cohort 的 snippet／內鏈／provenance gate；沒有授權 PR 修正前不改 live source。
