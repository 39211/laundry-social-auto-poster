# Index-growth accepted resolver default gap — 2026-08-31

## Isolated mutation

在隔離 review worktree 以完整 24 頁 catalog 執行：只刪除 `suede-shoe-cleaning` 的 `publish_state` 欄位，其餘內容與來源不變，並以 `today=2026-08-31` 驗證。

## Result

| Check | Result |
|---|---:|
| Catalog pages | 24 |
| `validateIndexGrowthPages` | `ok=true` |
| `resolveAcceptedIndexGrowthPages` output | 23 |
| Mutated page present in output | `false` |

## Interpretation

validator 使用 `(publish_state ?? "accepted")`，把缺省值當 accepted；resolver 卻只篩選 `page.publish_state === "accepted"`。因此同一份 catalog 會出現「驗證通過但輸出少一頁」的靜默不一致，直接影響 accepted count、sitemap 與 HTML 投影。

## Decision

`REWRITE REQUIRED`。必須指定單一 accepted resolver／投影權威，並用這個缺省欄位突變證明 validator、count、sitemap、HTML 同步失敗與還原；未修前不部署、不把 catalog 24 頁計入 live 56／100。

本測試只在隔離 worktree 執行；沒有修改 `src/`、`scripts/`、排程、發布紀錄或 live 網站。
