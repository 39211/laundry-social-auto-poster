# 私享家 版本登錄表 v1（T01 五庫對齊）

日期:2026-10-29 盤點者:Claude(總指揮) 盤點方式:在店主「ai」電腦上實跑 git fetch / Get-ScheduledTask / 程序與 port 掃描,不是看文件自述。

## 一句話結論

**現役正式系統只有一套:`39211/laundry-social-auto-poster`**(本機兩個 checkout:`C:\Users\cyc39\laundry-repo` 跑 LINE bot,`C:\Users\cyc39\Documents\New project 5` 跑內容發布/GA4/GSC/YouTube)。
GPT 計畫書當成主幹的 P1/P2/P3/P4/R11 五庫,**沒有任何一個在對客人服務**;它們是「商品化」平行軌,各自狀態都標 NOT_READY / formal_store=NO_GO。

## 現役正式程序(對客人有效)

| 元件 | 實際跑的程式 | 位置 | 排程/常駐 | 版本 | 備註 |
|---|---|---|---|---|---|
| LINE webhook | `line-bot/line_webhook.py` (Flask 127.0.0.1:8791) | `C:\Users\cyc39\laundry-repo` | 排程 `Laundry-LINE-Bot` 每 5 分鐘 watchdog;healthz 回 `ok 14308` | branch `fix/reel-v3-two-reference-images` @ `59b53060` (10/24),**工作區 378 檔未提交** | 經 cloudflared quick tunnel 對外:`https://establishing-spouse-revelation-lat.trycloudflare.com`(重啟會換網址,由 tunnel_manager 自動 PUT 給 LINE) |
| 店員接手頁 | `line-bot/staff_server.py` (127.0.0.1:8792) | 同上 | 同上 | 同上 | 只能本機開 |
| 查件/價目來源 | `laundry_lookup.py`、`ehank_prices.py` 讀 `C:/FXwash/eHank.mdb`(唯讀) | 本機 | — | — | **這台電腦的 eHank.mdb 停在 10/17 20:00**,不是店裡即時資料;store PC 無 UNC/對映 |
| 入庫通知 | `arrival_notify.py` | 同上 | `arrival-notify.lock` 10/27 | — | **`mode: dry_run`**,未真發 |
| 每日圖文產製 | `scripts/daily-generate.ps1` 等 | `Documents\New project 5` | `Laundry-Daily-Generate` 06:30、`Daily-Approve`、`Publish-1130/1200/1400/2030`、`Sentinel`、`Time-Gate`、`Schedule-Ahead` 全部 rc=0 | 同一 repo 同一 branch | 已排到 2026-11-01 |
| 成效收集 | `ga4-collect.ps1`、`gsc-collect.ps1`、`youtube-analytics.ps1` | 同上 / laundry-repo | 每晚 23:05–23:15 rc=0 | — | `data/leads/2026-10.json` 有 LINE 點擊與漏斗 |
| 影片 | `post-feature-reel.ps1`、`youtube-upload.ps1 --live` | 同上 | `Feature-Reel-1400`、`YouTube-Upload` | — | `Laundry-Reel-Produce` 已停(next=2099) |
| 門市 POS(權威) | eHank.exe(VFP 舊系統) | 店裡「公司洗衣電腦」+ 本機 `C:\FXwash` 副本 | — | eHank.exe 2026-09-08 | 訂單/收款權威仍是舊 POS |

LINE 真客人最後互動紀錄:`data/line-unanswered.jsonl`、`staff-inbox.jsonl` 都停在 **2026-09-21**(客號 0028 查件)。之後一個多月沒有新客人訊息紀錄(待確認是沒人用,還是 tunnel 網址換掉後 LINE 端點失效)。

## 五庫(商品化軌)實際狀態

| 代號 | repo | main 最新 | 最新工作分支 | 本機主 clone(dirty) | STATUS 自述的現況 | 我的判定 |
|---|---|---|---|---|---|---|
| P1 通知 | `39211/p1-ai-companion` | 10/11 `ae2c249` | 10/08 `dot/p1-guard-datei-text`;另在 `laundry-ai-commercial` `codex/p1-p4-delivery-sync-20261015` 10/25 | `Documents\AI_Agency\products\p1-ai-companion` `sync/local-20260918`(2) | 離線 E2E 33/33;`formal_store=NO_GO`、`line_contacted=false` | 零件庫。現役 arrival_notify 已有同功能(dry_run) |
| P2 在地獲客 | `39211/p2-local-seo` | 10/10 `ebb219d` | 10/10 dot/* | `products\p2-local-seo` `sync/local-20260918`(99) | SEO 健檢/交件包 ACCEPTED_LOCAL;PageSpeed/GSC/GA4/訂單 UNMEASURED | 文件與方法可用;現役 GSC/GA4 收集已在 auto-poster |
| P3 LINE | `39211/p3-line-oa` | 10/11 `bf492b4` | 10/26 `dot/p3-linepay-ledger-b2-b3` | `products\p3-line-oa` `feat/p3-line-delivery-connections`(50) | 本機工作台/交機包;「正式 Webhook 回 503、POS 檔停 9/21」 | 零件庫。現役 LINE bot 在 auto-poster/line-bot |
| P4 內容 | `39211/p4-content` | 10/11 `0f0e8be` | 10/11 grok/* | `products\p4-content` `sync/local-20260918`(201) | v60-r2 0.4.46 本機候選;真平台 0/5、真店 0/2 | 零件庫。現役發布鏈在 auto-poster |
| 新 POS R11 | `39211/ehank-remake-r11-pro-handoff` | 10/20 `5069e1e` | 10/20 `pro/diagnosis-rootday-20261020` | `D:\AI-Lanes-work\ehank-remake-r11-github-handoff`(0) | 收件/報價/現金/完工/部分取件有限接受;C06/C10–C13/C15 未做;1 個已知真失敗 | 中期專案,不進單店第一條流程 |
| 舊 POS 研究 | `39211/smart-laundry` | — | 10/18 `codex/pos-win-eligibility-p3-20261017-12a5` | `D:\AI-Lanes-work\sxj-pos-*` | 備份/還原/報表匯出 | 參考 |
| 傘 repo | `39211/laundry-ai-commercial` | 10/14 `c8e8141` | 10/25 `codex/p1-p4-delivery-sync-20261015` | `D:\AI-Lanes-work\p4-native-studio-gap-20261024\github-archive` | 封存/交付同步 | 封存 |

另:`D:\AI-Lanes-work` 下有 200+ 個 lane 工作目錄(p2-*/p3-*/p4-* 各數十個),都是一次性驗收/候選目錄,不是正式來源。

