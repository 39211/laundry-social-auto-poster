# OPS-L1-12 r1 實作與交接

驗收目標：每天輸出 12 項結果，完整零客人受影響事故統計與 12 項都過才累加日曆天；連 3 天才達成。owner 是店主、總指揮與獨立驗收是主幹 Claude；本席只實作與離線驗證。第 11 項尚未上線，固定 `not_ready`，目前實際連續天數必為 0。

授權範圍：只寫此 worktree 的程式、測試與交付證據。現役只讀來源；不改排程、bot、店機、帳號或服務，不連外網。沒有跨家族審查或正式上線驗收。

## 資料來源與缺口

表中日期以 `<date>` 代表台北日曆日。新增的「待提供介面」沒有現成 producer，也沒有產生任何正式假資料。離線測試中的假資料不會放進現役。

| # | 現有來源與欄位 | 判定／還缺什麼 |
|---|---|---|
| 1 | `%LOCALAPPDATA%/line-bot/tunnel_events.jsonl`：`ts,event,verify_status,status`；`line-bot/handover.json` | 事件不足以證明準時交還與完整可用性。缺完整每日彙總；讀取介面為 `data/gates/ai-service-<date>.json`，不存在則 `no_data`。不讀含網址的 tunnel 原始事件來拼湊停機零分鐘。 |
| 2 | `data/line-usage/<date>.json`：`schema,messages,by_outcome.auto/ai/to_staff/not_understood/other`；寫入語意見 `line-bot/line_usage.py` 與 `conversation.py` 的 `count_reply` | 現有數字只是「回覆決定後分類」，沒有實際收訊與回覆送達帳。缺 `data/gates/line-accounting-<date>.json` 的互斥完整計數；不能把轉真人算沒回，也不能從分類數推定零漏回。評估器只列 usage 路徑，**不開啟 usage 或任何客人訊息／inbox／sessions／uid 檔**。 |
| 3 | `line-bot/tests/test_audit_a_conv.py`、`test_audit_a_quote.py`；`tests/golden/run_golden.py` 與固定 cases/golden | 隔離執行的 `output/operations/level1-checks-<date>.json`：`schema,date,generated_at,offline,checks.copy_audit/golden`。兩者都過才過。只認該日產生的證據，今日測試不能回填昨日。 |
| 4 | `line-bot/run_a2b_tests.py`、遞迴尋找所有 `test_*.py`（包含 `tests/`） | 同一結果檔 `checks.line_full`；任何失敗為 `fail`，未完成／零案例／跳過為 `no_data`。既有假紅照原樣保留，沒有修 bot 或篩除紅例。 |
| 5 | `line-bot/test_handoff.py`：持久化、claim/release、事件去重與 webhook 停回覆 | 同一結果檔 `checks.handoff`。這是離線交接契約測試，不是手機或真人店員實收證據。 |
| 6 | `data/gates/notify-<date>.json`：`date,sent,no_binding,abandoned`；前一營業日同檔；producer 正本 `shop-pc/fxwash/runtime/notify_report.py` | 營業日 `sent>0`，`no_binding/(sent+no_binding+abandoned)` 下降或維持 0；前一營業日無樣本不能判過。週日無通知需求為 `not_applicable`。不去店機或讀 outbox。 |
| 7 | 同一 notify 檔：`duplicates,wrong_sends,wrong_sends_basis` | 正數直接 fail。現有 `wrong_sends_basis=auto_duplicate_deliveries` 只量重發，不量寄錯人；還缺完整來源／損毀行統計及獨立全量誤發核對。可接受的完整介面需 `corrupt_lines=0` 與 `wrong_sends_basis=reviewed_all_deliveries`；目前沒有這個 producer，不能人工改欄位冒充證據。 |
| 8 | `%LOCALAPPDATA%/line-bot/mdb_pull.jsonl`：`ts,result,exit`；`handover.json`；`tunnel_manager.py` 的營業時間 helper | 沿用既有成功拉取與 60 分規則，含開店到首筆、末筆到關店。只量資料間隔，不是 LINE 回覆時間。載入 helper 不產生現役 `__pycache__`。 |
| 9 | `data/publishing-policy.json`：`status,platforms,slots,pauses`；`docs/assets/<date>/slot-NN.*`；`data/posted-log/<date>.json`：`slot,platform,status,dry_run`；補發摘要 | 完整保留既有已產製 slot 排程範圍與 OPS-L1-10 覆寫，不變更發文政策。`dry_run` 必須明確 false。 |
| 10 | `data/gates/publish-recovery-<date>-slotN-<platform>.json`：`date,slot,platform,status,retry_attempts,notification`；posted-log 的實際失敗 | 重試 1 次且 resolved，或 `notification=delivered` 才過。只排隊重試／已 claim 但沒完成不算過。已知貼文失敗而缺 receipt 為 fail；沒有任何失敗處理證據是 no_data，不當零。 |
| 11 | 未就緒；不接受任何 `restart-<date>.json` 覆寫 | 任何輸入一律 not_ready。 |
| 12 | `output/day-reports/<date>.json`：`date,generated_at`；producer 為 `scripts/day-audit.ps1` | 產出日一致、台北時間 23:40 這一分鐘才過。`ok=false` 不影響「有報告」這一項；其餘錯誤由各項負責。`nightly-optimize` 是其他時段報告，不能代替 23:40 日結。 |

