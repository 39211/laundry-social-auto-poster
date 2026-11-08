# OPS-L1-12 r3 實作與交接（沿用 r1 路徑）

驗收目標：每天輸出 12 項結果，完整零客人受影響事故統計與 12 項都過才累加日曆天；連 3 天才達成。owner 是店主、總指揮與獨立驗收是主幹 Claude；本席只實作與離線驗證。第 11 項尚未上線，固定 `not_ready`，目前實際連續天數必為 0。

授權範圍：只寫此 worktree 的程式、測試與交付證據。現役只讀來源；不改排程、bot、店機、帳號或服務，不連外網。沒有跨家族審查或正式上線驗收。

## 資料來源與缺口

表中日期以 `<date>` 代表台北日曆日。新增的「待提供介面」沒有現成 producer，也沒有產生任何正式假資料。離線測試中的假資料不會放進現役。

| # | 現有來源與欄位 | 判定／還缺什麼 |
|---|---|---|
| 1 | a/b：`%LOCALAPPDATA%/line-bot/tunnel_events.jsonl` 的 `ts,event,verify_status,registered_owner/owner`。c：`%LOCALAPPDATA%/sxj-heartbeat/log/<UTC-date>.jsonl` 的 `time,mode,checks.bot/local/public/line`，依 `wt/heartbeat/ops/heartbeat/heartbeat_sampler.py` 的 `_write_log`／`_report` | a 接手、b 隔日交還、c 中間沒停機各自輸出 `subchecks.a/b/c`，Markdown 分三列。接手只認 `night_reclaim/webhook_update`；交還沿用經驗證的 shop 事件。**tunnel 事件與 healthz 均不參與 c 的間隔計算。** |
| 2 | `data/line-events/<date>.json`：`received,replied_ok,reply_failed,to_staff,no_reply_needed` | **producer 是另一張 LINE 事件計數卡**：由 `line-bot/line_webhook.py` 的收訊與實際回覆結果接計數器，產出這五個非負整數；本卡不改 webhook。缺檔／缺欄位為 `no_data`。舊 usage 分類不能取代送達證據；不開啟訊息／inbox／sessions／uid。 |
| 3 | `line-bot/tests/test_audit_a_conv.py`、`test_audit_a_quote.py`；`tests/golden/run_golden.py` 與固定 cases/golden | 隔離執行的 `output/operations/level1-checks-<date>.json`：`schema,date,generated_at,offline,checks.copy_audit/golden`。兩者都過才過。只認該日產生的證據，今日測試不能回填昨日。 |
| 4 | `line-bot/run_a2b_tests.py`、遞迴尋找所有 `test_*.py`（包含 `tests/`） | 同一結果檔 `checks.line_full`；任何失敗為 `fail`，未完成／零案例／跳過為 `no_data`。既有假紅照原樣保留，沒有修 bot 或篩除紅例。 |
| 5 | `line-bot/test_handoff.py`：持久化、claim/release、事件去重與 webhook 停回覆 | 同一結果檔 `checks.handoff`。這是離線交接契約測試，不是手機或真人店員實收證據。 |
| 6 | `data/gates/notify-<date>.json`：`date,sent,no_binding,abandoned`；前一營業日同檔；producer 正本 `shop-pc/fxwash/runtime/notify_report.py` | 營業日 `sent>0`，`no_binding/(sent+no_binding+abandoned)` 下降或維持 0；前一營業日無樣本不能判過。週日無通知需求為 `not_applicable`。不去店機或讀 outbox。 |
| 7 | 同一 notify 檔：`duplicates,wrong_sends,wrong_sends_basis` | **需由店機 `shop-pc/fxwash/runtime/notify_report.py`（或其受核准的全量核對輸入）產出** `date,sent,duplicates,wrong_sends,outbox,corrupt_lines,wrong_sends_basis`，並經訂單應收對象與實際送達對象的完整核對，才可設 `wrong_sends_basis=reviewed_all_deliveries`。現行程式只把 duplicates 當 wrong_sends，尚無寄錯對象核對來源，所以維持 `no_data`。正數直接 fail；通過另需 `outbox!=missing,corrupt_lines=0`。本卡不讀店機原始對象資料，也不假造核對欄位。 |
| 8 | `%LOCALAPPDATA%/line-bot/mdb_pull.jsonl`：`ts,result,exit`；`handover.json`；`tunnel_manager.py` 的營業時間 helper | 沿用既有成功拉取與 60 分規則，含開店到首筆、末筆到關店。只量資料間隔，不是 LINE 回覆時間。載入 helper 不產生現役 `__pycache__`。 |
| 9 | `data/publishing-policy.json`：`status,platforms,slots,pauses`；`docs/assets/<date>/slot-NN.*`；`data/posted-log/<date>.json`：`slot,platform,status,dry_run`；補發摘要 | 完整保留既有已產製 slot 排程範圍與 OPS-L1-10 覆寫，不變更發文政策。`dry_run` 必須明確 false。 |
| 10 | `data/gates/publish-recovery-<date>-slotN-<platform>.json`：`date,slot,platform,status,retry_attempts,notification`；posted-log 的實際失敗 | posted-log 存在且沒有實際 failed/uncertain 列，為 `not_applicable`（含合法空陣列）；缺檔／損毀仍 `no_data`。有失敗才檢查重試 1 次且 resolved，或 `notification=delivered`；缺結果、只排隊、未送達皆 fail。後續 success 不會抹除當天曾有失敗的事實。 |
| 11 | 未就緒；不接受任何 `restart-<date>.json` 覆寫 | 任何輸入一律 not_ready。 |
| 12 | `output/day-reports/<date>.json`：`date,generated_at`；producer 為 `scripts/day-audit.ps1`，現有 Laundry-Day-Audit 排程 22:50 | 報告 date 為受測日，產出時間落在該日 22:00 至隔日 01:00（含端點，台北）才過，**沒有檔案為 fail**。舊 producer 的無時區時間明確依台北解讀；有時區則換算台北。`ok=false` 不影響「有報告」這項。錯日期／壞格式為 no_data，已知超窗則 fail；不要求某一分鐘。 |

