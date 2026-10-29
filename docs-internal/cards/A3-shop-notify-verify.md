# 任務卡 A3(唯讀驗證):店機入庫/完工通知到底怎麼發、會不會誤發

總指揮:Claude(Cowork) 日期:2026-10-29 執行者:Codex(gpt-6.1-sol) 本卡唯讀,不改任何檔
工作目錄:C:\Users\cyc39\Documents\New project 5

## 背景(已查證,不用再證)
- 正式 LINE bot 在店裡電腦 `C:\LaundryStores\fxwash`(FXwash kit 1.1.0-candidate)。程式快照在本 repo `shop-pc/fxwash/`(不含 secrets/data/logs)。
- 店機的 `runtime/inbound_monitor.py` 每 6 秒掃 eHank.mdb,對已綁定客人**真發** LINE push(`api.line.me/v2/bot/message/push`),沒有 dry_run 開關。
- 店機 logs/data 的複本在 `C:\Users\cyc39\AI-Lanes\shop-pc-ops\20261029\`:`monitor_state.json`(last_did、completed_dnos…)、`customer_bindings.json`、`webhook_server.log`(無時間戳)、`watchdog.log`、`webhook_err.log`。**這些含客人 LINE userId,只在本機讀,不要抄進 RESULT。**
- 店機每天 20:00 關機、10:00 開機。

## 要回答的問題(每題附程式行號或檔案證據)
1. 推播觸發條件:什麼資料變化會觸發「入庫」通知、什麼觸發「完工/可取」通知?判斷依據是 eHank 哪個表/欄位(對照 `shop-pc/fxwash/bridge/ai_engine/db_manager.py` 與 `runtime/lookup_service.py`)?
2. 去重與持久化:`monitor_state.json` 的 `last_did`、`completed_dnos` 怎麼用?**店機每天關機重開後**會不會重發昨天的?第一次啟動(state 不存在)會不會把歷史全部當新件發出去?
3. 誤發風險:哪些情況會發給錯的人(綁定錯、同客號多人、件號重用)?哪些情況會漏發(mdb 鎖住、讀失敗、push 失敗後有沒有重試)?
4. 通知文案:把程式裡實際會發出的每一種訊息原文列出來,對照店主定的對客事實:一般衣物 5–7 天、鞋 7 天、難乾大件 10–14 天、皮件包 14 天;**不寫價格**;不標 AI 生成;不冒充真實客件。有衝突的標出來。
5. 從 `monitor_state.json` 複本統計:completed_dnos 有幾筆、最早到最晚的件號範圍、`last_did`;從 `watchdog.log` 統計 10/29 當天 inbound monitor 被重啟幾次。
6. `webhook_server.log` 為什麼沒有時間戳(找程式裡的 log 寫法)?加時間戳要改哪幾行?

## 交付
把完整回報(繁體中文)當成你的最後一則訊息輸出,總指揮會存成 `docs-internal/cards/A3-RESULT.md`。結尾給一張表:「風險 | 證據 | 建議修法(一句話) | 要改的檔」。不要改任何檔、不要連店機、不要呼叫任何 API。
