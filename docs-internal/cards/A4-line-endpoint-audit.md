# 任務卡 A4(第一段,唯讀調查):LINE 入口為什麼 9/21 之後沒有客人訊息

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 本卡唯讀,不改任何檔
repo:C:\Users\cyc39\Documents\New project 5(line-bot 在 `line-bot/`)

## 已知事實(我實測過,不用再證)
- `line_webhook.py` 在 127.0.0.1:8791,healthz 回 `ok 14308`;`tunnel_manager.py` 起 cloudflared quick tunnel,`line-bot/public_base.txt` 目前是 `https://establishing-spouse-revelation-lat.trycloudflare.com`(10/27 23:08 寫入)。
- `data/line-unanswered.jsonl` 與 `data/staff-inbox.jsonl` 最後一筆都是 2026-09-21。
- 排程 `Laundry-LINE-Bot` 每 5 分鐘跑 `run_line_bot.ps1`(watchdog)。

## 要回答的問題
1. 9/21 之後 webhook 到底有沒有收到任何 LINE 事件?看 `line-bot/*.log`、`*.err`、`tunnel.log`、`tunnel.log.1`,列出每天的請求數(/line/webhook 的 POST)與簽章失敗數。
2. tunnel 網址在 9/21 之後換過幾次?每次換完 `tunnel_manager` 的 PUT 給 LINE 有沒有成功(log 裡的回應碼)?列時間表。
3. 現在 LINE 後台登記的 webhook URL 是什麼?用 `secrets/line-channel.json` 的 token 呼叫 `GET https://api.line.me/v2/bot/channel/webhook/endpoint`,比對 `public_base.txt`。再呼叫 `POST https://api.line.me/v2/bot/channel/webhook/test` 看 LINE 端測出來的狀態碼。(這兩個都是官方唯讀/測試 API,不會發訊息給任何人。)
4. 結論三選一並附證據:(a) 端點對、只是沒人用;(b) 端點掉了,從某天起;(c) 端點對但簽章/程式錯誤擋掉。

## 交付(寫進 docs-internal/cards/A4-RESULT.md)
- 上面四題的答案與原始證據(log 片段、API 回應,token 要遮掉)
- 若是 (b) 或 (c):建議修法(一段話)+ 要改哪些檔,**先不要改**
- 固定網址方案比較一行:免費能做到什麼、要花錢的是哪一步

## 禁止
- 不發任何 LINE 訊息、不改 webhook 設定、不重啟任何程序、不改任何檔案(RESULT 除外)
- 不把 token、secret 寫進 RESULT
