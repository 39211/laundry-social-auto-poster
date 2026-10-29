# 任務卡 A4-3:LINE 入口日夜切換(白天店機、晚上 ai 電腦),不再互搶

總指揮:Claude(Cowork) 日期:2026-10-30 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄(worktree):C:\Users\cyc39\AI-Lanes\a43\repo 分支 `feat/a4-3-night-handover`
只能改 `line-bot/` 底下的檔與 `docs-internal/cards/A4-3-RESULT.md`。**不要碰 `C:\Users\cyc39\laundry-repo`(那是現役目錄)、不要重啟任何程序、不要註冊排程、不要呼叫真 LINE API。**

## 店主拍板(2026-10-30 00:10)
- 店機 DESKTOP-HV0R4SN(`C:\LaundryStores\fxwash`,localhost.run 隧道)每天 10:00 開機、20:00 關機,**白天是正式 LINE bot**。
- ai 電腦(本 repo `line-bot/`,cloudflared quick tunnel)**晚上 20:00–10:00 當備援**。
- 現況問題:兩台的 tunnel 程式都在網址變動時 PUT 給 LINE,誰最後 PUT 誰贏,白天會互搶。

## 要做的事(全部在 ai 端 `line-bot/`)
1. 新增 `line-bot/handover.json`(可被總指揮改):
   `{"day_start": "10:00", "day_end": "20:00", "night_takeover_delay_min": 5, "tz": "Asia/Taipei"}`
2. 改 `line-bot/tunnel_manager.py`:
   - 修 bug:網址擷取只接受 cloudflared「成功建立」那一行的 `https://<sub>.trycloudflare.com`,**拒絕 `api.trycloudflare.com`** 與出現在錯誤訊息裡的網址(10/07 曾誤抓,見 `docs-internal/cards/A4-RESULT.md`)。
   - 抓到新網址一律寫 `public_base.txt`;但**只有在夜間窗(day_end 之後到 day_start 之前)才 PUT 給 LINE**;白天只記 log「day window: shop is primary, not registering」。
   - PUT 後 GET `/v2/bot/channel/webhook/endpoint` 讀回比對,不一致重試(2/5/10 秒,最多 3 次);每次事件寫一行 jsonl 到 `%LOCALAPPDATA%\line-bot\tunnel_events.jsonl`(ts、event、old_url、new_url、put_status、verify_status)。
3. 新增 `line-bot/night_handover.py`(給排程在 day_end + delay 跑,例 20:05):
   - 讀 `public_base.txt`;GET 現在 LINE 登記的端點;若不是 ai 的 → PUT ai 的網址並驗證;若已是 → 不動。
   - `--dry-run` 只印不發;`--status` 只印兩邊網址。
   - 早上不需要「交回」:店機開機後自己的 supervisor 會 PUT 搶回去,這是預期行為;但 `night_handover.py --status` 要能看出現在誰在線。
4. 新增 `line-bot/register-night-handover-task.ps1`:比照 `scripts/register-*-task.ps1` 寫法註冊每日 20:05 的排程,**只寫腳本不執行**。
5. 測試(unittest,標準庫,假 urlopen / 假時鐘):tunnel_manager 的網址擷取(含 api.trycloudflare.com 拒收、錯誤行拒收)、日夜窗判斷(邊界 10:00 / 20:00、跨午夜)、night_handover 三種情況(已是 ai / 不是 ai→PUT 成功 / PUT 後 GET 不一致→重試→mismatch)。至少 10 條,先紅後綠,RESULT 附兩次原始輸出。
   既有 `line-bot/test_tunnel_manager.py` 必須仍然全綠;若既有測試假設「抓到網址就 PUT」,改測試時在 RESULT 說明原因。

## 禁止
不改 conversation / 查件 / 通知邏輯;不改 `run_line_bot.ps1` 的啟停行為;不碰 secrets;不改 `shop-pc/`。

## 交付(docs-internal/cards/A4-3-RESULT.md)
diff 摘要、測試紅綠原始輸出、`register-night-handover-task.ps1` 的用法、部署到現役目錄需要的步驟(複製哪些檔、重啟哪個程序;給總指揮做)。
