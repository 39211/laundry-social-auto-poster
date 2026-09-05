# PR #30 視覺標示修正規格（2026-08-31）

這份規格只供 PR 分支實作者使用；本輪沒有修改 `src/`、`scripts/` 或隔離輸出。

## 已重現的問題

第一 cohort 11 頁的隔離 HTML 都使用同一張 `shoe-bag-care-hero-product.png`，以下可見／結構化欄位都出現「鞋包清潔前的包角、鞋面與皮革檢查主圖」：

- `<img alt>`
- `<figcaption>`
- JSON-LD `primaryImageOfPage.caption`
- Open Graph／Twitter `image:alt`

`data/asset-ledger.json` 沒有這張圖的 `real-case` provenance，因此這個「清潔前」標籤不能代表每頁的實拍前狀態。

## 最小修正

當頁面沒有已核實的 `real-case` provenance 時，所有上述欄位統一使用中性描述，例如：

> 鞋包材質與痕跡檢查示意圖

頁面標題、answer box 與正文的服務判斷可以保留；不得新增「清潔前／清潔後」「案例」「恢復成果」等圖片暗示。若日後有站主核准且 ledger 完整的真實案例，才可針對該頁改成與素材一致的描述。

## 驗收測試

1. 11 個第一 cohort 頁面在未核實 provenance 時，`img alt`、`figcaption`、JSON-LD caption、OG／Twitter alt 均不得包含 `清潔前`、`清潔後`、`案例` 或 `恢復`。
2. 將任一頁的 provenance 標記移除或把 caption 改回「清潔前」時，production validator 必須 fail；還原同一變更後回綠。
3. 若頁面使用已核實的 `real-case` 素材，測試要驗證該素材 path、授權／拍攝紀錄、claim locator 與 SHA-256 綁定，不能只驗檔案存在。
4. 完成後重新做可見文字抽取、JSON-LD parse、link closure、canonical、HTTP 200 與 live overlay 稽核；所有結果通過前維持 `NOT READY`。
