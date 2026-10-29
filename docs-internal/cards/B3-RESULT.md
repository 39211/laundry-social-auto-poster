# B3 自動週報交付

狀態：本地交付完成；2026-10-30。工作目錄 `C:\Users\cyc39\AI-Lanes\b3\repo`，分支 `feat/b3-weekly-report`。只有卡片指定四個新增檔案；沒有修改既有檔、commit、LINE 傳送或排程註冊。

## 開工卡與交付

| 欄位 | 本卡範圍 |
| --- | --- |
| OUTCOME | Python 3.14 標準庫離線週報，最多 60 行；合成測試與真實資料唯讀樣本 |
| OWNER / MAKER | 店主／Claude 總指揮；本席 Codex |
| CHECKER | 自動化測試＋另一段不匯入週報函式的原始資料加總核對，由本席執行；尚未經另一席獨立複審 |
| AUTHORITY | 僅新增本卡四檔；正式 data、reports、LINE 日誌唯讀 |
| EVIDENCE | 本檔保存樣本、口徑、測試輸出與來源雜湊摘要；當次使用者限定四檔，未另寫 Vault／戰情板 |

- `scripts/weekly-report.py`：支援 `--week`、`--dry-run`、`--out`、預留 `--llm`；另有 `--data-root`、`--reports-root`、`--line-bot-dir`、`--as-of`。
- `scripts/register-weekly-report-task.ps1`：每週一 08:00（Windows 本機時區），使用指定 Python，預設產上一個完整 ISO 週；僅編寫及 AST 語法解析，沒有執行腳本。
- `test/test_weekly_report.py`：20 項標準庫測試，使用測試專用暫存資料。
- `docs-internal/cards/B3-RESULT.md`：本交付紀錄及完整真實樣本。

## 使用方式

只印本週真實樣本，不在正式樹或 worktree 寫報表：

```powershell
& 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe' -B -X utf8 'scripts/weekly-report.py' --week 2026-W44 --dry-run --data-root 'C:\Users\cyc39\Documents\New project 5\data'
```

一般執行省略 `--week` 時，產上個完整週（週一至週日，UTC+08:00），預設檔名為 `reports/weekly/<yyyy-Www>.md`。`--out <dir>` 改輸出目錄；拒絕把檔案寫進來源 data 或 line-bot 目錄。`--dry-run` 不建立輸出目錄。`--llm` 不連網、不呼叫 API，仍用規則建議。

明確選當週時，成效只計已結束的完整日，與上週相同星期比較；本樣本為 10/26–10/29 對 10/19–10/22，不把 4 天數字稱為完整週成效。

## 實際讀到與使用的欄位

正式來源根目錄：`C:\Users\cyc39\Documents\New project 5\data`；進步帳為其同層 `reports/daily-progress.md`；錯誤日誌取 `%LOCALAPPDATA%\line-bot`。

