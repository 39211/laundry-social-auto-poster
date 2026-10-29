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
