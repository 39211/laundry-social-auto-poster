已依 A5 卡完成交付，**本地合成演練 PASS**。只新增 `ops/` 與指定兩份文件；既有追蹤檔、Git 暫存區均未改動，沒有 git commit。

已交付四支腳本：備份、驗證後還原、僅輸出回退指令，以及每日 03:30 備份排程註冊；另附共用函式、測試與完整原始輸出。

驗證結果：

- **Pester 28／28 通過、零失敗、零跳過，exit 0**，完整測試耗時 **32.73 秒**。
- 在 worktree 的 `ops/_tmp/` 完成「備份 → 改壞 → 還原」，12 個合成檔案的 SHA-256／大小全同；也實際從 `pre-restore` 再還原既有檔。
- Python 獨立讀回 **12 個還原檔、12 個 pre-restore 檔**，逐檔 SHA／大小全部通過。
- DryRun／WhatIf 零寫入、保留 14 份、同分鐘名稱唯一、junction／路徑跳脫防護與排程替身測試均通過。同家族唯讀複審確認無剩餘阻擋問題。

交付入口：

- [A5-RESULT.md：完整結果、原始輸出、首次真實備份指令](C:/Users/cyc39/AI-Lanes/a5/repo/docs-internal/cards/A5-RESULT.md)
- [RUNBOOK-RECOVERY.md：四種復原情境與成功確認方式](C:/Users/cyc39/AI-Lanes/a5/repo/docs-internal/RUNBOOK-RECOVERY.md)
- [獨立 SHA／大小讀回證據](C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/final-independent-readback.json)
- [最終檔案範圍與 SHA-256 清單](C:/Users/cyc39/AI-Lanes/a5/repo/ops/evidence/final-scope.json)

**未對現役路徑執行、未讀真 secrets、未註冊真排程、未啟停服務。正式 30 分鐘 RTO 仍為 `UNMEASURED`**；首次真實備份指令已放在 RESULT，留由總指揮執行。

九格✓