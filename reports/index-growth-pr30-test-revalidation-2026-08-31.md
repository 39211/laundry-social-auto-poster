# PR #30 測試重驗（2026-08-31）

## 結果

在 PR #30 sparse checkout（HEAD `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`）重新執行：

| 檢查 | 結果 | 說明 |
|---|---|---|
| `npm.cmd run typecheck` | PASS | `tsc --noEmit` 正常結束 |
| 首次 `npm.cmd test` | BLOCKED_BY_ENV | 測試程序未設定 `PUBLIC_SITE_BASE_URL`，於 import 階段拋出既有環境錯誤 |
| 設定 `PUBLIC_SITE_BASE_URL=https://sixiangjialaundry.com` 後 `npm.cmd test` | PASS | 87 test files passed；710 tests passed、16 skipped（726 total） |

測試只在該命令的 process environment 讀取 production host，沒有寫入 repo、`.env`、排程或 live 網站。

## 判讀

- 這次重驗證明 PR HEAD 在正確必要環境變數下可通過目前套件測試；不等於已通過 production host gate、claim-level provenance、影像安全、live link closure 或獨立複審。
- 因此 PR #30 的 release 狀態仍為 `NOT READY`；不因測試綠燈自動部署、不更新 sitemap、不重送 IndexNow。