另有必須的「客人受影響事故」證據：目前缺 `data/gates/incidents-<date>.json`，介面為 `date,complete=true,customer_affected`。缺資料會阻止當天與連 3 天通過；不會造一個零事故數字。

## 待提供介面

- 第 1 項的受測日期代表**當晚至隔日 09:50**；平日 20:05、週六 18:05 起算，週日／設定店休日從 00:00 起算，所以涵蓋全天 AI。隔日店休時 b 不適用，c 仍檢查同一段至隔日 09:50；週日全天的後半段由週日那筆驗收涵蓋。
- a 接手：指定時間後 0–300 秒內有 `night_reclaim/webhook_update`、`verify_status=match` 且 owner 未指定或為 ai 才過。檔案存在但沒有合格事件（含遲到、mismatch、只有 noop）為 fail；事件檔缺失／損毀為 no_data。週日／設定店休日無需切換，為 not_applicable。
- b 交還：只檢查**隔日** 09:50 後 0–300 秒內的 `day_handover/handover_to_shop/handover_return/handover`，須 `verify_status=match` 且 `registered_owner/owner=shop`。同日早晨不能充當隔日交還；隔日週日／設定店休日為 not_applicable。缺合格事件為 fail，缺檔／損毀／無法確認營業設定為 no_data。
- c 中間沒停機：只讀心跳採樣器本機日誌。檔名使用 **UTC 日期**，列內 `time` 須含時區，換算台北後只算受測區間。固定週期相鄰紀錄 >300 秒，或 LIVE 的 bot／local／public／LINE 整體通路連續失敗 >300 秒，均 fail；300 秒仍可過。通路失敗至首筆恢復的時間算入持續失敗，末段未恢復也檢查已觀測長度。沒有日誌、紀錄不足、邊界逾 5 分缺紀錄、DRY_RUN、未完成通路採樣或損毀為 no_data；已知超標 fail 優先保留。外部 ping 送達失敗與總退出碼不等於客服通路停機。三個子判定都 pass／not_applicable 才算第 1 項 pass。本卡沒有安裝或啟動採樣器。
- 第 2 項五個非負整數必備；另允許 `date,schema,generated_at,complete` 中繼資料，若提供 date 必須相符、complete 不可 false。計數卡須使 `replied_ok,to_staff,no_reply_needed` 為互斥終態，`received=replied_ok+to_staff+no_reply_needed` 且 `reply_failed=0` 才過；仍有未處理或回覆失敗為 fail，處理數大於收到數為 no_data。不得加入文字、uid 或電話。本席先接格式；另一張計數卡須核對這個終態契約，避免把重試次數或重疊事件當訊息筆數。
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
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -B -X utf8 scripts/level1_gates.py 2026-11-07 --root 'C:/Users/cyc39/laundry-repo' --out-root 'C:/Users/cyc39/AI-Lanes/wt/l1check/output/operations/ops-l1-12-r3-live'
```

機器輸出保留舊 `conditions` 三項供既有工具讀取，`checklist` 的字串鍵 `1`–`12` 與 `incidents` 為本卡正本。r3 `rules_version=4`，r1/r2 舊版快取不能累加新規則的連續天數。`checklist_summary` 為新驗收正本；舊 streak API 僅相容保留，**Markdown 報告只呈現 12 項與連 3 天，沒有舊三條件段落**。第 1 項另列 1a／1b／1c，不增加主項目數量。

重新讀取歷史結果時，第 11 項也會正規化成 `not_ready`；快取中的 `pass` 不能啟用尚未上線的功能。純計算器用假資料驗證全過 3 天與斷點，實際來源一律先經 evaluator／loader 的第 11 項護欄。

十個破壞版本在獨立複本執行，r2 七個仍須紅：

| 破壞 | 必須變紅的測試 |
|---|---|
| 缺資料當過 | `ChecklistTests.test_all_missing_is_no_data_and_11_not_ready` |
| 第 11 項可判過 | `ChecklistTests.test_11_never_passes_with_any_receipt` |
| no_data 不斷連續天數 | `ChecklistStreakTests.test_no_data_breaks_streak` |
| 轉真人當沒回 | `ChecklistTests.test_02_transfer_is_answered_and_gap_fails` |
| 日報改回只認單一分鐘 | `ChecklistTests.test_12_nightly_window_and_missing_report` |
| 無貼文失敗日改判 no_data | `ChecklistTests.test_10_no_failures_is_not_applicable` |
| AI 紀錄間隔放寬到 60 分 | `ChecklistTests.test_01_records_pass_gap_fail_and_sparse_no_data` |
| c 改用 tunnel 事件間隔 | `ChecklistTests.test_01_c_sparse_tunnel_continuous_heartbeat_passes` |
| c 沒有心跳日誌判 fail | `ChecklistTests.test_01_c_missing_heartbeat_is_no_data` |
| c 沒有心跳日誌判 pass | `ChecklistTests.test_01_c_missing_heartbeat_is_no_data` |

輸出：`output/operations/ops-l1-12-mutations-*/proof.json` 與每輪文字紀錄，含候選／還原 SHA 核對。r3 真資料證據：`output/operations/ops-l1-12-r3-live-readback.json`、`output/operations/OPS-L1-12-r3-TODAY.md`，完整 JSON 與報告在 `output/operations/ops-l1-12-r3-live/`。既有未追蹤 `reports/level1-gates.md` 保留原內容。

11/07 真資料：a 接手 pass、b 隔日週日 not_applicable、c 心跳日誌不存在 no_data；第 1 項 no_data。12 項有 4 項算過、連續 0 天。這沒有量到夜間停機，也沒有把 bot 程序或 webhook 回 200 替代成固定週期心跳證據。

離線 producer 是同日證據，不回填 11/07。r1 的 golden 曾達 90 秒時限；r2 提高為 **300 秒**，整輪預算 **600 秒**，為現有 15 分鐘排程保留其餘工作時間。timeout／預算用盡記 no_data，已發生 assertion/error 照實 fail，合成 log 與 snapshot 保留。這些時限是防止排程被卡住的上限，並非已量測的正常耗時保證。

## 總指揮接手

已在 **repo 內** `scripts/day-audit.ps1` 完成報告與原通知後加上離線呼叫；沒有註冊、更動或觸發 Windows 排程。它以一般使用者的固定 Python 執行 `level1_offline_checks.py --root <repo> --out-root <repo> --work-root D:/AI-Lanes-work/level1-offline-checks`，小型 receipt 寫回 repo 的 `output/operations/level1-checks-<date>.json`，snapshot／合成 log 在 D:。先檢查兩個 D: 根目錄，缺失不落回 C:。

parent 只複製白名單程式、公開設定與 synthetic test-assets，允許正式排程讀取其 repo；child 的工作目錄、環境與 temp 全部隔離，禁止連網、正式路徑與未受保護子程序。正式排程是一般使用者，不應拿 Codex 沙盒的 CIM/WMI 拒絕或暫存 ACL 限制推定現役故障；現有 shim／runner 護欄造成的測試紅燈也須由主幹分辨，不能直接改成綠或在本卡擴修 bot。只有新加入的 PowerShell 區塊在 stub interpreter 下實際執行測試，沒有執行含補發的整支 day-audit。

本環境只允許 worktree 寫入；共用 `.git`、D: 與 Vault 在可寫範圍外。本席手動離線實測另指定此 worktree 的隔離工作區及結果區（不生成媒體）；正式排程預設仍為 D:。若 commit 被拒，精確訊息存 `output/operations/OPS-L1-12-r3-COMMIT-MESSAGE.txt`；只 stage 本卡四個檔案。Vault task_summary 與持久筆記由主幹在獨立驗收後回存，本席不越權寫入。
