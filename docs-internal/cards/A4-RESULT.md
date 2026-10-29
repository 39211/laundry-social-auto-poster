**A4 判定：已證實曾發生 (b)「端點錯誤」，可定位至 2026-10-07；但無法證明 9/21 起持續斷線，也無法確認目前端點是否正常。** 本次兩個 LINE API 都在連線階段遭拒絕，沒有取得 LINE HTTP 回應；現存 access log 也不足以還原 9/21 之後每天的實際流量。

調查日期：2026-10-29，時區 UTC+8；日誌採樣時間 15:51:39，最後核對 15:56:34。執行者為 Codex，單獨執行，未派子代理。已完整讀取任務卡；本次未修改任何檔案、未發 LINE 訊息、未變更 webhook 設定、未重啟程序。本訊息交總指揮保存為 `A4-RESULT.md`。

**1. 9/21 之後有沒有收到 LINE 事件：現存日誌查到零筆，但歷史紀錄缺失，實際數量未知。**

任務卡所指日誌實際位於：

```text
C:\Users\cyc39\AppData\Local\line-bot\
```

repo 的 `line-bot/` 目錄沒有這些日誌。[run_line_bot.ps1:11](<C:/Users/cyc39/Documents/New project 5/line-bot/run_line_bot.ps1:11>) 指定上述日誌目錄；[tunnel_manager.py:20](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:20>) 也指向同處。

本次讀取該目錄共 20 個 `.log`、`.err`、備份與 `.out` 檔，結果如下：

- 現役 `line_webhook.err` 只有 **495 bytes、8 行**，內容為啟動訊息及 10/28、10/29 的 HEAD／healthz 請求。
- 保存的舊 webhook 日誌能辨識出 **27 筆 POST `/line/webhook`**，時間全部在 **9/6–9/8**，沒有覆蓋 9/21–10/26 的完整 access log。
- 全部現存日誌內，**9/21 起 POST `/line/webhook` 可見筆數為 0**；`bad signature` 及該路徑 HTTP 403 可見筆數也為 0。
- `tunnel.log.1`、`line_webhook.err.1`、`line_webhook.log.1` 均不存在。
- 因此，下面的零是「保存檔案內查到零筆」，**不能解讀成當天確定沒有客人傳訊、沒有 LINE 事件或沒有簽章失敗**。

每日查得筆數如下。A＝缺少覆蓋當日的 access log，當日實際數量未知；B＝現役程序保存的片段，10/27 與 10/29 都不是完整一天。

| 日期 | 可見 POST `/line/webhook` | 可見簽章失敗 | 保存範圍 |
|---|---:|---:|---|
| 2026-09-21 | 0 | 0 | A |
| 2026-09-22 | 0 | 0 | A |
| 2026-09-23 | 0 | 0 | A |
| 2026-09-24 | 0 | 0 | A |
| 2026-09-25 | 0 | 0 | A |
| 2026-09-26 | 0 | 0 | A |
| 2026-09-27 | 0 | 0 | A |
| 2026-09-28 | 0 | 0 | A |
| 2026-09-29 | 0 | 0 | A |
| 2026-09-30 | 0 | 0 | A |
| 2026-10-01 | 0 | 0 | A |
| 2026-10-02 | 0 | 0 | A |
| 2026-10-03 | 0 | 0 | A |
| 2026-10-04 | 0 | 0 | A |
| 2026-10-05 | 0 | 0 | A |
| 2026-10-06 | 0 | 0 | A |
| 2026-10-07 | 0 | 0 | A |
| 2026-10-08 | 0 | 0 | A |
| 2026-10-09 | 0 | 0 | A |
| 2026-10-10 | 0 | 0 | A |
| 2026-10-11 | 0 | 0 | A |
| 2026-10-12 | 0 | 0 | A |
| 2026-10-13 | 0 | 0 | A |
| 2026-10-14 | 0 | 0 | A |
| 2026-10-15 | 0 | 0 | A |
| 2026-10-16 | 0 | 0 | A |
| 2026-10-17 | 0 | 0 | A |
| 2026-10-18 | 0 | 0 | A |
| 2026-10-19 | 0 | 0 | A |
| 2026-10-20 | 0 | 0 | A |
| 2026-10-21 | 0 | 0 | A |
| 2026-10-22 | 0 | 0 | A |
| 2026-10-23 | 0 | 0 | A |
| 2026-10-24 | 0 | 0 | A |
| 2026-10-25 | 0 | 0 | A |
| 2026-10-26 | 0 | 0 | A |
| 2026-10-27 | 0 | 0 | B |
| 2026-10-28 | 0 | 0 | B |
| 2026-10-29，截至 15:51 | 0 | 0 | B |

