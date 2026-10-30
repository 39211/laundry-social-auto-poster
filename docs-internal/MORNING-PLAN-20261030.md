# 10/30 早上執行順序(總指揮自用,10:30 提醒會觸發)

前提:店主已拍板 ① 店機白天正式、ai 夜間備援 ② 通知保留金額 ③ 綁定漏洞先記風險 ④ A4-2 部署 10:30–11:00。
現役工作樹目前在 `feat/a4-2-shop-tunnel-observability`(與 release 同程式);A4-2 staging 已備好 `C:\Users\cyc39\AI-Lanes\a42-staging\`(SHA256SUMS.txt)。

## 10:30 店機開機後
1. `ssh shop-pc` 確認三程序(webhook_server 18791、tunnel_supervisor、inbound_monitor)+ `FXwash-Watchdog` 在跑;LINE `GET /v2/bot/channel/webhook/endpoint` 應已回到 `*.lhr.life`(店機 supervisor 開機後 PUT)。
2. **A4-2 部署店機**:照 `shop-pc/DEPLOY-A4-2.md`:scp `a42-staging.zip` → `C:\LaundryStores\A4-2-staging`;逐段用 `powershell -EncodedCommand` 跑第 1–4 節;Disable `FXwash-Watchdog` → 停 supervisor(先殺 ssh 子程序)→ 停 webhook → 複製四檔 → 3.11 `unittest discover -s runtime -p test_*.py`(預期 18 綠)→ 起 webhook → 起 supervisor → 看 `logs/tunnel_events.jsonl` 有 `verify_status: match` → 恢復 watchdog → LINE `webhook/test` 200。失敗照第 5 節回退。
3. **A2-b 第一次拉 mdb(ai 端)**:從 worktree `C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\pull_shop_mdb.ps1 -DryRun` → 實跑 → 確認 `C:\FXwash\eHank.mdb` mtime 更新、`backups/` 有舊檔。
4. **11:30 盯每日圖文**:`output/catch-up-logs/2026-10-30.log` 要看到 publish-pages exit 0、`assets/2026-10-30/slot-01.png` 200、`data/posted-log/2026-10-30.json` 出現。失敗就立刻看錯誤(若又是 llms-full.txt UNKNOWN → 查同分鐘有哪些排程在跑)。

## 12:00 後(店機不必在)
5. 把 A4-3 + A2-b 部署到 ai 現役 `line-bot/`:先 `run_line_bot.ps1 -Stop`(它會被 watchdog 5 分鐘內拉起,所以要在 5 分鐘內換好檔)→ 複製 `tunnel_manager.py`、`handover.json`、`night_handover.py`、`laundry_lookup.py`、`conversation.py`、`arrival_notify.py`、`ehank_prices.py`(若有改)→ 跑該目錄測試 → 讓 watchdog 拉起或手動 `run_line_bot.ps1` → `-Probe` exit 0(先清掉重複的 line_webhook/staff_server 舊程序 4964/16712)→ 註冊 `register-night-handover-task.ps1`(20:05)與 `register-mdb-pull-task.ps1`(10:30–19:30 每 30 分)。**白天 ai 的 tunnel_manager 改版後不會 PUT,安全。**
6. 合併:`feat/a4-2`、`feat/a4-3`、`feat/a2b`、`feat/b3`、`feat/a5`(若 r2 驗過)、`feat/a7`(若驗過)→ `release/sxj-live-2026-10`,tag `sxj-live-2026-10-30`,現役工作樹切到 release。
7. 註冊 B3 週報排程(週一 08:00)、A5 備份排程(03:30),先各手動跑一次。
8. A3-2(通知機制)與 A7(發布管線)部署:要先問店主(A3-2 會改變通知觸發條件;A7 動的是每天在跑的排程腳本,挑 21:00 之後換)。

## 要問店主的(集中一次)
- A3-2 部署:同意讓「狀態=完工但沒填完工日」的件也發通知?
- A7 部署時間 + 告警要不要推店員群。
- 10/26–10/29 四天沒發的圖文:不補發(建議)/ 補發哪幾篇?
- 網站 4 天沒更新,11:30 排程會自動重發;要不要我現在先手動 publish?
- B1 的 11 題(文件裡的表)。

## 02:55 補充
- 所有分支已合併到 integration/20261030 @ 7dcc7125(worktree C:\Users\cyc39\AI-Lanes\integ\repo),測試全綠;步驟 5–7 直接從這個分支取檔/合併到 release。
- B2 設計卡(唯讀)在 integ worktree 跑,結果 docs-internal/B2-DESIGN.md。
