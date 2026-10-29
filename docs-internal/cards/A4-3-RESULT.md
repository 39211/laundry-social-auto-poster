# A4-3 日夜切換結果

狀態：候選版完成；46/46 離線測試通過，待總指揮獨立驗收及部署。未切換現役 LINE。

- 原始要求：依 `A4-3-day-night-handover.md` 在本 worktree 完成日夜切換候選版；只改 `line-bot/` 與本檔、不 commit。
- 開工卡：outcome＝白天店機優先、夜間 AI 備援，並有 URL 誤抓、邊界時鐘與 PUT／GET 讀回的紅綠測試證據。owner＝店主；maker＝本席 Codex；checker＝本席離線回歸，總指揮獨立驗收尚待交件。authority＝本 worktree 的指定檔案，無現役操作權。
- 工作目錄：`C:\Users\cyc39\AI-Lanes\a43\repo`。分支：`feat/a4-3-night-handover`。日期：2026-10-30。實際驗證 Python：3.14.6，執行檔為店主指定路徑。
- 實作、測試、證據及部署交接均留在本檔或 `line-bot/`。不寫 Vault、不另建 Graphify 圖，遵守本次更窄的寫入範圍；已讀相關入口與參考資料。
- 基線測試首次被 Python 3.14 `tempfile` 的 Windows 0700 DACL 擋住，非產品測試失敗；後續測試臨時目錄改繼承 worktree ACL。首次建立的空目錄 `line-bot/a43-baseline-98o1zqvv` 無法由目前 sandbox 讀取或刪除；未提權或修改 ACL。

## Diff 摘要

| 檔案 | 交付內容 |
|---|---|
| `line-bot/handover.json` | 任務卡指定的四個設定，預設 10:00／20:00、延遲 5 分鐘、Asia/Taipei。 |
| `line-bot/tunnel_manager.py` | 僅接受 cloudflared 成功公告表格的 URL 列，拒絕 `api`、錯誤列、任意文字中的 URL 及網域後綴／路徑。新 URL 寫入 `public_base.txt`；只有夜間能登記 LINE。PUT 後 GET 必須逐字相同，否則 2／5／10 秒最多重試三次；保留原有 60 秒 pending 機制，白天會清除 pending。每次重試重新檢查時段。 |
| `line-bot/night_handover.py` | GET 現有端點，已是 AI 就不 PUT；不同才 PUT／GET 驗證。失配或 API 錯誤以非零碼結束；白天安全略過。`--dry-run` 完全離線，不讀 token；`--status` 只 GET，顯示兩邊端點、登記歸屬及 `active`。 |
| `line-bot/register-night-handover-task.ps1` | 由設定計算 `day_end + delay`，預設每日 20:05，支援 `-WhatIf`。Hidden PowerShell 啟動指定 Python 並回傳 exit code，`StartWhenAvailable`、`IgnoreNew`、5 分鐘上限。只建立腳本並做 Parser 語法解析，沒有執行。 |
| `line-bot/test_day_night_handover.py` | 新增 35 個 unittest，涵蓋 URL、10:00／20:00、午夜、UTC 轉換、跨午夜設定、缺 tzdata、白天登記阻擋、pending、跨日重試、事件、交接三情況、dry-run／status／錯誤。 |
| `line-bot/a43_test_support.py` | 測試專用隔離工具：臨時目錄限定 `line-bot/`、繼承 ACL、假時鐘、假設定、假 token／HTTP；阻擋實際 socket 連線並清除每案資料。 |
| `line-bot/test_tunnel_manager.py` | 原有 11 項全數保留，加入 unittest 入口及隔離，修正成功 URL fixture 和測試資源釋放。 |
| `line-bot/README-OPS.md` | 同步日夜時段、重試、事件、CLI 與指定 Python 的測試方式。 |
| `line-bot/a43-evidence/` | 保存原始紅燈、第一輪綠燈、複查紅燈及最終綠燈輸出；下方亦內嵌全文。 |

時間採半開區間：**10:00 起為白天，20:00 起為夜間**。設定檔缺失、時間／時區／delay 無效時會阻止登記。設定每次判斷重讀；更改排程時間後要重新註冊排程。台北在 Windows 缺少 IANA tzdata 時使用標準庫 UTC+08:00 fallback，不安裝第三方依賴；其他缺少資料的時區不會套用台北 offset。

## 事件及狀態的意義

正式執行時追加 `%LOCALAPPDATA%\line-bot\tunnel_events.jsonl`，每行都有 `ts`、`event`、`old_url`、`new_url`、`put_status`、`verify_status`。本次測試全部改寫到各案臨時目錄，沒有寫正式事件檔。

- `tunnel_url`：old/new 為本機舊／新 base URL。
- `webhook_update`：old/new 為完整 webhook endpoint；tunnel 初次更新無法知道 LINE 舊值時 `old_url` 為空，夜間交接則採 GET 取得的舊值。另存 `readback_url`。PUT 成功記 HTTP status；`verify_status` 為 `match`、`mismatch`、錯誤狀態或例外類型。
- `skipped_day`、`configuration_error`、`handover_noop`、`handover_error`：記錄略過或交接決策，未 PUT 以 `not_attempted` 表示。
- `registered_owner=ai` 僅表示登記 URL 與本機 AI URL 相同；不同為 `shop_or_other`，空值為 `unknown`。`active` 是 LINE 回傳欄位。**上述值不代表已實測可達、已收到 webhook 或手機已收到回覆**，`--status` 明列 `reachability=unmeasured`。