原始證據：[line_webhook.err:4](C:/Users/cyc39/AppData/Local/line-bot/line_webhook.err:4) 起，當前全部有時間戳的請求只有：

```text
4: 127.0.0.1 - - [28/Oct/2026 08:37:14] "HEAD / HTTP/1.1" 404 -
5: 127.0.0.1 - - [28/Oct/2026 08:37:14] "HEAD / HTTP/1.1" 404 -
6: 127.0.0.1 - - [29/Oct/2026 08:26:22] "HEAD / HTTP/1.1" 404 -
7: 127.0.0.1 - - [29/Oct/2026 08:26:22] "HEAD / HTTP/1.1" 404 -
8: 127.0.0.1 - - [29/Oct/2026 13:00:06] "GET /healthz HTTP/1.1" 200 -
```

現行 [line_webhook.py:169](<C:/Users/cyc39/Documents/New project 5/line-bot/line_webhook.py:169>) 在簽章驗證失敗時回傳 `bad signature`, HTTP 403；現存資料沒有足夠的歷史請求紀錄可據此排除舊日簽章問題。

**2. tunnel 換址次數與 endpoint 更新結果。**

依保存的 [tunnel.log](C:/Users/cyc39/AppData/Local/line-bot/tunnel.log:1795)：

- **含 9/21 當日：15 筆不同的 `public_base` 寫入**，其中 14 筆是真正租戶 tunnel 網址，1 筆誤抓 `api.trycloudflare.com`。
- 若「9/21 之後」嚴格從 **9/22 00:00** 起算，則為 **13 筆**，其中 12 筆真正 tunnel 網址、1 筆錯誤網址。
- 同一期間共有 **29 筆 `HTTPError status=400`、3 筆 `URLError`、15 筆 `webhook endpoint updated`**。
- 成功時的實際 HTTP 回應碼**沒有寫進日誌**，不能補填成「HTTP 200」。
- 失敗日誌也沒有區分例外發生在 PUT 還是後續 GET，因此表內的 400 是「更新流程的 HTTP 錯誤」，不能逐筆斷言都是 PUT 回傳。

下表主機皆加上 `https://` 與 `.trycloudflare.com`；登記 endpoint 再加 `/line/webhook`。時間皆為 UTC+8，行號皆指上述 `tunnel.log`。

