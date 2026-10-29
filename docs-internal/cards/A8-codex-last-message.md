已依 A8 完成，**僅新增指定三檔；Pester 最終 26／26 通過**。本次未執行部署、未改動現役目錄、未停起現役程序、未註冊排程，也未 stage、commit 或 push。

- [ops/deploy-ai-linebot.ps1](/C:/Users/cyc39/AI-Lanes/integ/repo/ops/deploy-ai-linebot.ps1)：完成預檢、SHA 備份與複製驗證、離線測試、啟動驗收、自動／手動回退，以及預設關閉的排程註冊開關。`DryRun` 包含不寫 log 的零寫入檢查。
- [ops/tests/DeployAiLinebot.Tests.ps1](/C:/Users/cyc39/AI-Lanes/integ/repo/ops/tests/DeployAiLinebot.Tests.ps1)：使用假 Target、假 launcher、假程序與 HTTP 邊界；子程序執行限定在 TestDrive 內。
- [docs-internal/cards/A8-RESULT.md](/C:/Users/cyc39/AI-Lanes/integ/repo/docs-internal/cards/A8-RESULT.md)：包含用法、紅綠測試紀錄、驗證結果及總指揮現場判斷事項。

驗證結果：

- 初版 **24 項先紅後綠**；再補兩項「預檢失敗留 log」及「手動回退保護後續編輯」，確認失敗後修正，最終 **26 通過、0 失敗、0 跳過，37.01 秒**。
- 兩支腳本 PowerShell parser 均為 **0 errors**；真正 CLI 的無效路徑 `DryRun` 正確回傳 exit 1。
- 真實 Git 唯讀確認：卡指定差異目前為 **32 檔**，runner 動態取得清單。最終工作樹僅有上述三個新增檔，既有 tracked 檔與暫存區均無變更，HEAD 維持 `ca9fea2e`。

實機部署仍需總指揮確認 watchdog 的五分鐘時間窗、A8 要求的 healthz PID 嚴格相等，以及是否啟用 `-RegisterTasks`。部分排程註冊失敗時，排程不會隨檔案回退自動撤銷；細節已寫入結果報告。

九格缺 4／9：依本次僅三檔限制，留痕保存在 `A8-RESULT.md`，未另寫 Vault。