## 驗證與原測試調整原因

執行目錄為本 worktree 的 `line-bot/`，命令如下，使用店主指定的 Python 3.14：

```powershell
& "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe" -B -X utf8 -m unittest -v test_day_night_handover test_tunnel_manager
```

1. 先只新增／調整測試，生產程式尚未修改：45 tests，`FAILED (failures=38)`；failure 數含 subtest，沒有 error。失敗原因是舊 URL 規則、白天仍登記、缺少時段／交接／事件功能。原有 11 項在這一輪已全綠。
2. 實作後，同一組 45 tests 全綠。
3. 自行複查補一個「尚未登記端點」狀態測試：先取得 1 failure，修正歸屬顯示後，最終 **46 tests 全綠，沒有 warning**。
4. 五個 Python 檔案 `ast.parse` 通過；PowerShell `Parser.ParseFile` 為 `parse_errors=0`，`executed=false`；`git diff --check` 通過。
5. 以本工作區臨時副本及假 URL 實際執行 `night_handover.py --dry-run`，exit 0，`status=dry_run`、`line_endpoint=null`，未建立事件檔。這是離線 CLI smoke，沒有以真 token 或真 LINE 執行。

既有測試的調整並非取消斷言：原本 `visit URL`、`banner URL`、裸 URL 的合成輸入與本卡要求的成功公告格式衝突，改成真實的 `| https://…trycloudflare.com |` URL 列，仍驗證第一筆擷取、reader 持續排空與壞 UTF-8 後仍讀到尾端。重試測試固定在 21:00，避免新規則使測試結果依執行時間改變；假 setter 接受新增的 audit context。新增 unittest `load_tests` 讓原 11 項也能統一計數。測試 child 的 stdout 確實關閉並 join reader。

本次未執行整套 conversation／查件／通知測試或任何真 LINE API；驗證範圍為本卡相關 46 項及語法／離線 CLI。未改 conversation、查件、通知、`run_line_bot.ps1`、secrets 或 `shop-pc/`；未讀寫現役目錄、重啟現役程序、註冊排程、commit、push 或部署。

## 排程腳本用法（只交接，這次未執行）

以下由總指揮在核准部署完成後，於**現役 AI 的 `line-bot` 目錄**操作。本工作區的腳本不直接拿去註冊，以免排程綁到候選 worktree。

```powershell
# 預覽；仍不建立排程。
.\register-night-handover-task.ps1 -WhatIf

# 總指揮完成現役核對後才執行：預設任務名 Laundry-LINE-Night-Handover。
.\register-night-handover-task.ps1

# 可指定同一個核准的 Python 路徑／任務名；重跑會取代同名任務。
.\register-night-handover-task.ps1 `
  -Python "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe" `
  -TaskName "Laundry-LINE-Night-Handover"
```

腳本檢查設定、Python 與 `night_handover.py` 存在，且 Windows 時區為 `Taipei Standard Time`、設定 `tz=Asia/Taipei`。其他時區會拒絕註冊，避免本地每日觸發器時間錯置；本卡不調整 Windows 時區。排程使用執行註冊者的既有身分，未新增帳密或服務帳號；是否需要登入及實際排程權限由總指揮在部署主機驗收。

## 部署交接（總指揮執行，本席未做）

1. 獨立 review 本候選版，核對現役 AI 根目錄與版本、目前執行者及現有任務；保留對應檔案備份。歷史筆記不能代替現在的程序／排程狀態。
2. 複製 **`tunnel_manager.py`、`handover.json`、`night_handover.py`、`register-night-handover-task.ps1`** 到核准現役 AI 目錄的 `line-bot/`，可一併更新 `README-OPS.md`。不要用整棵 worktree 覆蓋現役樹；不複製 `public_base.txt`、測試臨時目錄、evidence、secrets 或客戶資料。新 URL 應由現役 cloudflared 重新產生。
3. 本次程式載入只需重啟 **AI 端 `tunnel_manager.py` 與它自己的 cloudflared 子程序**。依 PID＋命令列確認所有權後操作，保持只有一組 tunnel manager；`line_webhook.py`／`staff_server.py` 不因本補丁而需要重啟。若現役服務尚未啟動，先按既有冪等 `run_line_bot.ps1` 操作並驗收本機 webhook，不變更該腳本啟停行為。原有 AI bot 排程是否恢復由總指揮另核對，不由本卡自動啟用。
4. 確認 cloudflared 存活、新 `public_base.txt` 對應現役 AI 端點，並以現役證據驗收 webhook 可達。白天應只看到指定的 day-window log；檢查事件檔可寫，且沒有另一個舊版本 manager 持續 PUT。
5. 在現役位置先預覽排程，再由總指揮依核准程序註冊每日 20:05；讀回 task action、工作目錄、觸發時間及 `IgnoreNew`。修改 `day_end`／delay 後重新註冊。`StartWhenAvailable` 補跑若落到白天，Python 端也會略過。
6. 總指揮在正式允許的驗收時段執行 `night_handover.py --status` 讀回；夜間需要交接才執行一般模式。已是 AI 必須不 PUT；交接需看 PUT 後 GET 一致及事件；隔日上午確認店機 supervisor 自行登記回店機。手機回覆及原生回覆是否重複需另外看真實收件證據。本卡無此證據。