| `public_base` 寫入時間 | 主機 | 失敗記錄 | 後續 `updated` 時間 | 主要行號 |
|---|---|---|---|---|
| 09/21 00:28:06 | `reasonable-donations-renew-possibility` | HTTP 400 ×2 | 00:28:13 | 1795、1824、1826、1827 |
| 09/21 00:29:58 | `emission-utilities-facts-independent` | HTTP 400 ×2 | 00:30:06 | 1835、1872、1874、1875 |
| 09/22 14:57:05 | `fiscal-farm-online-developing` | HTTP 400 ×2 | 14:57:13 | 2003、2038、2040、2041 |
| 09/25 10:27:10 | `pale-cleaner-missouri-veterans` | HTTP 400 ×2 | 10:27:20 | 2299、2335、2336、2337 |
| 09/26 00:07:04 | `ind-christine-shore-mae` | 與下一列交錯，兩列合計 HTTP 400 ×5 | 00:07:13／00:07:31，無法逐一配對 | 2350、2384、2431、2433 |
| 09/26 00:07:07 | `march-replies-namespace-resistant` | 同上 | 同上 | 2391、2394、2428、2430、2432 |
| 09/29 21:17:34 | `assured-well-stocks-highway` | HTTP 400 ×3 | 21:17:53 | 2744、2780–2783 |
| 09/30 00:50:34 | `give-sandy-hanging-pointing` | HTTP 400 ×4 | 00:51:52 | 2793、2828、2830–2833 |
| 10/07 00:09:06 | `delhi-church-conversation-snap` | HTTP 400 ×1 | 00:09:10 | 3350、3387、3389 |
| **10/07 00:44:23** | **`api`，誤抓的服務網址** | URLError ×3 | **00:44:40，錯誤網址也被記為更新成功** | **3393–3398** |
| 10/07 01:01:00 | `dsc-flowers-casey-std` | HTTP 400 ×4 | 01:02:18 | 3413、3447、3449–3452 |
| 10/11 20:50:24 | `neighbor-audio-internal-committee` | HTTP 400 ×1 | 20:50:27 | 3790、3826、3827 |
| 10/14 14:41:22 | `usually-ones-mazda-male` | HTTP 400 ×1 | 14:41:25 | 4050、4086、4088 |
| 10/21 08:53:28 | `adelaide-budget-connecticut-biggest` | HTTP 400 ×1 | 08:53:31 | 4566、4601、4603 |
| 10/27 23:08:02 | `establishing-spouse-revelation-lat` | HTTP 400 ×1 | 23:08:07 | 5016、5053、5054 |

`updated` 的證據強度：依 [tunnel_manager.py:62](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:62>)，程式先 PUT，再 GET，確認讀回 endpoint 相符；之後才在 [第 172 行](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:172>) 記錄 `webhook endpoint updated`。它能支持「當時更新流程完成且讀回相符」，**不能證明該網址可收到 LINE webhook**。

9/26 的兩次啟動、兩個新網址與重試輸出交錯，日誌沒有 PID 或 endpoint 欄位，無法把每次成功／失敗可靠配對至個別程序；這是同時存在多個更新者的疑點，尚未證明目前仍有競爭。

最新一筆原始證據：

```text
tunnel.log:5016
2026-10-27 23:08:02 public_base https://establishing-spouse-revelation-lat.trycloudflare.com

tunnel.log:5053
2026-10-27 23:08:04 webhook endpoint failed: HTTPError status=400

tunnel.log:5054
2026-10-27 23:08:07 webhook endpoint updated
```

**3. 現在 LINE 後台登記的 URL 與 LINE 測試結果：BLOCKED，兩項均未取得。**

[public_base.txt:1](<C:/Users/cyc39/Documents/New project 5/line-bot/public_base.txt:1>) 本次讀到：

```text
https://establishing-spouse-revelation-lat.trycloudflare.com
```

因此本機預期的 webhook endpoint 是：

```text
https://establishing-spouse-revelation-lat.trycloudflare.com/line/webhook
```

已從卡片指定的 `secrets/line-channel.json` 在程序記憶體讀取 token，以下兩個 API **各嘗試一次**；token、channel secret 均未輸出。

```text
GET https://api.line.me/v2/bot/channel/webhook/endpoint
Authorization: Bearer [REDACTED]

開始：2026-10-29 15:52:08.321 +08:00
結束：2026-10-29 15:52:10.385 +08:00

結果：
URLError
<urlopen error [WinError 10061] 無法連線，因為目標電腦拒絕連線。>

HTTP 回應碼：未取得
LINE 回應本文：未取得
```

```text
POST https://api.line.me/v2/bot/channel/webhook/test
Authorization: Bearer [REDACTED]
Content-Type: application/json
Request body: {}

開始：2026-10-29 15:52:10.386 +08:00
結束：2026-10-29 15:52:12.433 +08:00

結果：
URLError
<urlopen error [WinError 10061] 無法連線，因為目標電腦拒絕連線。>

HTTP 回應碼：未取得
LINE 回應本文：未取得
```

