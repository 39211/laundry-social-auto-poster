# 任務卡 A8:ai 電腦 line-bot 部署腳本(A4-3 + A2-b 一次換上,可回退)

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄:C:\Users\cyc39\AI-Lanes\integ\repo(integration/20261030,已含 A4-3、A2-b)
只能新增 `ops/deploy-ai-linebot.ps1`、`ops/tests/DeployAiLinebot.Tests.ps1`、`docs-internal/cards/A8-RESULT.md`。**不執行部署、不碰現役目錄、不停起程序、不註冊排程。**

## 現役事實
- 現役目錄 `C:\Users\cyc39\Documents\New project 5`(= junction `C:\Users\cyc39\laundry-repo`),line-bot 在 `line-bot/`,Python 是 `C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe`(見 `line-bot/README-OPS.md`)。
- watchdog:排程 `Laundry-LINE-Bot` 每 5 分鐘跑 `line-bot/run_line_bot.ps1`(冪等:pid 檔 + 命令列比對;`-Stop` 停三程序;`-Probe` 驗三程序 + healthz pid)。`scripts/_watchdog.ps1` 會把 Disabled 的 `Laundry-*` 排程自動 Enable,所以**不要靠停排程**,要在 5 分鐘內換好。
- 目前現役有重複程序:line_webhook pid 4964(pid 檔)與 14308(真的綁 8791),staff_server 16712/16748;`-Probe` 回 exit 1(`healthz foreign pid`)。部署前要把它們全部乾淨停掉。
- 要換的檔(來源 = 本 worktree `line-bot/`):`tunnel_manager.py`、`handover.json`、`night_handover.py`、`register-night-handover-task.ps1`、`laundry_lookup.py`、`conversation.py`、`arrival_notify.py`、`pull_shop_mdb.ps1`、`register-mdb-pull-task.ps1`、`a43_test_support.py`、測試檔 `test_day_night_handover.py`、`test_mdb_freshness.py`、`run_a2b_tests.py`、`test_tunnel_manager.py`、`test_arrival_notify.py`、`test_conversation.py`。用 `git diff --name-only release/sxj-live-2026-10..integration/20261030 -- line-bot/` 取精確清單,不要手抄。

## 腳本要做的事(`ops/deploy-ai-linebot.ps1 -Source <worktree> -Target <現役> [-DryRun] [-Rollback <backupDir>]`)
1. 預檢:Source/Target 存在、Source 的 git HEAD 印出來、Target 沒有未提交的 line-bot/ 程式改動(有就停,列出)。
2. 備份:Target `line-bot/` 要被覆蓋的檔 → `D:\AI-Lanes-work\_backups\ai-linebot\<ts>\` + MANIFEST(SHA)。
3. 停:先 `run_line_bot.ps1 -Stop`;再用 `Get-CimInstance Win32_Process` 按 CommandLine 含 `laundry-repo\line-bot\` 或 `New project 5\line-bot\` 的 python/cloudflared 全部列出、逐一 Stop-Process(排除自己 $PID);等 3 秒確認 8791/8792 沒有 listener。
4. 複製清單檔;逐檔 SHA 比對。
5. 離線測試(在 Target 目錄用現役 Python):`-m unittest test_tunnel_manager test_day_night_handover`;`run_a2b_tests.py test_mdb_freshness`、`test_arrival_notify`;任一紅 → 自動回退(用步驟 2 的備份)並 exit 1。
6. 起:`run_line_bot.ps1`(不帶參數)→ 等 10 秒 → `-Probe`,exit 必須 0;healthz `ok <pid>` 的 pid 要等於新 pid 檔。
7. 驗:白天(10:00–20:00)期間 tunnel_manager 不應 PUT:看 `%LOCALAPPDATA%\line-bot\tunnel_events.jsonl` 最後幾行有 `skipped_day` 類事件;LINE `GET endpoint` 仍是店機(`lhr.life`)。夜間執行則相反。
8. 註冊排程(可用 `-RegisterTasks` 開關,預設不註冊):呼叫 `register-night-handover-task.ps1`、`register-mdb-pull-task.ps1`。
9. `-DryRun`:只做 1、2(列清單不複製)、印出會停的程序與會複製的檔。
10. `-Rollback <backupDir>`:停 → 還原備份 → 起 → Probe。
全程寫 log 到 `D:\AI-Lanes-work\_backups\ai-linebot\deploy-<ts>.log`。所有 Stop-Process 只按本次列出的精確 PID;不用映像檔名一刀切。

## 測試
Pester(本機 3.4.0):用假 Target 目錄 + 假 `run_line_bot.ps1`(記錄被呼叫的參數、模擬 Probe 回 0/1)+ 假程序清單,驗:預檢擋 dirty、備份 MANIFEST、測試紅自動回退、DryRun 零寫入、Rollback 路徑。至少 10 項先紅後綠。

## 交付
兩支檔 + `A8-RESULT.md`(用法、Pester 輸出、哪些步驟仍要總指揮現場判斷)。