回復方式：由總指揮停用新增的 `Laundry-LINE-Night-Handover` 任務，依備份回復本次部署檔並只重啟所屬 AI tunnel manager／cloudflared。舊 manager 沒有日夜限制，回復前須先規劃 webhook 歸屬，避免重新互搶；本席沒有執行回復或現役操作。

## 參考查證與本次限制

- cloudflared 成功 URL 列依 [Cloudflare 官方 quick tunnel 原始碼](https://github.com/cloudflare/cloudflared/blob/master/cmd/cloudflared/tunnel/quick_tunnel.go) 的成功公告表格格式核對；錯誤 URL 症狀另參照本 worktree 的 `A4-RESULT.md`。
- PUT／GET 路徑依 [LINE 官方 Messaging API 文件](https://developers.line.biz/en/reference/messaging-api/#webhook-settings) 核對。本次只讀官方文件，沒有呼叫 LINE API。
- Windows 可能缺少 IANA 時區資料，依 [Python 官方 zoneinfo 文件](https://docs.python.org/3.14/library/zoneinfo.html#data-sources) 處理標準庫限定的台北 fallback。
- 開工已取得 Obsidian 首頁注入全文、讀 live Current-Context、唯讀搜尋相關筆記及戰情板；戰情板有大量 stale 資料，只當背景。這次沒有自己的既定 `agent+seat_id`，未寫戰情板。
- Graphify 的本 worktree／獨立 D 槽圖均不存在；依本次只准改指定路徑的限制，改以目前原始碼核對依賴，未另建圖或使用外部模型。引用的技能只提供方法，沒有擴大權限。
- 依本次寫入範圍，未執行會寫 Vault 的 `task_summary`；此 RESULT 是完整交接紀錄。待總指揮驗收後可由有權限者回存。沒有另派子代理或跨家族審查，不把自行回歸稱為獨立驗收。
- 殘留的 ACL 空目錄僅為本次失敗的臨時目錄，沒有產品或憑證內容，不會出現在 Git 檔案清單；目前 token 無法清除，未繞過限制。請勿將它複製到現役。

## 原始紅燈輸出（生產程式修改前，45 tests）

```text
test_already_ai_is_a_get_only_noop (test_day_night_handover.NightHandoverTests.test_already_ai_is_a_get_only_noop) ... FAIL
test_daytime_handover_does_not_load_credentials_or_call_line (test_day_night_handover.NightHandoverTests.test_daytime_handover_does_not_load_credentials_or_call_line) ... FAIL
test_dry_run_is_offline_and_does_not_load_credentials (test_day_night_handover.NightHandoverTests.test_dry_run_is_offline_and_does_not_load_credentials) ... FAIL
test_get_failure_cannot_trigger_a_blind_put (test_day_night_handover.NightHandoverTests.test_get_failure_cannot_trigger_a_blind_put) ... FAIL
test_get_finishes_in_daytime_without_put (test_day_night_handover.NightHandoverTests.test_get_finishes_in_daytime_without_put) ... FAIL
test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) ... 
  test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://api.trycloudflare.com') ... FAIL
  test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='http://wrong.trycloudflare.com') ... FAIL
  test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://ai-night-test.trycloudflare.com.evil.example') ... FAIL
  test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://ai-night-test.trycloudflare.com/tunnel') ... FAIL
test_missing_base_fails_before_loading_credentials (test_day_night_handover.NightHandoverTests.test_missing_base_fails_before_loading_credentials) ... FAIL
test_other_endpoint_is_updated_and_verified (test_day_night_handover.NightHandoverTests.test_other_endpoint_is_updated_and_verified) ... FAIL
test_persistent_readback_mismatch_exits_nonzero (test_day_night_handover.NightHandoverTests.test_persistent_readback_mismatch_exits_nonzero) ... FAIL
test_status_identifies_ai_endpoint (test_day_night_handover.NightHandoverTests.test_status_identifies_ai_endpoint) ... FAIL
test_status_prints_registered_owner_and_urls_without_writes (test_day_night_handover.NightHandoverTests.test_status_prints_registered_owner_and_urls_without_writes) ... FAIL
test_accepts_success_table_url (test_day_night_handover.ParserTests.test_accepts_success_table_url) ... ok
test_rejects_api_even_in_table (test_day_night_handover.ParserTests.test_rejects_api_even_in_table) ... FAIL
test_rejects_arbitrary_url_mentions (test_day_night_handover.ParserTests.test_rejects_arbitrary_url_mentions) ... FAIL
test_rejects_error_line_containing_a_table (test_day_night_handover.ParserTests.test_rejects_error_line_containing_a_table) ... FAIL
test_rejects_historical_api_error (test_day_night_handover.ParserTests.test_rejects_historical_api_error) ... FAIL
test_rejects_suffix_and_path_after_hostname (test_day_night_handover.ParserTests.test_rejects_suffix_and_path_after_hostname) ... FAIL
test_rejects_tenant_in_error_line (test_day_night_handover.ParserTests.test_rejects_tenant_in_error_line) ... FAIL
test_day_captures_base_without_line_requests (test_day_night_handover.PublishingTests.test_day_captures_base_without_line_requests) ... FAIL
test_invalid_configuration_fails_closed_but_keeps_new_base (test_day_night_handover.PublishingTests.test_invalid_configuration_fails_closed_but_keeps_new_base) ... FAIL
test_mismatch_has_one_initial_try_and_three_delayed_retries (test_day_night_handover.PublishingTests.test_mismatch_has_one_initial_try_and_three_delayed_retries) ... FAIL
test_night_captures_base_puts_and_verifies (test_day_night_handover.PublishingTests.test_night_captures_base_puts_and_verifies) ... FAIL
test_pending_retry_can_succeed_at_night (test_day_night_handover.PublishingTests.test_pending_retry_can_succeed_at_night) ... ok
test_pending_retry_is_blocked_and_cleared_during_day (test_day_night_handover.PublishingTests.test_pending_retry_is_blocked_and_cleared_during_day) ... FAIL
test_put_failure_records_status_without_exposing_token (test_day_night_handover.PublishingTests.test_put_failure_records_status_without_exposing_token) ... FAIL
test_retry_stops_if_delay_crosses_into_day (test_day_night_handover.PublishingTests.test_retry_stops_if_delay_crosses_into_day) ... FAIL
test_0959_is_night (test_day_night_handover.WindowTests.test_0959_is_night) ... FAIL
test_1000_is_day (test_day_night_handover.WindowTests.test_1000_is_day) ... FAIL
test_1959_is_day (test_day_night_handover.WindowTests.test_1959_is_day) ... FAIL
test_2000_is_night (test_day_night_handover.WindowTests.test_2000_is_night) ... FAIL
test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) ... 
  test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=22) ... FAIL
  test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=2) ... FAIL
  test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=6) ... FAIL
  test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=21) ... FAIL
test_midnight_is_night (test_day_night_handover.WindowTests.test_midnight_is_night) ... FAIL
test_taipei_works_without_external_tzdata (test_day_night_handover.WindowTests.test_taipei_works_without_external_tzdata) ... FAIL
test_utc_clock_is_converted_to_taipei (test_day_night_handover.WindowTests.test_utc_clock_is_converted_to_taipei) ... FAIL
unittest.case.FunctionTestCase (test_parse_none) ... ok
unittest.case.FunctionTestCase (test_parse_first_of_two) ... ok
unittest.case.FunctionTestCase (test_parse_boxed) ... ok
unittest.case.FunctionTestCase (test_set_webhook_ok) ... ok
unittest.case.FunctionTestCase (test_set_webhook_mismatch) ... ok
unittest.case.FunctionTestCase (test_reader_drains_after_url)
F2: after the URL line, child still writes >20_000 bytes and must exit by itself. ... ok
unittest.case.FunctionTestCase (test_webhook_retries_then_pending) ... C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\tempfile.py:484: ResourceWarning: Implicitly cleaning up <HTTPError 503: 'unavailable'>
  _warnings.warn(self.warn_message, ResourceWarning)
ok
unittest.case.FunctionTestCase (test_no_timeout_kills_process) ... ok
unittest.case.FunctionTestCase (test_log_rotate) ... ok
unittest.case.FunctionTestCase (test_g3_utf8_replace_and_reader_survives) ... ok
unittest.case.FunctionTestCase (test_g17_timeout_log_distinguishes_exit) ... ok

======================================================================
FAIL: test_already_ai_is_a_get_only_noop (test_day_night_handover.NightHandoverTests.test_already_ai_is_a_get_only_noop)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 253, in test_already_ai_is_a_get_only_noop
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_daytime_handover_does_not_load_credentials_or_call_line (test_day_night_handover.NightHandoverTests.test_daytime_handover_does_not_load_credentials_or_call_line)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 311, in test_daytime_handover_does_not_load_credentials_or_call_line
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_dry_run_is_offline_and_does_not_load_credentials (test_day_night_handover.NightHandoverTests.test_dry_run_is_offline_and_does_not_load_credentials)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 280, in test_dry_run_is_offline_and_does_not_load_credentials
    code, result, _ = self.night_main(["--dry-run"])
                      ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_get_failure_cannot_trigger_a_blind_put (test_day_night_handover.NightHandoverTests.test_get_failure_cannot_trigger_a_blind_put)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 320, in test_get_failure_cannot_trigger_a_blind_put
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_get_finishes_in_daytime_without_put (test_day_night_handover.NightHandoverTests.test_get_finishes_in_daytime_without_put)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 329, in test_get_finishes_in_daytime_without_put
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://api.trycloudflare.com')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 346, in test_invalid_base_cannot_be_registered
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='http://wrong.trycloudflare.com')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 346, in test_invalid_base_cannot_be_registered
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://ai-night-test.trycloudflare.com.evil.example')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 346, in test_invalid_base_cannot_be_registered
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) (base='https://ai-night-test.trycloudflare.com/tunnel')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 346, in test_invalid_base_cannot_be_registered
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_missing_base_fails_before_loading_credentials (test_day_night_handover.NightHandoverTests.test_missing_base_fails_before_loading_credentials)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 335, in test_missing_base_fails_before_loading_credentials
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_other_endpoint_is_updated_and_verified (test_day_night_handover.NightHandoverTests.test_other_endpoint_is_updated_and_verified)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 261, in test_other_endpoint_is_updated_and_verified
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_persistent_readback_mismatch_exits_nonzero (test_day_night_handover.NightHandoverTests.test_persistent_readback_mismatch_exits_nonzero)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 272, in test_persistent_readback_mismatch_exits_nonzero
    code, result, _ = self.night_main([])
                      ~~~~~~~~~~~~~~~^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_status_identifies_ai_endpoint (test_day_night_handover.NightHandoverTests.test_status_identifies_ai_endpoint)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 303, in test_status_identifies_ai_endpoint
    code, result, _ = self.night_main(["--status"])
                      ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_status_prints_registered_owner_and_urls_without_writes (test_day_night_handover.NightHandoverTests.test_status_prints_registered_owner_and_urls_without_writes)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 124, in night_main
    module = importlib.import_module("night_handover")
  File "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\Lib\importlib\__init__.py", line 88, in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ~~~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "<frozen importlib._bootstrap>", line 1406, in _gcd_import
  File "<frozen importlib._bootstrap>", line 1371, in _find_and_load
  File "<frozen importlib._bootstrap>", line 1335, in _find_and_load_unlocked
ModuleNotFoundError: No module named 'night_handover'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 291, in test_status_prints_registered_owner_and_urls_without_writes
    code, result, _ = self.night_main(["--status"])
                      ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 128, in night_main
    self.fail("night_handover.py is missing")
    ~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: night_handover.py is missing

======================================================================
FAIL: test_rejects_api_even_in_table (test_day_night_handover.ParserTests.test_rejects_api_even_in_table)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 75, in test_rejects_api_even_in_table
    self.assertEqual(tm.parse_tunnel_url("| https://api.trycloudflare.com |"), "")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'https://api.trycloudflare.com' != ''
- https://api.trycloudflare.com


======================================================================
FAIL: test_rejects_arbitrary_url_mentions (test_day_night_handover.ParserTests.test_rejects_arbitrary_url_mentions)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 92, in test_rejects_arbitrary_url_mentions
    self.assertEqual(tm.parse_tunnel_url("visit " + AI_BASE + " now"), "")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'https://ai-night-test.trycloudflare.com' != ''
- https://ai-night-test.trycloudflare.com


======================================================================
FAIL: test_rejects_error_line_containing_a_table (test_day_night_handover.ParserTests.test_rejects_error_line_containing_a_table)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 89, in test_rejects_error_line_containing_a_table
    self.assertEqual(tm.parse_tunnel_url("ERR failed | " + AI_BASE + " |"), "")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'https://ai-night-test.trycloudflare.com' != ''
- https://ai-night-test.trycloudflare.com


======================================================================
FAIL: test_rejects_historical_api_error (test_day_night_handover.ParserTests.test_rejects_historical_api_error)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 78, in test_rejects_historical_api_error
    self.assertEqual(tm.parse_tunnel_url(
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
        'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": '
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        "dial tcp: lookup api.trycloudflare.com: no such host"
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ), "")
    ^^^^^^
AssertionError: 'https://api.trycloudflare.com' != ''
- https://api.trycloudflare.com


======================================================================
FAIL: test_rejects_suffix_and_path_after_hostname (test_day_night_handover.ParserTests.test_rejects_suffix_and_path_after_hostname)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 96, in test_rejects_suffix_and_path_after_hostname
    self.assertEqual(tm.parse_tunnel_url("| " + AI_BASE + ".evil.example |"), "")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'https://ai-night-test.trycloudflare.com' != ''
- https://ai-night-test.trycloudflare.com


======================================================================
FAIL: test_rejects_tenant_in_error_line (test_day_night_handover.ParserTests.test_rejects_tenant_in_error_line)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 84, in test_rejects_tenant_in_error_line
    self.assertEqual(tm.parse_tunnel_url(
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
        "2026-10-30T12:00:00Z ERR connection failed for " + AI_BASE
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ), "")
    ^^^^^^
AssertionError: 'https://ai-night-test.trycloudflare.com' != ''
- https://ai-night-test.trycloudflare.com


======================================================================
FAIL: test_day_captures_base_without_line_requests (test_day_night_handover.PublishingTests.test_day_captures_base_without_line_requests)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 177, in test_day_captures_base_without_line_requests
    self.assertEqual(self.http.calls, [])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['PUT', 'GET'] != []

First list contains 2 additional elements.
First extra element 0:
'PUT'

- ['PUT', 'GET']
+ []

======================================================================
FAIL: test_invalid_configuration_fails_closed_but_keeps_new_base (test_day_night_handover.PublishingTests.test_invalid_configuration_fails_closed_but_keeps_new_base)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 221, in test_invalid_configuration_fails_closed_but_keeps_new_base
    self.assertEqual(self.http.calls, [])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['PUT', 'GET'] != []

First list contains 2 additional elements.
First extra element 0:
'PUT'

- ['PUT', 'GET']
+ []

======================================================================
FAIL: test_mismatch_has_one_initial_try_and_three_delayed_retries (test_day_night_handover.PublishingTests.test_mismatch_has_one_initial_try_and_three_delayed_retries)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 231, in test_mismatch_has_one_initial_try_and_three_delayed_retries
    attempts = [row for row in self.events() if row["event"] == "webhook_update"]
                               ~~~~~~~~~~~^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 114, in events
    self.assertTrue(tm.EVENTS_PATH.exists(), "structured tunnel events are missing")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : structured tunnel events are missing

======================================================================
FAIL: test_night_captures_base_puts_and_verifies (test_day_night_handover.PublishingTests.test_night_captures_base_puts_and_verifies)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 189, in test_night_captures_base_puts_and_verifies
    last = self.events()[-1]
           ~~~~~~~~~~~^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 114, in events
    self.assertTrue(tm.EVENTS_PATH.exists(), "structured tunnel events are missing")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : structured tunnel events are missing

======================================================================
FAIL: test_pending_retry_is_blocked_and_cleared_during_day (test_day_night_handover.PublishingTests.test_pending_retry_is_blocked_and_cleared_during_day)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 197, in test_pending_retry_is_blocked_and_cleared_during_day
    self.assertEqual(self.http.calls, [])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['PUT', 'GET'] != []

First list contains 2 additional elements.
First extra element 0:
'PUT'

- ['PUT', 'GET']
+ []

======================================================================
FAIL: test_put_failure_records_status_without_exposing_token (test_day_night_handover.PublishingTests.test_put_failure_records_status_without_exposing_token)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 241, in test_put_failure_records_status_without_exposing_token
    for row in self.events():
               ~~~~~~~~~~~^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 114, in events
    self.assertTrue(tm.EVENTS_PATH.exists(), "structured tunnel events are missing")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : structured tunnel events are missing

======================================================================
FAIL: test_retry_stops_if_delay_crosses_into_day (test_day_night_handover.PublishingTests.test_retry_stops_if_delay_crosses_into_day)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 215, in test_retry_stops_if_delay_crosses_into_day
    self.assertEqual(self.http.calls, ["PUT", "GET"])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET'] != ['PUT', 'GET']

First list contains 6 additional elements.
First extra element 2:
'PUT'

- ['PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET']
+ ['PUT', 'GET']

======================================================================
FAIL: test_0959_is_night (test_day_night_handover.WindowTests.test_0959_is_night)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 142, in test_0959_is_night
    self.assert_window(datetime(2026, 10, 30, 9, 59, tzinfo=TAIPEI), True)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_1000_is_day (test_day_night_handover.WindowTests.test_1000_is_day)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 145, in test_1000_is_day
    self.assert_window(datetime(2026, 10, 30, 10, tzinfo=TAIPEI), False)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_1959_is_day (test_day_night_handover.WindowTests.test_1959_is_day)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 148, in test_1959_is_day
    self.assert_window(datetime(2026, 10, 30, 19, 59, tzinfo=TAIPEI), False)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_2000_is_night (test_day_night_handover.WindowTests.test_2000_is_night)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 151, in test_2000_is_night
    self.assert_window(datetime(2026, 10, 30, 20, tzinfo=TAIPEI), True)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=22)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 164, in test_configured_day_window_can_cross_midnight
    self.assert_window(datetime(2026, 10, 30, hour, tzinfo=TAIPEI), night, config)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=2)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 164, in test_configured_day_window_can_cross_midnight
    self.assert_window(datetime(2026, 10, 30, hour, tzinfo=TAIPEI), night, config)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=6)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 164, in test_configured_day_window_can_cross_midnight
    self.assert_window(datetime(2026, 10, 30, hour, tzinfo=TAIPEI), night, config)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) (hour=21)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 164, in test_configured_day_window_can_cross_midnight
    self.assert_window(datetime(2026, 10, 30, hour, tzinfo=TAIPEI), night, config)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_midnight_is_night (test_day_night_handover.WindowTests.test_midnight_is_night)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 154, in test_midnight_is_night
    self.assert_window(datetime(2026, 10, 31, 0, tzinfo=TAIPEI), True)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_taipei_works_without_external_tzdata (test_day_night_handover.WindowTests.test_taipei_works_without_external_tzdata)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 169, in test_taipei_works_without_external_tzdata
    self.assert_window(datetime(2026, 10, 30, 20, tzinfo=TAIPEI), True)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

======================================================================
FAIL: test_utc_clock_is_converted_to_taipei (test_day_night_handover.WindowTests.test_utc_clock_is_converted_to_taipei)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 157, in test_utc_clock_is_converted_to_taipei
    self.assert_window(datetime(2026, 10, 30, 2, tzinfo=timezone.utc), False)
    ~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 138, in assert_window
    self.assertIsNotNone(function, "is_night_window is missing")
    ~~~~~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: unexpectedly None : is_night_window is missing

----------------------------------------------------------------------
Ran 45 tests in 0.342s

FAILED (failures=38)
```

## 原始第一輪綠燈輸出（同組 45 tests）

```text
test_already_ai_is_a_get_only_noop (test_day_night_handover.NightHandoverTests.test_already_ai_is_a_get_only_noop) ... ok
test_daytime_handover_does_not_load_credentials_or_call_line (test_day_night_handover.NightHandoverTests.test_daytime_handover_does_not_load_credentials_or_call_line) ... ok
test_dry_run_is_offline_and_does_not_load_credentials (test_day_night_handover.NightHandoverTests.test_dry_run_is_offline_and_does_not_load_credentials) ... ok
test_get_failure_cannot_trigger_a_blind_put (test_day_night_handover.NightHandoverTests.test_get_failure_cannot_trigger_a_blind_put) ... ok
test_get_finishes_in_daytime_without_put (test_day_night_handover.NightHandoverTests.test_get_finishes_in_daytime_without_put) ... ok
test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) ... ok
test_missing_base_fails_before_loading_credentials (test_day_night_handover.NightHandoverTests.test_missing_base_fails_before_loading_credentials) ... ok
test_other_endpoint_is_updated_and_verified (test_day_night_handover.NightHandoverTests.test_other_endpoint_is_updated_and_verified) ... ok
test_persistent_readback_mismatch_exits_nonzero (test_day_night_handover.NightHandoverTests.test_persistent_readback_mismatch_exits_nonzero) ... ok
test_status_identifies_ai_endpoint (test_day_night_handover.NightHandoverTests.test_status_identifies_ai_endpoint) ... ok
test_status_prints_registered_owner_and_urls_without_writes (test_day_night_handover.NightHandoverTests.test_status_prints_registered_owner_and_urls_without_writes) ... ok
test_accepts_success_table_url (test_day_night_handover.ParserTests.test_accepts_success_table_url) ... ok
test_rejects_api_even_in_table (test_day_night_handover.ParserTests.test_rejects_api_even_in_table) ... ok
test_rejects_arbitrary_url_mentions (test_day_night_handover.ParserTests.test_rejects_arbitrary_url_mentions) ... ok
test_rejects_error_line_containing_a_table (test_day_night_handover.ParserTests.test_rejects_error_line_containing_a_table) ... ok
test_rejects_historical_api_error (test_day_night_handover.ParserTests.test_rejects_historical_api_error) ... ok
test_rejects_suffix_and_path_after_hostname (test_day_night_handover.ParserTests.test_rejects_suffix_and_path_after_hostname) ... ok
test_rejects_tenant_in_error_line (test_day_night_handover.ParserTests.test_rejects_tenant_in_error_line) ... ok
test_day_captures_base_without_line_requests (test_day_night_handover.PublishingTests.test_day_captures_base_without_line_requests) ... ok
test_invalid_configuration_fails_closed_but_keeps_new_base (test_day_night_handover.PublishingTests.test_invalid_configuration_fails_closed_but_keeps_new_base) ... ok
test_mismatch_has_one_initial_try_and_three_delayed_retries (test_day_night_handover.PublishingTests.test_mismatch_has_one_initial_try_and_three_delayed_retries) ... ok
test_night_captures_base_puts_and_verifies (test_day_night_handover.PublishingTests.test_night_captures_base_puts_and_verifies) ... ok
test_pending_retry_can_succeed_at_night (test_day_night_handover.PublishingTests.test_pending_retry_can_succeed_at_night) ... ok
test_pending_retry_is_blocked_and_cleared_during_day (test_day_night_handover.PublishingTests.test_pending_retry_is_blocked_and_cleared_during_day) ... ok
test_put_failure_records_status_without_exposing_token (test_day_night_handover.PublishingTests.test_put_failure_records_status_without_exposing_token) ... ok
test_retry_stops_if_delay_crosses_into_day (test_day_night_handover.PublishingTests.test_retry_stops_if_delay_crosses_into_day) ... ok
test_0959_is_night (test_day_night_handover.WindowTests.test_0959_is_night) ... ok
test_1000_is_day (test_day_night_handover.WindowTests.test_1000_is_day) ... ok
test_1959_is_day (test_day_night_handover.WindowTests.test_1959_is_day) ... ok
test_2000_is_night (test_day_night_handover.WindowTests.test_2000_is_night) ... ok
test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) ... ok
test_midnight_is_night (test_day_night_handover.WindowTests.test_midnight_is_night) ... ok
test_taipei_works_without_external_tzdata (test_day_night_handover.WindowTests.test_taipei_works_without_external_tzdata) ... ok
test_utc_clock_is_converted_to_taipei (test_day_night_handover.WindowTests.test_utc_clock_is_converted_to_taipei) ... ok
unittest.case.FunctionTestCase (test_parse_none) ... ok
unittest.case.FunctionTestCase (test_parse_first_of_two) ... ok
unittest.case.FunctionTestCase (test_parse_boxed) ... ok
unittest.case.FunctionTestCase (test_set_webhook_ok) ... ok
unittest.case.FunctionTestCase (test_set_webhook_mismatch) ... ok
unittest.case.FunctionTestCase (test_reader_drains_after_url)
F2: after the URL line, child still writes >20_000 bytes and must exit by itself. ... ok
unittest.case.FunctionTestCase (test_webhook_retries_then_pending) ... ok
unittest.case.FunctionTestCase (test_no_timeout_kills_process) ... ok
unittest.case.FunctionTestCase (test_log_rotate) ... ok
unittest.case.FunctionTestCase (test_g3_utf8_replace_and_reader_survives) ... ok
unittest.case.FunctionTestCase (test_g17_timeout_log_distinguishes_exit) ... ok

----------------------------------------------------------------------
Ran 45 tests in 0.467s

OK
```

## 複查回歸的原始紅燈輸出（空端點歸屬，1 test）

```text
test_unconfigured_status_does_not_claim_the_shop_is_registered (test_day_night_handover.NightHandoverTests.test_unconfigured_status_does_not_claim_the_shop_is_registered) ... FAIL

======================================================================
FAIL: test_unconfigured_status_does_not_claim_the_shop_is_registered (test_day_night_handover.NightHandoverTests.test_unconfigured_status_does_not_claim_the_shop_is_registered)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a43\repo\line-bot\test_day_night_handover.py", line 315, in test_unconfigured_status_does_not_claim_the_shop_is_registered
    self.assertEqual(result["registered_owner"], "unknown")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'shop_or_other' != 'unknown'
- shop_or_other
+ unknown


----------------------------------------------------------------------
Ran 1 test in 0.016s

FAILED (failures=1)
```

## 最終綠燈輸出（46 tests）

```text
test_already_ai_is_a_get_only_noop (test_day_night_handover.NightHandoverTests.test_already_ai_is_a_get_only_noop) ... ok
test_daytime_handover_does_not_load_credentials_or_call_line (test_day_night_handover.NightHandoverTests.test_daytime_handover_does_not_load_credentials_or_call_line) ... ok
test_dry_run_is_offline_and_does_not_load_credentials (test_day_night_handover.NightHandoverTests.test_dry_run_is_offline_and_does_not_load_credentials) ... ok
test_get_failure_cannot_trigger_a_blind_put (test_day_night_handover.NightHandoverTests.test_get_failure_cannot_trigger_a_blind_put) ... ok
test_get_finishes_in_daytime_without_put (test_day_night_handover.NightHandoverTests.test_get_finishes_in_daytime_without_put) ... ok
test_invalid_base_cannot_be_registered (test_day_night_handover.NightHandoverTests.test_invalid_base_cannot_be_registered) ... ok
test_missing_base_fails_before_loading_credentials (test_day_night_handover.NightHandoverTests.test_missing_base_fails_before_loading_credentials) ... ok
test_other_endpoint_is_updated_and_verified (test_day_night_handover.NightHandoverTests.test_other_endpoint_is_updated_and_verified) ... ok
test_persistent_readback_mismatch_exits_nonzero (test_day_night_handover.NightHandoverTests.test_persistent_readback_mismatch_exits_nonzero) ... ok
test_status_identifies_ai_endpoint (test_day_night_handover.NightHandoverTests.test_status_identifies_ai_endpoint) ... ok
test_status_prints_registered_owner_and_urls_without_writes (test_day_night_handover.NightHandoverTests.test_status_prints_registered_owner_and_urls_without_writes) ... ok
test_unconfigured_status_does_not_claim_the_shop_is_registered (test_day_night_handover.NightHandoverTests.test_unconfigured_status_does_not_claim_the_shop_is_registered) ... ok
test_accepts_success_table_url (test_day_night_handover.ParserTests.test_accepts_success_table_url) ... ok
test_rejects_api_even_in_table (test_day_night_handover.ParserTests.test_rejects_api_even_in_table) ... ok
test_rejects_arbitrary_url_mentions (test_day_night_handover.ParserTests.test_rejects_arbitrary_url_mentions) ... ok
test_rejects_error_line_containing_a_table (test_day_night_handover.ParserTests.test_rejects_error_line_containing_a_table) ... ok
test_rejects_historical_api_error (test_day_night_handover.ParserTests.test_rejects_historical_api_error) ... ok
test_rejects_suffix_and_path_after_hostname (test_day_night_handover.ParserTests.test_rejects_suffix_and_path_after_hostname) ... ok
test_rejects_tenant_in_error_line (test_day_night_handover.ParserTests.test_rejects_tenant_in_error_line) ... ok
test_day_captures_base_without_line_requests (test_day_night_handover.PublishingTests.test_day_captures_base_without_line_requests) ... ok
test_invalid_configuration_fails_closed_but_keeps_new_base (test_day_night_handover.PublishingTests.test_invalid_configuration_fails_closed_but_keeps_new_base) ... ok
test_mismatch_has_one_initial_try_and_three_delayed_retries (test_day_night_handover.PublishingTests.test_mismatch_has_one_initial_try_and_three_delayed_retries) ... ok
test_night_captures_base_puts_and_verifies (test_day_night_handover.PublishingTests.test_night_captures_base_puts_and_verifies) ... ok
test_pending_retry_can_succeed_at_night (test_day_night_handover.PublishingTests.test_pending_retry_can_succeed_at_night) ... ok
test_pending_retry_is_blocked_and_cleared_during_day (test_day_night_handover.PublishingTests.test_pending_retry_is_blocked_and_cleared_during_day) ... ok
test_put_failure_records_status_without_exposing_token (test_day_night_handover.PublishingTests.test_put_failure_records_status_without_exposing_token) ... ok
test_retry_stops_if_delay_crosses_into_day (test_day_night_handover.PublishingTests.test_retry_stops_if_delay_crosses_into_day) ... ok
test_0959_is_night (test_day_night_handover.WindowTests.test_0959_is_night) ... ok
test_1000_is_day (test_day_night_handover.WindowTests.test_1000_is_day) ... ok
test_1959_is_day (test_day_night_handover.WindowTests.test_1959_is_day) ... ok
test_2000_is_night (test_day_night_handover.WindowTests.test_2000_is_night) ... ok
test_configured_day_window_can_cross_midnight (test_day_night_handover.WindowTests.test_configured_day_window_can_cross_midnight) ... ok
test_midnight_is_night (test_day_night_handover.WindowTests.test_midnight_is_night) ... ok
test_taipei_works_without_external_tzdata (test_day_night_handover.WindowTests.test_taipei_works_without_external_tzdata) ... ok
test_utc_clock_is_converted_to_taipei (test_day_night_handover.WindowTests.test_utc_clock_is_converted_to_taipei) ... ok
unittest.case.FunctionTestCase (test_parse_none) ... ok
unittest.case.FunctionTestCase (test_parse_first_of_two) ... ok
unittest.case.FunctionTestCase (test_parse_boxed) ... ok
unittest.case.FunctionTestCase (test_set_webhook_ok) ... ok
unittest.case.FunctionTestCase (test_set_webhook_mismatch) ... ok
unittest.case.FunctionTestCase (test_reader_drains_after_url)
F2: after the URL line, child still writes >20_000 bytes and must exit by itself. ... ok
unittest.case.FunctionTestCase (test_webhook_retries_then_pending) ... ok
unittest.case.FunctionTestCase (test_no_timeout_kills_process) ... ok
unittest.case.FunctionTestCase (test_log_rotate) ... ok
unittest.case.FunctionTestCase (test_g3_utf8_replace_and_reader_survives) ... ok
unittest.case.FunctionTestCase (test_g17_timeout_log_distinguishes_exit) ... ok

----------------------------------------------------------------------
Ran 46 tests in 0.573s

OK
```