這是本執行環境觀察到的**傳輸層失敗**，不能用來判定 token 有效性、LINE 後台 URL、`active` 狀態或 webhook 測試的 `success/statusCode`。本次沒有改動代理或網路設定，也沒有改用其他通路繞過限制。

| 比對項目 | 本次結果 |
|---|---|
| 本機 `public_base.txt` | 已取得，如上 |
| LINE 當前登記 endpoint | 未取得 |
| LINE endpoint 是否與本機相同 | 無法比對 |
| LINE 端 webhook 測試狀態碼 | 未取得 |

API 嘗試前後，`line_webhook.err` 均為 495 bytes，SHA-256 相同，沒有新增 webhook POST 記錄。

**4. 三選一結論、確定的故障鏈與建議修法。**

| 選項 | 本次判定 |
|---|---|
| (a) 端點對，只是沒人用 | **證據不足。** 缺歷史 access log，當前 LINE 登記值也未取得。 |
| (b) 端點掉了，從某天起 | **已證實曾發生端點錯誤。** 10/7 00:44:23 本機寫入錯誤網址，00:44:40 記錄更新完成；下一個有效 tunnel 網址的更新完成紀錄為 01:02:18。不能延伸成「9/21 起一直掉線」。 |
| (c) 端點對，但簽章／程式錯誤擋掉 | **未找到支持證據，也不能完整排除。** 沒有保留足夠歷史請求，當前 LINE 測試未完成。 |

10/7 的確定問題是：**網址擷取器把 cloudflared 錯誤訊息裡的服務 API 網址，當成新 tunnel 網址。**

原始日誌：

```text
tunnel.log:3393
2026-10-07 00:44:23 cloudflared: failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host

tunnel.log:3394
2026-10-07 00:44:23 public_base https://api.trycloudflare.com

tunnel.log:3395
2026-10-07 00:44:23 webhook endpoint failed: URLError

tunnel.log:3396
2026-10-07 00:44:25 webhook endpoint failed: URLError

tunnel.log:3397
2026-10-07 00:44:30 webhook endpoint failed: URLError

tunnel.log:3398
2026-10-07 00:44:40 webhook endpoint updated
```

下一個有效 tunnel 網址及其更新完成紀錄：

```text
tunnel.log:3413
2026-10-07 01:01:00 public_base https://dsc-flowers-casey-std.trycloudflare.com

tunnel.log:3452
2026-10-07 01:02:18 webhook endpoint updated
```

對應原始碼：

- [tunnel_manager.py:21](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:21>) 的規則是 `https://[A-Za-z0-9-]+\.trycloudflare\.com`，會接受 `https://api.trycloudflare.com`。
- [第 132 行](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:132>) 起對 cloudflared 的每一行輸出找網址，沒有要求該行必須是「成功建立 tunnel」訊息。
- [第 190 行](<C:/Users/cyc39/Documents/New project 5/line-bot/tunnel_manager.py:190>) 起會先寫入 `public_base.txt`，再執行 LINE endpoint 更新。

本次另以**記憶體內唯讀方式**，從原始碼取出正規表示式，套用到上述原始日誌，實際得到：

```text
輸入：tunnel.log 第 3393 行，申請 tunnel 失敗訊息
擷取結果：https://api.trycloudflare.com
```

依程式的 `updated` 語意，當時更新流程指向的錯誤 endpoint 為：

```text
https://api.trycloudflare.com/line/webhook
```

00:44:40 至 01:02:18 相隔 **17 分 38 秒**；這是兩筆更新紀錄的間隔，沒有逐秒外網測試，不能當成實測離線時長。它足以確認歷史端點缺陷，但仍無法單獨解釋 9/21 之後整段客訊空白。

建議修法：先由可連到 LINE 的執行環境補完本卡同兩項 API，確認當前入口；程式修補則應讓網址擷取只接受成功建立 tunnel 的公告，拒絕錯誤列與 `api.trycloudflare.com`，並在子程序仍存活、LINE PUT 與 GET 讀回一致後才發布本機網址；同時補上 tunnel manager 單一執行者保護，以及不會在重啟時失去歷史的日誌保存方式，記錄每次更新的 PID、endpoint、PUT／GET 階段與 HTTP 回碼。**本次僅提出建議，未套用。**

