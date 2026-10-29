# 任務卡 A2-b:夜間備援的資料來源 —— 店機 eHank.mdb 定時拉到 ai 電腦 + 回覆帶資料時間

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\a2b\repo 分支 `feat/a2b-night-mdb-copy`
只能改 `line-bot/` 底下的檔與 `docs-internal/cards/A2b-RESULT.md`。**不要碰 `C:\Users\cyc39\laundry-repo`、不要連店機、不要動 `C:\FXwash\eHank.mdb`、不要重啟程序、不要註冊排程。**

## 背景(已查證)
- ai 電腦晚上 20:00–10:00 當 LINE 備援(店主 10/30 拍板),它的查件/估價讀 `C:/FXwash/eHank.mdb`(`line-bot/laundry_lookup.py:22`、`ehank_prices.py:18`),**這份是副本,現在停在 10/17 20:00**;正式資料在店機 `C:\FXwash\eHank.mdb`(10:00–20:00 開機)。
- ai 電腦可用 `ssh shop-pc` / `scp shop-pc:...`(金鑰與 config 已在 `~/.ssh`,主機別名 `shop-pc`,使用者 AN,tailscale 100.116.147.80)。店機 sshd 在跑。
- eHank.mdb 約 50 MB,有 Jet 密碼;讀取走既有 connector(不要改讀法)。

## 要做的事
1. 新增 `line-bot/pull_shop_mdb.ps1`:
   - `scp -o BatchMode=yes shop-pc:"C:/FXwash/eHank.mdb"` 到暫存檔 → 檢查大小 > 10 MB 且是有效檔 → 把現有 `C:\FXwash\eHank.mdb` 備份為 `C:\FXwash\backups\eHank-<yyyyMMdd-HHmm>.mdb`(只留最近 7 份)→ 原子替換(先寫 .tmp 再 Move-Item)。
   - 若 `C:\FXwash\eHank.mdb` 正被程序鎖住(開檔失敗)→ 不替換、記 log、exit 2。
   - 店機連不上(scp 失敗/逾時 60 秒)→ 記 log、exit 3,不動現有檔。
   - 寫 `%LOCALAPPDATA%\line-bot\mdb_pull.jsonl`(ts、result、bytes、source_mtime、exit)。
   - `-DryRun` 只連線取檔案 mtime 不下載。
2. 新增 `line-bot/register-mdb-pull-task.ps1`:註冊每日 10:30–19:45 每 30 分鐘跑一次(店機開機時段),**只寫腳本不執行**。
3. 改 `line-bot/laundry_lookup.py`:回傳的快照加 `data_as_of`(mdb mtime,本地時間字串)與 `stale`(超過 `LAUNDRY_FRESH_MINUTES`,預設 120 分鐘);**夜間(20:00–10:00)不算 stale 只要 mtime 在當天 19:00 之後**。
4. 改查件回覆組字的地方(`conversation.py` / `quote_flow.py` 中產生查件結果的函式):尾行加「資料時間 MM/DD HH:MM」;stale 時改為「以上是 MM/DD HH:MM 的資料,最新狀態請於營業時間再確認」。不改其他對話邏輯。
5. `arrival_notify.py`:快照 stale 時一律 HOLD 不發(它現在是 dry_run,照樣加)。
6. 測試:unittest/pytest 皆可(既有測試怎麼跑就怎麼跑),新增:data_as_of 計算、stale 判斷(日/夜兩種)、回覆尾行兩種文案、arrival HOLD;至少 6 條先紅後綠。既有 `test_ehank_snapshot.py`、`test_conversation.py`、`test_arrival_notify.py` 必須仍全綠。PowerShell 腳本用 `-DryRun` 跑一次語法檢查(不連線也可,用 `-WhatIf` 或 mock 皆可,說明做法)。

## 禁止
不改 ehank 讀取/解密方式、不改價目、不改 LINE 設定、不碰 secrets、不連店機、不替換真實 mdb。

## 交付(docs-internal/cards/A2b-RESULT.md)
diff 摘要、測試紅綠原始輸出、兩支 ps1 的用法、部署到現役目錄的步驟與第一次手動拉檔的指令(給總指揮在 10:30–19:45 跑)。
