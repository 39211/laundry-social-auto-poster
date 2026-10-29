# 任務卡 A4-2:店機 LINE 入口可觀測(webhook log 時間戳 + 隧道換址驗證)

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 單一 writer:本卡
工作目錄:C:\Users\cyc39\Documents\New project 5 只能改 `shop-pc/fxwash/` 底下的檔(這是店機程式的副本;部署回店機由總指揮另排)

## 背景(已查證)
- 正式 LINE bot 在店機 `C:\LaundryStores\fxwash`,副本在 `shop-pc/fxwash/`。
- `runtime/tunnel_supervisor.py` 用 `ssh -R 80:127.0.0.1:18791 nokey@localhost.run` 開隧道,抓到新網址就 PUT 給 LINE `/v2/bot/channel/webhook/endpoint`。10/29 實測網址 20 分鐘內換了兩次(4091498c37af0d → cbf8d77614cca1),每次換址到 LINE 接受之間客人訊息會掉。
- `runtime/webhook_server.py` 的 log 行沒有時間戳(例:`[Webhook] POST /line/webhook HTTP/1.1 - 200`),算不出每天幾個客人、也對不上換址時間。
- 店機是 Python 3.11 embedded(`C:\LaundryStores\python-portable`),**只有標準庫**,不能加第三方套件。

## 要做的事
1. `webhook_server.py`:所有 log 輸出加 `YYYY-MM-DD HH:MM:SS` 本地時間前綴(改 SafeWriter 或 log 函式,一處改完全部生效);不改任何業務邏輯。
2. `tunnel_supervisor.py`:
   - 每次抓到新網址、PUT 前後、PUT 回應碼,都寫一行有時間戳的紀錄到 `logs/tunnel_events.jsonl`(欄位:ts、old_url、new_url、put_status、verify_status)。
   - PUT 成功後,GET `/v2/bot/channel/webhook/endpoint` 讀回比對,不一致就重試 PUT(最多 3 次,間隔 2/5/10 秒),仍不一致記 `verify_status: mismatch`。
   - 隧道子程序退出時記一行 `event: tunnel_exit` 含 rc 與存活秒數。
3. 新增 `runtime/test_tunnel_events.py`、`runtime/test_webhook_log_ts.py`(unittest,標準庫,假 urlopen):至少 6 條測試,先紅後綠;RESULT 附兩次原始輸出。
4. 寫 `shop-pc/DEPLOY-A4-2.md`:部署回店機的步驟(哪些檔、怎麼停/起服務、怎麼驗證、怎麼回退),給總指揮在 10:00–20:00 執行。

## 禁止
- 不碰 `shop-pc/fxwash/secrets`(本來就沒有)、不改 `shop.json`、不改通知/對話邏輯、不連店機、不呼叫真 LINE API、不裝套件。
- 不做「固定網域/Named Tunnel」方案(那是另一張卡)。

## 驗收
- `python -m unittest discover -s shop-pc/fxwash/runtime -p "test_*.py"` 全綠;把 verify 重試拿掉至少 2 條變紅。
- 用 `python -c` 載入改後的 webhook_server 模組不報錯(不啟動 server)。

## 交付(docs-internal/cards/A4-2-RESULT.md)
diff 摘要、測試紅綠原始輸出、DEPLOY-A4-2.md 路徑、沒做到的事。