| 建議修改檔案 | 修改目的 |
|---|---|
| `line-bot/tunnel_manager.py` | 修正錯誤列網址誤抓、發布順序與更新流程日誌 |
| `line-bot/test_tunnel_manager.py` | 加入本次真實錯誤列、拒收 API 主機與失敗時不發布的案例 |
| `line-bot/run_line_bot.ps1` | 單一 manager 保護；啟動前保存舊日誌，避免歷史流失 |
| `line-bot/test_run_scripts.py` | 驗證重複啟動與日誌保存行為 |

固定網址方案比較一行：**免費 quick tunnel 可提供臨時公開入口並由現有程式自動改址；固定網址可評估 named tunnel 搭配自有網域，若沒有可用網域，購買與續約網域是付費步驟；本卡未查證現行方案費率，不報金額。**

本次主要證據快照如下，供總指揮保存後核對：

| 檔案 | 採樣大小／行數 | SHA-256 |
|---|---|---|
| `%LOCALAPPDATA%\line-bot\tunnel.log` | 892,687 bytes／5,186 行 | `3f7fdb0e93e9a932875433f79a3ce7a6985c5b86396f6d1c8ca9cb7ca870cf86` |
| `%LOCALAPPDATA%\line-bot\line_webhook.err` | 495 bytes／8 行 | `9efe9c728bdfe3fa3a149248c348843319c2f22398e66a9bc67b2826f2733253` |
| `line-bot/tunnel_manager.py` | 本次讀取版本 | `17638f72790fcb10db3a5f961d6abf930c7a81c0ff1ef45d84c18c9bbb381fff` |

交付仍缺的證據只有兩類：**當前 LINE endpoint／測試 API 回應，以及未保存的歷史 access log。** 本次未建立 `A4-RESULT.md` 或寫入 Vault，完整調查結果即為本訊息。



---

## 總指揮補驗(Claude,2026-10-29 16:08 +08,從非沙箱環境直接呼叫 LINE API)

- `GET /v2/bot/channel/webhook/endpoint` → `https://4091498c37af0d.lhr.life/line/webhook`,`active=true`
- `POST /v2/bot/channel/webhook/test` → `success=true, statusCode=200`
- 本機 `public_base.txt` = `https://establishing-spouse-revelation-lat.trycloudflare.com`;本機 tunnel.log 最後一次 `webhook endpoint updated` 是 2026-10-27 23:08:07。
- `https://4091498c37af0d.lhr.life/healthz` 回 `200 OK`(本機 bot 的 healthz 回的是 `ok <pid>`,格式不同 → 不是這台)。
- 本機沒有任何 ssh / localhost.run 程序;repo 與 AI_Agency、FXwash 都搜不到 `lhr.life` / `localhost.run`。
- Tailscale 上另一台 `desktop-hv0r4sn`(100.116.147.80)在線,SMB 445 可連、8791/8792 逾時(防火牆)。

### 結論(取代 Codex 的三選一)
**(b′) 端點被另一台機器接走。** LINE 目前把訊息送到 `*.lhr.life`(localhost.run 隧道),不是這台的 cloudflared。兩台機器各自有 tunnel manager 會 PUT 自己的網址,誰最後重啟誰贏;10/27 23:08 之後被另一台蓋掉。這台從 9/21 起沒有客人紀錄,最可能就是這個原因,而不是沒人用。

### 待店主拍板
哪一台是正式 LINE bot:`desktop-hv0r4sn`(推測是店裡的公司洗衣電腦,eHank 在本機、資料最新)還是這台 `ai`?定了之後另一台的 tunnel manager 必須停掉,不能兩台同時搶端點。

### Codex 找到的程式缺陷(確認屬實,待修)
`tunnel_manager.py` 第 21 行的正規表示式會把 cloudflared 錯誤訊息裡的 `https://api.trycloudflare.com` 當成 tunnel 網址(10/07 00:44 實際發生,錯誤端點維持 17 分 38 秒)。修法見上。