## 修正 GPT 計畫書的四個前提

1. GPT 的「五庫」是錯的主幹。正確主幹 = `laundry-social-auto-poster`。五庫降為零件庫,需要時 cherry-pick。
2. 「P1 工作線領先 main 52 commits」:在 `laundry-ai-commercial` 的 `codex/p1-p4-delivery-sync-20261015` 上,不是 p1 repo。GPT 此點方向對、位置錯。
3. 「POS → P3 讓 LINE 查到可信訂單」:現役 bot 已經會查(9/21 有真客人查到「低靴子 350 元可以取」),問題是**資料新鮮度**——這台電腦上的 eHank.mdb 是副本,店裡電腦關機/不同步時就是舊資料。真正要補的是「店裡 POS 電腦 → 這台 bot 電腦」的 mdb 同步與新鮮度顯示。
4. 「P1 → P3 完成正確的通知」:現役 `arrival_notify.py` 已經寫好、在 dry_run。真正要做的是「開 live 前的驗收 + 開 live」,不是重建。

## 現役主幹的四個真缺口(優先順序)

| # | 缺口 | 證據 | 修法方向 |
|---|---|---|---|
| G1 | 工作區 378 檔未提交、兩個 checkout 同 branch | git status | 先 commit/整理成可回復的版本,否則任何改動都無法回退 |
| G2 | eHank.mdb 副本新鮮度(10/17) | `C:\FXwash\eHank.mdb` mtime | 店裡電腦開機時定時同步 mdb 到本機 + bot 回覆帶「資料時間」 |
| G3 | 入庫通知 dry_run | `data/arrival-notify.json` | 先用真資料跑 dry_run 看一週 log 無誤報,再開 live(開 live 要店主拍板) |
| G4 | LINE 端點用 quick tunnel,網址會變;9/21 後無客人紀錄 | public_base.txt、jsonl | 確認 LINE 後台 webhook URL 與 public_base 一致;考慮固定網域(需店主帳號操作或付費,先查免費方案) |

## 待店主拍板
- 主幹改定為 `laundry-social-auto-poster`、五庫降為零件庫(建議)。


---

## 10/29 16:40 更正(店主已拍板)

- `C:\Users\cyc39\laundry-repo` 是指向 `Documents\New project 5` 的 junction,同一份 checkout,不是兩份。
- **正式 LINE bot 在店裡公司洗衣電腦 `DESKTOP-HV0R4SN`(tailscale 100.116.147.80,ssh 別名 `shop-pc`,使用者 AN)**:`C:\LaundryStores\fxwash`(FXwash LINE 商品 v1.1 = P3 商品包實裝,9/21 安裝,webhook_server.py/lookup_service.py 10/28 手改),webhook 127.0.0.1:18791,`ssh -R 80:127.0.0.1:18791 nokey@localhost.run` 隧道,`tunnel_supervisor.py` 自動 PUT 網址給 LINE,`inbound_monitor.py` 追蹤 completed_dnos,排程 `FXwash-Daily-10AM`、`FXwash-Watchdog`,eHank.mdb 本機即時(10/29 17:16)。**那台沒有 git。**
- ai 電腦 `line-bot/` 為舊版:已 Disable `Laundry-LINE-Bot` 排程、停掉 tunnel_manager(18664/18724)與 cloudflared(19140);line_webhook/staff_server 本機程序仍在(無對外),待下一張卡清理。
- LINE 登記端點 16:08 為 `4091498c37af0d.lhr.life`,16:35 已變 `cbf8d77614cca1.lhr.life`:localhost.run 免費隧道網址會頻繁更換,全靠店裡 supervisor 補 PUT。
- A1 完成:`release/sxj-live-2026-10` @ `4992668a`,tag `sxj-live-2026-10-29`,已推 origin;工作區僅剩 5 個 SUSPECT(見 cards/A1-RESULT.md)。
- A4 完成:見 cards/A4-RESULT.md。