| 來源 | 實際格式／欄位 | 統計用途 |
| --- | --- | --- |
| posted-log（106 檔） | 陣列；date、slot、platform、status、dry_run、post_id、created_at；可選 published_at | 成功＋ID 才列實發；排除 dry-run；按台北成功時間歸週 |
| scheduled-log（55 檔） | 陣列；date、slot、platform、scheduled_post_id、scheduled_publish_time（Unix 秒）、status、created_at | 排程按預定時間歸週；無 status 的既有 ID 為已登記；uncertain 另列；failed/error/missed 才算失敗；取消狀態排除 |
| approved-log（272 檔，含 sidecar） | 僅讀 yyyy-MM-dd.json 陣列中的 date、slot、platform、status；created_at 為可選快照截止欄位 | 去重核准筆數；fingerprints、image-digests 不是發文紀錄；核准不算排程／實發 |
| feature-posted-log（5 檔） | 陣列；platform、slug、status、post_id、scheduled_publish_at、at；日期可由檔名補 | 單支影片以 slug 與日常 slot 區分；scheduled 不算實發 |
| youtube-log（53 檔） | 陣列；date、slot、video_id、uploaded_at、scheduled_publish_at、video_status | 排程另計；舊版只有 video_id＋uploaded_at、沒有預定時間或狀態的記錄按直接上傳成功列本機實發 |
| leads（3 份月帳） | month、days[yyyy-MM-dd]；line_clicks_total、line_clicks_recorded_at、source_clicks_status、source_clicks、search_funnel_status、search_funnel_events | 跨月讀取兩週對應日；measured／total_only＋有效時間才接受 LINE 總數；source_clicks 僅接受 measured；缺日與 unmeasured 不補 0 |
| ga4-exports／insights／conversions | GA4 只有 README，0 CSV；insights 子目錄共有 446 JSON；conversions 0 檔 | 檔案盤點，不對重疊統計期間二次加總；指定漏斗與來源統一採 leads 日帳；未做社群觸及／轉換聚合 |
| run-locks／publish-locks | 本次均空目錄；支援 started_at／locked_at／created_at／at／timestamp 或純時間文字，否則採檔案 mtime | 目前超齡快照，run 45 分、publish 30 分；只是疑似殘留，不是週內發生次數 |
| daily-progress.md | 讀取日期段落 `## yyyy-MM-dd` | 顯示進步帳最新日期；彙總不是逐筆發布／錯誤事件，未拿來反推失敗次數 |
| line-bot/*.err | 實際有 line_webhook.err、staff_server.err、空的 tunnel_manager.err；只以名稱含 webhook 的日誌統計 webhook | 按帶時間的錯誤區塊計次，Traceback 多行不重複；現有 webhook 日誌沒有可用事件時間，故未知；不以日誌 mtime 冒充事件時間，不輸出原始日誌 |
| tunnel_events.jsonl | 在 data、來源根目錄與 line-bot 三個指定候選位置均未找到；預留 at／timestamp／ts／time／created_at、event／type | 缺檔為未知；合成／未來資料的事件按 error、fail、disconnect、restart、down 計數 |
| staff-inbox.jsonl | 40 列；kind、when、id、event_id；kind=query 共 23 列，皆為較早日期 | 只計選定週的查件記錄，依事件 ID 去重；不複製姓名、uid、文字或客戶資料 |
| arrival-state.json | anomaly、baselined、deliveries、last_sent、pending、seen；本次 deliveries／last_sent／pending 為空，seen 449 | 僅 last_sent 或明確成功的 deliveries 時間作通知成功記錄；seen 不是成功通知數，449 不算成發送數 |

漏斗實際欄位完整列出：`view_knowledge_hub`、`view_search_answer`、`view_service`、`click_answer_from_hub`、`click_service_from_hub`、`click_service_from_answer`、`click_phone`、`click_line_cta`、`view_article`、`click_service_from_article`、`line_click`。

## 口徑與限制

- 篇數為本機台帳的已見記錄。0 表示讀到的台帳沒有該類記錄，不代表線上沒有發文；缺來源或缺平台台帳則寫未知。失敗篇數是曾失敗的項目，同一項多次重試只算一筆；同一項可能同時有失敗與後來成功。
- 日常以平台＋日期＋slot、單支以平台＋日期＋slug 建立身分，再用 post/video ID 合併重複記錄；同一篇在排程與實發兩欄各計一次。
- 本樣本 6 筆 FB uncertain 分布在 10/28、10/30、11/1 各 2 筆，包含尚未到期的排程；不把這 6 筆寫成已失敗或已實發。
- 完整日的量測數值只有全數日期有效才列總數與增減；不完整時顯示未知、可用日數與已知小計。來源前五只在來源日帳完整時排名；來源只有 4 個就列 4 個。
- LINE 點擊不是 LINE 來訊、店機通知、預約或訂單；店機資料拿不到，保留未知。通知數為 AI 狀態中可辨識成功時間的去重記錄，不宣稱店機送達。
- 目前的鎖檔只能反映產報時快照，無法重建歷史一週曾出現又消失的鎖；`--as-of` 固定事件截止時間，來源仍為當下檔案，不是歷史備份。
- insights／GA4 CSV／conversions 本卡僅盤點，未新增社群觸及、CSV 轉換器或訂單歸因；指定成效欄位採已存在的 leads。TikTok 台帳未在本卡來源中，維持未知；沒有讀取或更新外部 TikTok 排程樹。
- 排程腳本預設目前使用者、Interactive、Limited，需使用者登入且 Windows 時區正確；支援 PowerShell `-WhatIf`，遇同名任務不強制覆蓋。尚未實機註冊／試跑，不能宣稱每週任務已生效。
- 本地實作與驗證已完成；尚未進行另一席獨立複審，也未部署至正式樹。

## 驗證與測試輸出

先建立 17 項測試，確認功能尚未存在時為 `FAILED (failures=17)`；實作後 17/17 通過。再先重現 3 個回歸失敗：取消排程錯算、缺台帳結論誤報 0、輸出排他建檔失敗誤刪原檔；修正後 20/20 通過。

```text
> C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe -B -X utf8 -m unittest discover -s test -p test_weekly_report.py -v

test_anomalies_count_timestamped_events_and_do_not_use_log_mtime ... ok
test_cancelled_schedule_is_not_counted_as_an_accepted_schedule ... ok
test_current_week_compares_matching_completed_days ... ok
test_default_week_is_last_complete_week_across_year ... ok
test_dry_run_does_not_create_output_or_modify_inputs ... ok
test_failed_exclusive_output_creation_preserves_preexisting_file ... ok
test_invalid_iso_week_is_rejected ... ok
test_llm_is_a_reserved_switch_and_report_at_most_60_lines ... ok
test_malformed_source_is_reported_as_unknown_without_traceback ... ok
test_measured_zero_is_distinct_from_unknown ... ok
test_missing_day_is_unknown_and_not_a_padded_zero ... ok
test_missing_publication_ledgers_does_not_claim_zero_in_conclusion ... ok
test_month_boundary_metrics_and_week_over_week_delta ... ok
test_out_writes_week_filename_and_matches_dry_run ... ok
test_publication_tables_deduplicate_and_separate_scheduled_live_failed ... ok
test_rejects_output_inside_read_only_source ... ok
test_uncertain_schedule_is_neither_success_nor_failure ... ok
test_undated_error_log_is_unknown_not_zero ... ok
test_unmeasured_status_overrides_existing_numbers ... ok
test_utc_timestamp_uses_taipei_week_boundary ... ok

Ran 20 tests in 2.949s
OK

PowerShell AST: ParseErrors=0, RegistrationScriptInvoked=False

> npm.cmd test
> laundry-social-auto-poster@0.1.0 test
> vitest run
'vitest' is not recognized as an internal or external command,
operable program or batch file.
exit code: 1
```

既有 TypeScript 全庫測試為 **BLOCKED（此 worktree 未安裝 vitest／node_modules）**，未安裝套件或改 lockfile，不宣稱全庫測試通過。Python 新功能測試不依賴這些套件。

環境修正：初次測試的 Python `TemporaryDirectory(mode=0700)` 在受限 Windows token 下無法存取；改用測試專屬隨機目錄、繼承父目錄 ACL，清理前確認絕對路徑仍在系統暫存目錄及專屬前綴下。初次受限空目錄未做越權清理。另一次獨立驗算的 PowerShell stdin 中文被轉碼造成斷言失敗，改為 ASCII Unicode escape 後完成核對；產報程式本身為 UTF-8 檔案，沒有該問題。

真實樣本獨立核對（沒有匯入產報函式）：LINE 10 對 4、11 個漏斗欄位、4 個來源欄位與增減，以及 FB 排程 1／uncertain 6／實發 1、IG 實發 1、YT 本週本機記錄 0，均逐項斷言通過；來源前後共 **947 檔**的 SHA-256、大小、mtime_ns 與檔案集合完全相同。

- 來源前後 manifest 摘要 SHA-256：`84ed3bda585974f72ac641871ce4f378ca6e67833342505bf617b7feaa33869f`。
- 樣本產生時間：`2026-10-30T01:29:35+08:00`。
- 樣本：**52 行**；UTF-8、LF SHA-256：`e90097d6c7ed7c6729ab47be19d79ba6220792959d3d68e5cc71bd2bb2880be6`。
- 真實資料只用 `--dry-run`，完整樣本嵌於本檔，沒有另增 `reports/weekly/` 檔案。

## 本週真實資料樣本

```markdown
# 私享家週報 2026-W44
一句話結論：排程狀態未確認 6 筆，先核對平台再決定是否補發。
期間：2026-10-26～2026-11-01（台北）；截至 2026-10-30 01:29 +08:00；本週未結束。
成效：只計已結束的完整日 4/7，與上週相同星期比較；今日不計。

| 平台 | 排程 | 實發 | 失敗 |
| --- | ---: | ---: | ---: |
| FB | 1（另 6 未確認） | 1 | 0 |
| IG | 未知（無該平台台帳） | 1 | 0 |
| YT | 0 | 0 | 0 |
| TikTok | 未知（無該平台台帳） | 未知（無該平台台帳） | 未知（無該平台台帳） |

| 成效／來源 | 本期（較上週） |
| --- | ---: |
| LINE 點擊 | 10（+6） |
| 搜尋：知識入口瀏覽 | 0（+0） |
| 搜尋：答案頁瀏覽 | 38（-30） |
| 搜尋：服務頁瀏覽 | 22（-2） |
| 搜尋：入口至答案 | 0（+0） |
| 搜尋：入口至服務 | 0（+0） |
| 搜尋：答案至服務 | 0（+0） |
| 搜尋：電話點擊 | 0（+0） |
| 搜尋：LINE 按鈕點擊 | 7（+6） |
| 搜尋：文章瀏覽 | 2（+1） |
| 搜尋：文章至服務 | 0（+0） |
| 搜尋：LINE 事件 | 10（+6） |
| 來源：footer | 5（+5） |
| 來源：home-cta | 3（+3） |
| 來源：local-north-district-laundry-pickup-cta | 1（+1） |
| 來源：services-taichung-laundry-price-list-footer | 1（+1） |

| 異常 | 次數／筆數 | 最後一次時間 |
| --- | ---: | --- |
| 失敗排程 | 0 | — |
| 鎖檔殘留（目前快照） | 0 | — |
| webhook 錯誤 | 未知（日誌無時間；已辨識 0） | 未知（無時間） |
| 隧道異常 | 未知（缺 tunnel_events.jsonl） | 未知（無時間） |

下週建議三件事（規則）：
1. 核對 6 筆未確認排程，確認平台狀態與貼文 ID 後再處理。
2. 檢查 webhook，補齊含時間的錯誤記錄後再統計本週異常。
3. 核對已到期排程的實發證據，補齊 FB／IG／YT／TikTok 的記錄。

資料口徑與未知欄位：
發文為本機台帳去重筆數；0＝無該類記錄，不代表線上無發文。實發須成功＋ID；排程到期不自動視為實發。
排程按預定日、實發按成功時間歸週；失敗為曾失敗項目，重試不重複；核准 26 筆僅供核對，不算排程。
鎖檔為產報時快照（run 超過 45 分、publish 超過 30 分），非每週發生次數；webhook 按含時間錯誤區塊計數。
AI 端 LINE：查件 0；通知成功記錄 0；店機通知／查件：未知（無店機資料）。
來源盤點：ga4-exports 0 檔；insights 446 檔；conversions 0 檔；進步帳最新 2026-10-29。insights／匯出只盤點，不把重疊期間資料再加進 leads。
未知說明：缺日、未量測、無時間或無台帳均不補 0；LINE 點擊不等於詢問／訂單，轉換成效未知（無已驗證日帳）。
讀取問題：無。
工時:見 B4 工時表
```
