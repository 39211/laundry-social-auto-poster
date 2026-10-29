# A5 可恢復性實作與驗收卡

Outcome：交付可參數化的備份、驗證後還原、回退指令與每日備份註冊腳本；在本工作樹的 `ops/_tmp/` 用合成資料完成真實檔案演練。

Owner／最終 checker：Claude 總指揮；maker：本線 Codex。程式複審使用唯讀 reviewer，沒有外部艦隊派工。授權：只新增 `ops/`、兩份指定文件；不操作現役、不提交、不註冊排程、不啟停服務。最新使用者範圍限制優先，因此本線的開工卡與紀錄保存在這些檔案，不另寫 Vault。

實作順序：

1. `ops/tests/Recovery.Tests.ps1` 與 `ops/test-recovery.ps1`：Pester 3.4，固定假來源與假排程 XML，先觀察缺少實作的失敗。
2. `ops/Recovery.Common.ps1`：共用路徑邊界、SHA-256／大小驗證、排程 XML 與 MANIFEST 驗證。拒絕路徑跳脫、重複目的地及內部 reparse point。
3. `ops/backup-sxj-live.ps1`：預設正式路徑但本線一律覆蓋參數；DryRun 不建立目錄／檔案；完整複製驗證後才完成 MANIFEST 與保留最近 14 份。
4. `ops/restore-sxj-live.ps1`：先驗全部 payload，再建立已驗證的 pre-restore 備份，最後依 Only 還原。fixture tasks 只寫臨時 XML；正式 tasks 在 ShouldProcess 通過後才 Register。
5. `ops/rollback-code.ps1`：只輸出 tag 驗證、乾淨工作樹檢查、停機、detach 回退與 Probe 的指令。`ops/register-backup-task.ps1`：03:30；WhatIf 不執行註冊。
6. 執行 Pester 與原始輸出留存，依實際錯誤修正；唯讀複審後完成 RUNBOOK 與 RESULT。

驗收焦點：backup→改壞→restore 全檔 SHA／大小一致；DryRun 與 WhatIf 零寫入；Only 選擇；所有 payload 先驗後寫；pre-restore 可核回；保留 14 份且保護不明目錄／連結；XML 範圍與巢狀 TaskPath；變造 MANIFEST 不可寫到目的地外；錯誤必須非零。

限制：合成演練時間不能證明正式 30 分鐘 RTO；不檢查真 secrets、不執行正式排程或服務。真機驗收由總指揮在另行授權的維護時段完成。

## r2 開工卡（2026-10-30）

Outcome：預設排除 `*.lock`／`*.pid`／`*.tmp`；一般來源讀取遇到 IOException／UnauthorizedAccess 時略過並記錄 path／reason，只有 secrets／`.env` 讀取失敗中止；DryRun 與實際備份均顯示 skipped 數。

Owner／最終 checker：Claude 總指揮；maker：本線 Codex。Authority：本次明確授權的 `ops/` 與兩份文件；不提交、不對現役執行正式備份、不另寫 Vault。原有未追蹤交付檔保留，r1 證據不覆蓋。

驗收：新增 Pester r2 案例先紅後綠；使用 FileStream／FileShare.None 真實獨占鎖、UnauthorizedAccess 讀取邊界注入、PowerShell 子程序 exit code／stderr、DryRun 檔案樹快照與 MANIFEST／payload 獨立讀回。沙箱拒絕 DACL 變更，未把該測試環境錯誤當成程式紅燈。執行完整維運 Pester 集合；證據另存 `ops/evidence/r2-*`。正式資料量、服務與 RTO 不在本輪驗收範圍。