## 10/29 19:05 補記(店主口述 + 實查)
- **店裡電腦每天 20:00 關機、10:00 開店才開**(店主口述;沒有排程關機,是人工)。任何要連店裡電腦做的事只能在 10:00–20:00;20:00–10:00 正式 LINE bot 離線,夜間靠 LINE 後台的非營業時間原生回覆(待在 LINE OA 後台確認)。
- 店裡 `inbound_monitor.py` 是**真發 LINE push**(無 dry_run 旗標),每 6 秒輪詢 eHank,對已綁定客人推入庫/完工通知 → A3「入庫通知」在店裡已經是 live,不需重做;要做的是驗證誤發與通知文案。
- 店裡 `webhook_server.py` 有 Gemini 圖片估價(`vision_service.py`,gemini-flash 常 503 後換模型)、Clothing_Memory.md 記錄;webhook_server.log **沒有時間戳**,無法算每日請求量 → 要加時間戳(下一張卡)。
- 店裡 logs/data(含 customer_bindings、monitor_state)已拉一份到 ai 電腦 `C:\Users\cyc39\AI-Lanes\shop-pc-ops\20261029\`(不進 git,含客人 LINE userId)。
- 店裡 `shop.json`:`mode: demo`、`product.plan: starter`、`payment.mode: disabled`、`acceptance.*` 全 false。影響待查(下一張卡)。

## 10/29 23:55 店主拍板 + 進度
- 通知文案保留金額(客人本人的單可以看到);「價格不寫」只適用宣傳內容。
- **風險清單 R1(店主決定先不改)**:任何人輸入查得到的手機/客號即被綁定為該客(店機 `webhook_server.py:625–654`),之後會收到該客的入庫/完工通知(含品名金額)。目前綁定僅 2 筆。修法候選:店員確認後才綁、或手機+最近單號雙核對。
- A3 其他發現(見 cards/A3-RESULT.md):push 失敗無重試且去重先更新 → 漏發;state 非原子寫入 → 重發/毀損;首啟基線查詢失敗 → 歷史全發;查件 `State=完工` 可取但 monitor 不發(條件不一致);mdb 鎖住時 mtime 不變就不再重查。這些進 A3-2 修補卡(店主已核方向:先量測、不改對客行為)。
- A4-2 完成並獨立驗證:branch `feat/a4-2-shop-tunnel-observability` @ `2e8de7e7`,18 測試綠、拿掉重試 5 紅;部署文件 `shop-pc/DEPLOY-A4-2.md`。**部署時段:10/30 10:30–11:00(店主拍板),已排 10:30 自動接手。**
- B4 工時表改為總計畫文件的分頁(店主每天在 Claude app 填),不寫程式。

## 10/30 01:00 進度
- 店主確認 20:30 是自己重開 ai 的 Laundry-LINE-Bot:**ai 電腦夜間(20:00–10:00)當備援,白天店機正式。**排程不要再停。
- A4-3 完成(eat/a4-3-night-handover @ 2005f76a,46 測綠、拔日夜窗 6 紅):ai tunnel_manager 白天不 PUT、夜間才登記;嚴格網址擷取;
ight_handover.py + egister-night-handover-task.ps1(20:05)。待部署到現役 line-bot + 重啟 tunnel_manager + 註冊排程。
- A2-b 完成(eat/a2b-night-mdb-copy @ af280e3b,96 測綠、拔 stale 6 紅):pull_shop_mdb.ps1(10:30–19:30 每 30 分)、查件尾行「資料時間」、stale 時 arrival STALE_HOLD。待第一次手動拉檔 + 部署。
- B1 完成(77 條、11 組衝突、20 待確認;docs-internal/SHOP-FACTS.md)。
- worktrees:C:\Users\cyc39\AI-Lanes\a43\repo、C:\Users\cyc39\AI-Lanes\a2b\repo(部署後可移除)。工作樹目前停在 eat/a4-2-shop-tunnel-observability(與 release 程式相同,僅多 shop-pc/ 與文件)。

## 10/30 02:10 重大發現:每日圖文自 10/26 起沒有真的發出去
- 證據:`data/posted-log/` 最後一筆 2026-10-26(597 bytes,只有半天);`output/catch-up-logs/2026-10-27~29.log` 每一輪都是 `publish-pages failed (exit 1)` → 原因 `fatal: Unable to create .git/index.lock: File exists`(10/25 23:40 留下的 0-byte 過期鎖,A1 時我已於 10/29 17:45 移除)→ 公開站沒更新 → `post-current-slot` 因 `https://sixiangjialaundry.com/assets/<date>/slot-0X.png` 404 而失敗 → FB/IG 四天(10/26 下午起到 10/29)全部沒發;`reports/daily-progress.md` 的「發布完整(全槽)=False」也在講這件事。
- 鎖移除後 10/29 14:00 起改成 `generate-public-site` 寫 `docs/llms-full.txt` 得到 `UNKNOWN errno -4094`(疑似兩個排程同分鐘同時產站互鎖,或防毒掃描);02:04 我手動跑 `npm run generate-public-site` 9 秒 exit 0,檔案可正常獨占開啟 → 不是持久故障。
- 尚未手動 publish-pages(那是對外發布,等店主;10/30 11:30 的 catch-up 會自己重發)。10/30 11:30 要盯:publish-pages 是否 exit 0、slot-01.png 是否 200、posted-log 是否產生。
- `scripts/_watchdog.ps1:29` 會把任何 Disabled 的 `Laundry-*` 排程自動重新啟用(20:30:03 log:`Watchdog re-enabled disabled task: Laundry-LINE-Bot`)—— 10/29 20:30 重開 LINE 排程的是它,不是店主手動;店主的決定(ai 夜間備援)不變。
- YouTube:`youtube-upload.ps1` 只在 posted-log 有 IG live Reel 時才上傳;posted-log 缺 → 「No posted-log yet」;W43 排程 7 實發 0 要另查(10/23 改 dry-run 預設)。

