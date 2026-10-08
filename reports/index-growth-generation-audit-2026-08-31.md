# Index-growth-100 generation audit — 2026-08-31

## 隔離執行

- Worktree：`C:\Users\cyc39\AppData\Local\Temp\sxj-index-growth-review-20260831`
- Commit：`f47d5c1558d295716f0fa2eb9cb274621ce56714`
- Command：`npm.cmd run generate-public-site -- --root <isolated-root> --base-url https://sixiangjialaundry.com --site-base-url https://sixiangjialaundry.com --image-base-url https://sixiangjialaundry.com`
- Exit：`0`

## 靜態輸出結果

- Sitemap：56 unique URL（32 baseline + 24 accepted candidate），0 duplicate，0 future URL。
- Sitemap 中每個 URL 都有對應 HTML 檔：56/56。
- Canonical：56/56 present。
- JSON-LD：56/56 present。
- 去除 script/style/markup 後正文長度最短 873 字元，0 頁低於 700 字元。
- 每個 guide 的 `<main>` 至少含 12 個可抓取內部連結；這是輸出形態檢查，不是 Google 已抓取證據。
- 來源 validator：`catalog=24`、`accepted=24`、`ok=true`、`failures=0`（`today=2026-08-31`）。
- 隔離輸出 HTML 內部 href audit：1,497 個引用中 1 個指向未帶入隔離樹的既有圖片 `assets/services/fabric-storage-hero-product.png`；同一 live URL 實測 HTTP 200。這是刻意不複製 646 MB 資產樹的 overlay 注意事項，不是候選 HTML 404。

## 尚未通過的品質條件

- 這次只證明隔離生成器可產出 56 頁；live sitemap 仍是 32，24 個候選 URL 尚未部署。
- Luna 獨立審查仍判 `REWRITE`：production host gate、單一 resolver、claim-level provenance、revision/hash enforcement、真 mutation gate 尚未滿足。
- `clothing-mold-airing` 的安全內容仍需重寫或降為 draft；因此不能把 24 頁全數視為可發布。
- 生成成功、HTTP 200、IndexNow 200 或 sitemap 數量都不能直接推論 Google 收錄；部署後仍須以 GSC inspection/indexed evidence 驗證。
- `ok=true` 只代表目前 validator 規則通過；Luna 的獨立 review 已指出 validator 尚未覆蓋不可變 provenance、production host gate、實際 mutation 與安全內容，因此不能把它當成最終發布 gate。
- 依安全審查的 fail-closed 判定，`clothing-mold-airing` 暫不算可部署頁；在安全重寫通過前，第一批的保守上限是 23 頁（live sitemap 至多 55），不是 24 頁／56。

## In-memory mutation evidence

在同一隔離 worktree、`today=2026-08-31` 下對 catalog 做不落盤 mutation：

| Mutation | 目前 validator 結果 | 判讀 |
|---|---|---|
| 移除 `citation_answer` | **FAIL**（`citation-fallback`、`citation-lead`） | 這個條件有被抓到 |
| 改用另一個已存在的合法 `source_ref` | **PASS** | claim-level provenance 仍可被錯配 |
| 改成格式合法但任意的 `content_revision`（`2026-08-30#999`） | **PASS** | revision 尚未與不可變內容綁定 |
| 替換一段足夠長的 section body | **PASS** | 正文改動沒有 production content hash gate |
| 只改 description 或 keywords | **PASS** | metadata 改動也沒有 hash／revision 失效 |

因此「validator 24/24 綠」不能升格為最終品質 gate；上述三個 PASS mutation 是 PR #30 必須補上的紅燈測試。

## Provenance distribution check

- 24 頁共有 869 個 claim-level `source_refs`，但全批只使用 20 個 registry keys。
- 每頁的 citation、每個 step、每個 section、每個 FAQ 都重複同一組頁級 refs（例如 `suede-shoe-cleaning` 的 44 個 claim refs 全是同 4 keys）。
- Registry record 目前只有 `id/kind/origin/note`，沒有 locator、內容摘要或 immutable hash；因此下一版必須把來源綁到每一個 claim，而不是只驗 key 存在。