另有必須的「客人受影響事故」證據：目前缺 `data/gates/incidents-<date>.json`，介面為 `date,complete=true,customer_affected`。缺資料會阻止當天與連 3 天通過；不會造一個零事故數字。

## 待提供介面

- `ai-service`：`date,complete=true,coverage_start,coverage_end,takeover_at,handover_at,max_downtime_seconds`。覆蓋台北完整一天，時間含時區；週一至五接手 20:05，週六 18:05，交還 09:50，週日全天由 AI，最大停機 ≤300 秒。`complete` 必須由實際完整監測得出，不能由稀疏事件假定。
- `line-accounting`：只允許 `date,complete,received,replied,to_staff`。三個非負整數，回覆與轉真人是互斥處理結果，同一筆不能重算；`received=replied+to_staff` 才過。這裡不能加文字、uid 或電話欄位。
- 離線測試每組都有 `status,tests,failures,errors,skipped`。零案例、skip、錯日／未完成不可過；同日完整 runner 結果才能使用。
- 通知的誤發核對與事故彙總尚缺 producer；本卡只定義可讀介面，沒有安裝新的收集器。

## 執行與證據

```powershell
# 全部是假資料；測試框架的暫存檔只在此 worktree。
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 test/ops_l1_python.py test_level1_checklist.py test_level1_offline_checks.py test_level1_gates.py 'test_weekly_report*.py' test_publish_recovery_reports.py
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 test/ops_l1_12_mutations.py

# 只複製明列的程式與公開設定、synthetic test-assets，不複製 secrets、session、inbox 或正式資料。
# 阻擋所有網路（包括 loopback）與未受保護的子程序；需要這些能力的測試會照實不過。
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 scripts/level1_offline_checks.py

# 真資料只讀；JSON、Markdown 都輸出此 worktree。
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 scripts/level1_gates.py 2026-11-07 --root 'C:/Users/cyc39/laundry-repo' --out-root 'C:/Users/cyc39/AI-Lanes/wt/l1check'
```

機器輸出保留舊 `conditions` 三項供既有工具讀取，新增 `checklist` 的字串鍵 `1`–`12` 與 `incidents`。`checklist_summary` 為新驗收正本；舊 `level1_summary`、7 天 streak 僅為相容，不作本卡達標宣告。報告最上方先列最新已結束日的項數、未過原因與連續天數。

重新讀取歷史結果時，第 11 項也會正規化成 `not_ready`；快取中的 `pass` 不能啟用尚未上線的功能。純計算器用假資料驗證全過 3 天與斷點，實際來源一律先經 evaluator／loader 的第 11 項護欄。

四個破壞版本在獨立複本執行，紅例：

| 破壞 | 必須變紅的測試 |
|---|---|
| 缺資料當過 | `ChecklistTests.test_all_missing_is_no_data_and_11_not_ready` |
| 第 11 項可判過 | `ChecklistTests.test_11_never_passes_with_any_receipt` |
| no_data 不斷連續天數 | `ChecklistStreakTests.test_no_data_breaks_streak` |
| 轉真人當沒回 | `ChecklistTests.test_02_transfer_is_answered_and_gap_fails` |

輸出：`output/operations/ops-l1-12-mutations-*/proof.json` 與每輪文字紀錄，含候選／還原 SHA 核對。實際來源唯讀快照及輸出：`output/operations/ops-l1-12-live-readback.json`、`level1-gates-2026-11-07.json` 與 `reports/level1-gates.md`。

本輪暫存複本 LINE 稽核結果保存在 `output/operations/level1-checks-2026-11-08.json`，包含每個模組及其文字 log 路徑。copy audit 通過；golden 達 90 秒時限未完成，為 no_data；LINE 全測試與 handoff 有錯誤，沒有宣稱全綠。已確認的環境阻礙包括 Flask shim 不支援 `.post(json=...)`、`.get()`，測試自己的檔案護欄與 runner 清理衝突，以及網路／子程序測試被外層護欄阻擋；這些不等於已證明現役有相同 bug，也不能當已驗收通過。當天的測試沒有用來回填 11/07。

## 總指揮接手

不在本卡內註冊或更動任何排程。`level1_offline_checks.py` 是同日離線證據入口；若要每天自動供第 3–5 項使用，總指揮需在原授權流程整合，並保留測試 snapshot 與日期。尚無 producer 的欄位維持 no_data。

本環境只允許 worktree 寫入；共用 `.git` 與 Vault 在可寫範圍外。若 commit 被拒，精確訊息存 `output/operations/OPS-L1-12-r1-COMMIT-MESSAGE.txt`；只 stage 本卡列出的檔案。Vault `task_summary` 由總指揮在獨立驗收後回存，本席沒有越權寫入。