## 10/30 12:00 早班結果(店機 + ai 都動了,都有獨立驗證)

### 現役版本(以此為準)
- **release/sxj-live-2026-10 @ `c9f67b75`,tag `sxj-live-2026-10-30`**,已推 origin。= integration/20261030 @ 83a85615 + 06:30 管線自動 commit febe7478。現役工作樹 `Documents\New project 5`(= junction `laundry-repo`)已切到 release;管線每日 commit 會落在 release。
- 殘留:工作樹 `stash@{0}` "wt-dirty-before-release-switch-20261030" 是切分支前的安全備份(內容已比對:兩個測試檔 HEAD 版較新,其餘相同),可 `git stash drop stash@{0}`。

### 店機 DESKTOP-HV0R4SN(A4-2 已上線 10:50)
- 四檔 SHA 與交付一致:webhook_server.py 161A4DD3…、tunnel_supervisor.py A7010A07…、test_tunnel_events.py 914C0E79…、test_webhook_log_ts.py 7DC89633…。備份 `C:\LaundryStores\fxwash\backups\A4-2-20261030-104930\`(含 files-before.xml / tasks-before.xml / shop-json-before.sha256)。staging 與腳本在 `C:\LaundryStores\A4-2-staging\`(a42-phase1.ps1 / a42-phase2.ps1)。
- 店機 3.11 離線 18/18 綠。啟動改走 `FXwash-Watchdog`(Start-ScheduledTask)而不是 ssh 內 Start-Process,避免 ssh 斷線帶走子程序。中斷 10:49:34–10:50:01。
- 證據:`logs\tunnel_events.jsonl` 10:50:06 url_detected→put_start→put_result 200→verify_result match;10:53:03 localhost.run 自己換網址(b7af4916f11039),supervisor 1 秒內 PUT+match → **A4-2 在正式環境已處理過一次真實換網址**。`webhook_server.log` 新行皆有 `YYYY-MM-DD HH:MM:SS`,舊行不回填。
- 獨立驗證:ai 機 GET endpoint = 店機 new_url;`POST webhook/test` 200 OK,店機 log 10:52:11 有這筆。
- 兩次自動回退(皆非程式問題):① PowerShell 單元素陣列被攤平成 CimInstance → `+` 失敗(改 `@()`);② embedded Python `python311._pth` 不含 cwd,`import runtime.webhook_server` 失敗(改 sys.path.insert runtime)。每次 watchdog 8 秒內拉回舊版。
- 店機隧道網址今天至少換了 5 次(5c4e3b8d→b7af4916→3a74b943→2d2270e7…),每次都靠 supervisor PUT。

### ai 機 line-bot(A4-3 + A2-b 已上線 11:29)
- `laundry-repo\line-bot` 32 檔 = integration 內容(tunnel_manager F2211B7D…、laundry_lookup 48A8C8A4…、conversation 68C00867…、arrival_notify 8F2B068C…、night_handover 8886F83A…、handover.json E1442E42…)。備份 `D:\AI-Lanes-work\_backups\ai-linebot\manual-20261030-112743\`(MANIFEST.json);A8 腳本自己留的 `20261030-110210-…`、`20261030-111210-…` 兩份已回復過,可刪。
- 離線測 46+16+76 全綠(venv python)。Probe exit 0,healthz ok。
- 11:34:33 新 tunnel_manager 偵測到 `show-success-doll-dana.trycloudflare.com` → `tunnel_url` + **`skipped_day`(白天不 PUT)**,LINE endpoint 仍是店機 ✅。
- **A2-b 第一次拉 mdb 成功**:10:54 `REPLACED` 54,693,888 bytes,source_mtime 10:54:20;ai `C:\FXwash\eHank.mdb` 從 10/17 舊檔更新;舊檔備份 `C:\FXwash\backups\eHank-20261030-1054.mdb`。`laundry_lookup.inventory_snapshot()` 讀到 source=ehank-mdb、data_as_of 10:54:20、stale=False、2254 客 / 1031 件。第一次嘗試 `SOURCE_CHANGED`(POS 營業中寫入,30 秒拷貝期間 mtime 變)→ 重試成功;營業高峰可能連續失敗,看 `%LOCALAPPDATA%\line-bot\mdb_pull.jsonl`。
- **尚未註冊排程**(Cowork 分類器擋 -RegisterTasks;且屬 D9):`register-night-handover-task.ps1`(20:05 夜間接手)、`register-mdb-pull-task.ps1`(10:30–19:30 每 30 分)。**今晚 20:00 店機關機後若沒註冊,LINE 無人接。**

### 部署事故(已復原,寫進 Error-Book)
1. A8 `deploy-ai-linebot.ps1` 以 `Documents\New project 5` 當 Target → `run_line_bot.ps1` 的 `Start-Process -ArgumentList '-u', $scriptPath` 沒加引號,路徑有空白 → python 找不到 `C:\Users\cyc39\Documents\New` → 三服務起不來 → 自動回退也起不來。**Target 一律用 junction `C:\Users\cyc39\laundry-repo`。**
2. A8 `Invoke-AiNative` 用 `ReadToEndAsync().Result`,子 powershell 起的 python 孫程序繼承 stdout 管線 → 孫程序活著就永不 EOF → 腳本卡死(11:12:46 起),等不到 90 秒 timeout(WaitForExit 已回但 .Result 掛住)。要改成不等孫程序管線(或改用 Start-ScheduledTask 啟動)。
3. 停 → 複製 → 起 的空窗撞上 `Laundry-LINE-Bot` 每 5 分鐘 tick:tick 的 run_line_bot.ps1 本身跑 30 秒(CIM 慢),我在它還沒跑完時 Stop,它就把剛殺掉的舊版再起來 → 「bot processes remain」。**要等 tick 後 `Get-ScheduledTask State -eq Ready` 再動手。**
4. 每次舊版 tunnel_manager 被重啟(回退、watchdog 拉起)就 PUT 自己的 trycloudflare 網址,白天搶走店機 endpoint:11:07–11:09、11:12–11:17(店機換網址自己搶回)、11:23–11:25。我各手動 PUT 店機網址回去(Set-LineEndpoint.ps1,GET 回讀 match)。影響:這三段客人訊息進到 ai 舊版 bot(有舊 mdb 10/17 → 可能回錯件況)。
5. 新 tunnel_manager 前兩次 cloudflared 90 秒內沒吐出網址(reader 連一行都沒收到),第三次 70 秒後才整批出來。推測:同一 IP 30 分鐘內開了 6 個 quick tunnel 被 Cloudflare 節流;isolation 測 40 秒內正常。90 秒 timeout 偏緊,先觀察。
6. `test_arrival_notify.test_r25_http_sum` 在 11:12 跑出 `PermissionError os.replace`(Windows 暫態),重跑綠;部署腳本要允許重試一次。

### 11:30 每日圖文(4 天停擺後第一次)
- 站已更新:`assets/2026-10-30/slot-01.png` 200(2.8 MB)、`posts/2026-10-30-slot-01.html` 200、IndexNow 200(207 URL)。
- **IG slot 1 成功**(post_id 18390124216225851)。
- **FB slot 1 沒發**:`data/scheduled-log/2026-10-30.json` 兩槽都是 10/27 23:14 schedule-ahead 寫下的 `uncertain`(「Missing or invalid image file」= 當時圖 404),狀態黏住「Not retrying」→ post-current-slot 直接沿用 uncertain 不發。11/01 兩槽同樣(10/29 21:40 寫的);10/28 也是。10/31 沒有 scheduled-log(10/28 的 schedule-ahead 沒產出)→ 明天 FB 會走直接發布。
- Graph API 唯讀查證:Page `scheduled_posts` = 0 筆(所以「可能已排程」是假警報);Page feed 最後一篇自動貼文 10/26 11:30,10/29 17:28 一篇(推測店主手發)。
- 解法(D10 待店主):把 10/30、11/01 的 FB uncertain 列清掉,讓 catch-up(12:00/14:00/20:30)或我手動 `post-current-slot --slot 1` 補發 FB;IG 已發同內容。

## 10/30 12:55 店主拍板後(D9=A、D10=A)
- **排程已註冊(ai)**:`Laundry-LINE-Night-Handover` 每日 20:05(venv python `night_handover.py`;`--status` GET 正常、`--dry-run` 判 day);`LineBot-PullShopMdb` 每日 10:30–19:30 每 30 分(19 個 trigger,ExecutionTimeLimit 4 分,MultipleInstances IgnoreNew)。`register-mdb-pull-task.ps1` 要帶 `-PullScript <絕對路徑>`,`$PSScriptRoot` 在 param 預設值為空。
- **FB uncertain 已清**:備份 `D:\AI-Lanes-work\_backups\fb-uncertain-clear-20261030\`(scheduled-log 10/30 為重建版、11/01 原檔、posted-log 10/30 原檔);`data/scheduled-log/2026-10-30.json`、`2026-11-01.json` 改為 `[]`,`posted-log/2026-10-30.json` 移除 FB uncertain 列。跑 `scripts/catchup-publish.ps1` → **FB slot1 12:54 發出 post 102911372343400_1119587520824396**(Graph API feed 已見)。slot2 20:30 自動。
- 12:04 catch-up 有「Publish alert delivered via staff_notify for 2026-10-29」:既有告警機制已把 10/29 缺發通知推到店員群(非 A7)。
- 自動檢查點:20:12 驗夜間接手、20:40 驗 slot2 與夜間狀態(本 session send_later)。
- 尚未做(等拍板):B3 週一 08:00、A5 03:30 排程註冊(屬持久化,一併等 D3/D4 時問);A3-2 店機部署;A7 部署;A8-2 修部署腳本(路徑引號 + 不等孫程序 + 等 tick Ready + 測試重跑一次)。

## 10/30 20:10 晚班
- 店主 19:50 拍板 4 題:D1=C(7 篇全補,10/31 起每天 16:00 一篇)、D3=A(A3-2 部署;因 19:50 才收到、店機 20:00 關機 → 改 10/31 10:32)、D4/D5=今晚 21:00 後部署 A7、告警推店員群、B3/A5 排程都註冊。
- 已註冊 `Laundry-Weekly-Report`(週一 08:00,下次 11/2)與 `SXJ-Live-Daily-Backup`(03:30;註冊腳本預設 SYSTEM/Highest 需管理員,改以 current user + Limited 註冊,備份不需要管理員);A5 先手動跑一次:`D:\AI-Lanes-work\_backups\sxj-live\20261030-1952` 2207 檔 Verified=True。
- **夜間接手實測**:20:05:02 `Laundry-LINE-Night-Handover` 跑了,`webhook_update` PUT 200 verify match(ai 網址)。但店機 20:06 還開著,其隧道換網址後 supervisor 又 PUT 回 lhr.life → ai 被蓋掉。原設計只在 20:05 跑一次,店機晚關機就會留下整夜死端點。**已把該排程改成 20:05 起每 15 分重跑到 09:55**(night_handover 是冪等的:endpoint 已是 ai → `already_ai` 不 PUT;白天 → `day_window` 不 PUT)。店機關機後最多 15 分鐘 ai 接手。
- A9 補發排程器卡已派 Codex(worktree `C:\Users\cyc39\AI-Lanes\a9\repo`,branch feat/a9-backfill-scheduler),20:00 開工。
- 自動檢查點:20:40 slot2 + 夜間狀態;21:00 A7 部署;10/31 10:32 A3-2 店機部署。

## 10/30 21:15 晚班(店主 20:30 指示:剩餘幾天「先用完 API 額度不用計算」;所有產碼/設計/審查改走 Anthropic API,我只做執行與驗證)
- **API 已開始用**(`C:\Users\cyc39\AI-Lanes\claude-api\claude_api.py`,Opus 5.5):今晚 6 筆,約 US$6。教訓:`--effort high` + 大任務 → 64000 token 全被 thinking 吃掉、答案空白(US$1.4 白花);改 `--effort medium --max-tokens 120000`,大任務拆兩段。提示檔與答案都在 `C:\Users\cyc39\AI-Lanes\api-jobs\<job>\`;`api-jobs\extract_files.py` 把 `=== FILE: ===` 區塊落檔。
- **A8-2 完成並合進 release(a840cb18)**:deploy-ai-linebot.ps1 修四個實戰 bug(Target 一律正規化成 junction、Start 改走 `Start-ScheduledTask Laundry-LINE-Bot` + Probe 輪詢、管線讀取有上限不再卡死、tick-safe window 純函式、離線測試重試一次、回退印 WARNING);`run_line_bot.ps1` 補引號。35 Pester 綠(26 舊 + 9 新),變異「拿掉重試」→ 2 紅。**現役 `run_line_bot.ps1` 已是新版(只差引號)**。
- **B2-2 完成(feat/b2-attribution @ 46091f1b,未合併未部署)**:`shop-pc/fxwash/runtime/attribution_service.py` + 40 unittest,**在店機 3.11 embedded 實跑 40/40 綠**(`C:\LaundryStores\B2-staging`);`ATTRIBUTION-HOOK.md` 是 webhook_server.py 的接線說明(我之後自己套);`tools/make_attribution_secret.py`、範例 `data/attribution/source-codes.json`。
- **A4-4 完成(feat/a4-4-shop-night-skip @ 11e6f93a,未部署)**:店機 tunnel_supervisor 夜間(20:00–10:00)不 PUT、寫 `skipped_night`,白天開始時 `day_start_register` 補登;22 測試在店機 3.11 綠;變異「永遠白天」→ 4 紅。**今晚實測到的問題**:店主 21:00 後店機還開著,店機每次換網址就搶回 endpoint,ai 每 15 分搶回(ping-pong,兩邊 bot 都活著所以客人不受影響)。明天 10:32 與 A3-2 一起部署店機。
- **A2-b 排程 bug 修好**:`LineBot-PullShopMdb` 從 13:00 起每 30 分都 rc=1 無 log —— 排程動作少了 `-ExecutionPolicy Bypass`(機器策略 Restricted)。已改排程動作並手動跑成功(20:44 REPLACED,source_mtime 20:00:08);register 腳本修正已 commit(3b3f335d)。
- **A7**:release 切換時已在跑(12:04 告警推店員群即證據);現役目錄 smoke 36 案綠;等 21:40 Schedule-Ahead 跑過看 mutex。店主 D4/D5 = 21:00 後 + 推店員群 → 等同已完成。
- **A9 補發排程器**:Codex r1 完成(43 smoke、變異 14 紅、7 篇文案日期字檢查全 pass);**API 獨立審查 → SHIP WITH FIXES,11 項缺陷**(一天只准一筆、npm timeout + 殺樹、A7 mutex 契約驗證、原子寫隊列、日期字 regex 補台灣用法、掃所有欄位、隊列搬出 git 等)已派 Codex r2(進行中)。審查全文 `docs-internal/cards/A9-REVIEW-r1.md`。
- 半成品 3 檔已封存 `D:\AI-Lanes-work\_archive\suspect-20261030\`(D7=A)。R11 新 POS:店主說是他另一個專案,本計畫不碰(D6)。
- B2 其餘卡(待派 API):B2-1 內容端來源碰(contentPlan.ts + 測試,需 Codex 跑 vitest)、B2-3 離線比對匯出器、B2-4 週報 reader。

## 10/30 22:00 晚班收工
- **release/sxj-live-2026-10 @ c4316f7e**(含 A8-2、A9);feat/b2-attribution @ 78ad0528(B2-2/B2-3/B2-4,未合併);feat/a4-4-shop-night-skip @ 11e6f93a(未合併未部署)。全部已推 origin。
- **A9 補發排程器已上線**:`Laundry-Backfill-1600` 每日 16:00(10/31 起,EndBoundary 11/07),現役 `scripts/backfill-publish.ps1`;seed 6 筆(10/27–10/29 各兩槽;**10/26 slot 2 當天沒產圖沒核准,不是漏發,移除**);首次執行會把 seed 複製成 `output/backfill/queue.json`;`-Stop` 可中止並停用排程。Codex r1→API 審查(11 項)→r2→r3(日期字只掃會發出去的 caption/first comment);我原生跑 smoke 129/129、live DryRun 第一筆 2026-10-27 s1 pass。
- **B2-3 完成**:attribution_export.py(41 測,店機 3.11 連 B2-2 共 81 綠;變異終點邊界/跨日 → 紅)。**B2-4 完成**:weekly-report.py 讀 conversions 彙總出三欄(30 測綠;真資料 dry-run 52 行 exit 0)。B2 只剩 **B2-1 內容端來源碼**(改 contentPlan.ts caption,客人看得到,文案要店主拍板)與店機接線(webhook_server 套 ATTRIBUTION-HOOK、產 HMAC key、部署)。
- **Schedule-Ahead 21:40 正常**:11/02 兩槽 FB 已預排(scheduled_post_id 皆有,無 uncertain)—— 停擺修好後第一次成功預排。
- 夜間:店機 21:50 仍開著,endpoint 在 ai(21:50 handover PUT match);店機換網址會再搶,A4-4 明天部署後根治。ai Probe ok;mdb 20:44 已拉到 20:00 版本。
- API 今日累計(含其他 session)US$20.83;本 session 今晚 8 筆約 US$9。
- 明天 10/31:10:32 店機部署 A3-2 + A4-4(自動提醒已排);11:30 盯發文;16:00 第一篇補發(16:20 看 `output/backfill-logs/`);B2-1 文案問店主後派 API。


## 10/30 24:00 round (C4 / B1-2 / B2-5 / B2-6 / SD-1)

All API jobs ran on Opus 5.5 (claude-opus-5-5), `--effort medium`. This round's spend, from usage-log:
- c4 $1.14, b2-5 $1.05, c4-r2 $1.15, b1-2 $1.48, b2-6 $1.74.
- sd-1: r1 cut off at max_tokens ($2.63); p1 fallback ($0.32, answer discarded); p1b refused ($1.02); p2 refused ($0.02).

Owner decisions recorded (Docs tables + SHOP-FACTS):
- C01–C04 A; C05 C (unchanged); C06 A; C07 A 「台中市免費到府收送」; C08 A; C09 現金、LINE Pay、轉帳; C10 A; C11 B (keep).
- D6: POS is another project. D7 A. D8 A.
- D11: B2-1 no source code for now. D12: keep 90 days, then weekly stats only. D13: B2 goes live tomorrow afternoon.

### Status by card

| Card | Branch @ commit | Status | Verification |
|---|---|---|---|
| C4 repurchase backtest | feat/c4-crm-backtest @ b97e8667; merged into release @ fb35e18b; pushed | Done | 54 tests; 12 of 13 mutations red (the remaining one is equivalent) |
| B1-2 bot facts | feat/b1-2-bot-facts @ 6fbef128; pushed; not merged | Ready; shop deploy tomorrow, ai bot during the day | see below |
| B2-5 webhook wiring | feat/b2-attribution @ 9cd60fc0 | Done, default OFF | 148 tests; 5 of 7 mutations red |
| B2-6 90-day retention | feat/b2-attribution @ eba312b1 | Done | 168 tests; 6 of 7 mutations red |
| SD-1 shop deploy scripts | feat/sd1-shop-bundles @ 555a166a | Ready for tomorrow | smoke 9 + 2 cases; 6 of 6 mutations red |

**C4 notes**
- r1 deduped by Did (the order id), which collapsed 36,946 pieces to 12,891. The error came from the commander's brief.
- r2 dedupes by Did+Dno, giving 37,989 pieces (20 duplicates merged).
- Real run over 28 months:
  - The due rule's lift is 0.88, worse than the baseline.
  - multi_lapsing (≥3 visits, 0.8–2.0× cycle) hits 55.4% vs 35.0%, lift 1.59, above 1 in all 28 months.
- 76 candidates. The CSV is only in data/crm (git-ignored).
- PII scan of the report: 0 names, 0 phones.
- Commander text fixes: the Deh/Det labels, and a note on when the alternative rules were added.

**B1-2 notes**
- Edited with edit blocks, then two commander fixes:
  - 地毯 moved into the 10–14 天 group (C03 A). The brief had listed 地毯 as uncovered by mistake.
  - The pickup opener now includes 營業時間內約 (C08).
- Shop: 51 tests.
- line-bot:
  - test_b1_facts 9/9.
  - test_conversation 56/60 and guided 26/27; these are the same pass/fail sets as baseline.
  - The pre-existing failures need line-bot/_sandbox_repo, which does not exist in the live tree either.
- 6 of 6 mutations red.

**B2-5 notes**
- The two mutations that survived: BOM untested (low risk), and strip-when-ok, which is an equivalent mutant.

**B2-6 notes**
- The live ledger detects a replaced file through a .gen generation file and the file id.
- Cutoff is floored to an ISO Monday. Retention below 30 days is refused.
- Missing or immature weekly summaries are exported first.
- Binding rows are kept minimally, proven by timeline equality.
- The surviving mutation, R3, is still caught by the second guard.

**SD-1 notes**
- The Opus 5.5 API refused this task three times under its cyber classifier. The fallback-model answer was discarded, since the owner requires Opus 5.5 or later.
- The commander generalized the proven a42 phase scripts into bundle-phase1, phase2 and rollback for A3-2, A4-4, B1-2 and B2.
- Staging dirs `api-jobs/shop-deploy-1031/stage-*` are built, and their hashes equal the expected values.
- Run sheet: shop-pc/DEPLOY-1031.md.

### Live and other notes
- 23:55: night endpoint = ai trycloudflare, active=True. The handover is OK.
- Another Claude session committed 1f107f04 on release at 22:39 (Google 商家名稱「私享家洗衣店」 in business-profile). Two consequences:
  - Two writers are now on release. Use explicit file lists and explicit merges.
  - The live tree has dirty docs/ outputs from the daily pipeline; leave them alone.
- 10/31 reminders:
  - New 10:31 send_later trig_01PT7pr72cJgy6wxtW5BGRf5 has the new plan.
  - The old 10:32 trig_01MjFjKYYpFYVLaVSkU7pkqS could not be edited or disabled: the prompt change needs device approval, and disabling was denied by the classifier. When it fires, treat it as superseded.
  - 16:22 backfill check is unchanged.


## 10/31 01:15 addendum

### Owner decisions
- **D14 A** (C4 list): contact no one. Next week the API writes the C5 controlled-test card.
- **D15 B** (website wording): the website also changes to 「台中市免費到府收送」.

### B1-3 status: feat/b1-3-wording @ 952392b2, WIP, pushed, not merged
- Generator and site edits came from the API (Opus 5.5, $1.78).
- Commander applied the seo-overrides phrase map deterministically: 349 replacements, 0 old variants left.
- tsc is clean.

vitest, run with only PUBLIC_SITE_BASE_URL set:

| Run | Failing tests |
|---|---|
| Baseline | 28 (environment-related) |
| B1-3 | 22, of which 5 are new |

All 5 new failures are frozen-content guards:
- PROTECTED_LIVE_COHORT_HASHES (5 cohort pages)
- PROTECTED_INDEX_GROWTH_LOCKS shoe guides (indexGrowthPages.ts reverted for now)
- luxuryShoeCase boundary 免費收送、無低消
- seoSyncP1 frozen digest
- checked-in docs/ai-discovery stale until regeneration

Next steps:
- The locks have been re-frozen before on owner instruction (comments dated 09-12 and 09-20). D15 B is that instruction.
- After the 10/31 deploys:
  - Change the locked bodies.
  - Recompute the hashes with a script (do not have a model guess them).
  - Add a "Re-frozen 2026-10-31 per owner D15" comment.
  - Update the frozen digests.
  - Run the full vitest.
  - Merge, then let the 11/01 11:30 pipeline publish.
- data/publishing-policy.json is git-ignored live data. Apply `api-jobs/b1-3/answer-live-data.md` after the merge.


## 10/31 03:20 addendum (owner asked why I stopped; resumed)

- **B1-3 r2** feat/b1-3-wording @ 62486804, pushed, NOT merged:
  - Re-frozen by script-computed hashes, using ops/b1-3-lock-hashes.ts:
    - 3 index-growth shoe guides
    - 5 live cohort pages
  - Old-vs-new projection diff: all area wording.
  - luxuryShoeCase now checks visible text.
  - seoSyncP1 digest re-pinned: old render sha = old pin, and the diff is wording plus wordCount.
  - Full vitest: no new real failures. Two PowerShell tests are flaky; they pass alone on both trees.
  - ai-discovery stays stale until docs are regenerated.
  - No overlap with the live tree's dirty files.
  - **Merge only after the 10/31 11:30 publish is verified** (locked day calendars 10/31-11/02 stay untouched).
- **C5** merged into release @ 0ee10198:
  - c5_assign/c5_evaluate/test_c5 plus the C5-CARD.
  - 69 tests; mutations 5/6 red. The one surviving mutation is the double guard.
  - Dry-run on the real list: 38/38, k=11, nothing written.
  - The greeting text waits for owner approval.
- API this addendum: b1-3 $1.78, c5 $0.96.