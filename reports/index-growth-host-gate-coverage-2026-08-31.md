# Index-growth production host-gate coverage — 2026-08-31

## Isolated check

在 review worktree 以 `deployment=true` 呼叫 `generatePublicSite`，傳入 `https://evil.example` 作為 site／image base URL。

結果：generator 在寫檔前回傳錯誤：

`production public site base URL must be https://sixiangjialaundry.com; received https://evil.example`

程序 exit `0`（錯誤由測試 harness 捕捉），表示 generator 的 invalid-host gate 目前會 fail closed。

## Coverage gap

靜態檢查 `src/publishPages.ts` 沒有 `assertProductionPublicSiteBaseUrl` 或 `PRODUCTION_PUBLIC_SITE_BASE_URL` 的 import／usage。該 entrypoint 直接依 config、`root` 與 `rootPagesRepo` 執行 add/commit/push，沒有同一個 exact-host gate 的可見呼叫。

## Decision

`PARTIAL / REWRITE REQUIRED`：generator gate 有效，但不能推論 publish entrypoint 也受保護。修復前不得把 preview／fixture root 視為可部署來源；production gate 必須在所有會寫入 Pages 的 entrypoint 共用同一個 host assertion，並以錯誤 host mutation 驗證 fail、還原後回綠。

本檢查沒有執行 push、commit、部署或 live 變更，也沒有修改 `src/`、`scripts/`、排程、發布紀錄。

## 16:52 remote HEAD runtime recheck

- 在 PR #30 sparse clone、設定正式 base URL 環境後，以 `generatePublicSite({ deployment: true })` 實測：`https://evil.example` 在任何讀檔／寫檔前被拒絕；錯誤為 `production public site base URL must be https://sixiangjialaundry.com`。
- 以合法 `https://sixiangjialaundry.com` 通過 host gate 後，才進入下一步並因暫存 root 缺少 `data/business-profile.json` 停止；這證明 gate 順序正確，但不代表 publishPages entrypoint 已受保護。
