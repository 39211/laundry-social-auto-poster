# 任務卡 A5:ai 電腦現役系統可恢復(備份、還原、回退,30 分鐘內)

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\a5\repo 分支 `feat/a5-recoverability`
只能新增 `ops/`(新目錄)底下的檔、`docs-internal/RUNBOOK-RECOVERY.md`、`docs-internal/cards/A5-RESULT.md`。**不連店機、不碰現役目錄 C:\Users\cyc39\laundry-repo、不執行任何備份到真路徑、不註冊排程、不停起程序。**

## 現況(已查證)
- 現役目錄 `C:\Users\cyc39\Documents\New project 5`(junction `laundry-repo`),分支 `release/sxj-live-2026-10` 為基線,tag `sxj-live-2026-10-29`。
- 不在 git 的重要東西:`secrets/`(LINE/Meta/Google token)、`.env`、`data/*`(大部分被 .gitignore:leads、posted-log、approved-log、photos、staff-inbox.jsonl、arrival-state.json、customer profile…)、`%LOCALAPPDATA%\line-bot\`(pid/log/tunnel_events)、`C:\FXwash\eHank.mdb` 副本、Windows 排程 40 多個(`Laundry-*`、`AI-Daily-*`、`SXJ-*`)。
- 服務:`line-bot/run_line_bot.ps1`(watchdog;`-Probe`/`-Stop`),目前 line_webhook 與 staff_server 各有兩個程序(pid 檔過期,Probe 回 exit 1,見 cards/A1-RESULT.md r2 段)。
- 磁碟規則:大檔與生成物放 D:;備份目的地用 `D:\AI-Lanes-work\_backups\sxj-live\`。

## 要做的事
1. `ops/backup-sxj-live.ps1`:
   - 打包 `secrets/`、`.env`、`data/`(排除 photos 與 video-* 大目錄)、`line-bot/*.json|*.txt`(public_base、richmenu-id、staff-target 等狀態檔)、`%LOCALAPPDATA%\line-bot\*.jsonl`、`C:\FXwash\eHank.mdb`、以及 `Get-ScheduledTask | Export-ScheduledTask` 的 XML(只有 `Laundry-*`、`AI-Daily-*`、`SXJ-*`)到 `D:\AI-Lanes-work\_backups\sxj-live\<yyyyMMdd-HHmm>\`,寫 `MANIFEST.json`(每檔 SHA-256、大小、來源路徑)。
   - 保留最近 14 份;`-DryRun` 只列清單不複製;所有路徑可用參數覆蓋(測試用)。
2. `ops/restore-sxj-live.ps1 -From <備份目錄> [-Only secrets|data|state|tasks|mdb]`:逐檔比對 MANIFEST 後還原到指定根目錄(預設現役,測試時指到臨時目錄);還原前先把現有檔打包成 `pre-restore-<ts>`;排程用 `Register-ScheduledTask -Xml`(`-WhatIf` 支援)。
3. `ops/rollback-code.ps1 -ToTag <tag>`:`git worktree` 或 `git checkout --detach` 到指定 tag 的**說明與指令**,搭配 `run_line_bot.ps1 -Stop` / 啟動;不要在本卡執行。
4. `ops/register-backup-task.ps1`:每日 03:30 跑 backup(只寫腳本)。
5. `docs-internal/RUNBOOK-RECOVERY.md`:四個情境各一頁:(a) line-bot 程序壞掉/重複 → 怎麼乾淨重啟並確認 Probe exit 0;(b) 改壞程式 → 回退到 tag;(c) secrets/data 遺失 → 還原;(d) 整台重灌 → 從備份 + git 重建順序。每步附指令與「怎麼確認成功」。
6. 測試:在臨時目錄做一次**真實演練**(假的 secrets/data/state,假排程 XML):backup → 改壞 → restore → 比對 SHA 全同;`-DryRun` 不產生任何檔。用 Pester 若有,沒有就用 PowerShell 腳本斷言 + exit code;RESULT 附原始輸出。

## 禁止
不碰真 secrets 內容(腳本只複製,RESULT 不列值);不對現役路徑執行;不改 line-bot 程式。

## 交付
`ops/*` 四支腳本、RUNBOOK、演練原始輸出、`docs-internal/cards/A5-RESULT.md`(含「第一次真實備份」要總指揮跑的指令)。
