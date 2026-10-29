# A4-2 RESULT：店機隧道可觀測

狀態：本機實作與驗收完成；未部署店機，正式環境驗收仍由總指揮安排。日期：2026-10-29（Asia/Taipei）。

## 任務與權限

- 依據：`docs-internal/cards/A4-2-shop-tunnel-observability.md` 與使用者當次指示。
- Outcome：webhook 每行本地時間前綴、可追溯的隧道 JSONL、PUT 後 GET 回讀與有限重試、退出 rc／存活秒數，以及可回退的部署文件。
- Owner／正式部署及獨立 checker：Claude 總指揮；maker／本機測試與自檢：本次 Codex。未派外部 lane，也未把同一席的自檢當獨立驗收。
- 工作目錄：`C:\Users\cyc39\Documents\New project 5`。
- 只修改 `shop-pc/fxwash/` 內檔案、此 RESULT 與 `shop-pc/DEPLOY-A4-2.md`。未 stage／commit／push／部署。
- 未連店機、未呼叫真正 LINE API、未啟動真正 server／SSH 隧道、未讀寫 secrets、未安裝套件、未修改實際 `shop.json` 或通知／對話程式。

## Diff 摘要

| 檔案 | 修改及驗證重點 |
| --- | --- |
| `shop-pc/fxwash/runtime/webhook_server.py` | 集中修改 SafeWriter：stdout／stderr 每行加 `YYYY-MM-DD HH:MM:SS ` 本地時間；處理 print 的分段 write、多行與空行；其中一個輸出失效時保留另一個。檔案開啟失敗時主控台仍有時間戳。 |
| `shop-pc/fxwash/runtime/tunnel_supervisor.py` | 新增 `logs/tunnel_events.jsonl`，記錄 url_detected、put_start、put_result、verify_result、tunnel_exit。PUT 後 GET 比對 endpoint；首次失敗後最多三次重試，間隔 2／5／10 秒。關閉 HTTPError 回應；退出時等待取得實際 rc，記錄 monotonic 存活秒數。 |
| `shop-pc/fxwash/runtime/test_tunnel_events.py` | 11 條離線 unittest，真實執行註冊／JSONL 寫讀及 supervisor 流程，網路、憑證與子程序皆由假的邊界依賴取代。 |
| `shop-pc/fxwash/runtime/test_webhook_log_ts.py` | 7 條 unittest，載入真正模組及 SafeWriter，不啟動 server。 |
| `shop-pc/DEPLOY-A4-2.md` | 四檔清單、原檔與排程備份、辨識 watchdog／程序／SSH、10:00–20:00 停啟、3.11 離線測試、正式回讀與回退。 |
| `docs-internal/cards/A4-2-RESULT.md` | 本報告、原始紅綠／變異輸出、相容性與未完成邊界。 |

未修改 `runtime/line_api.py`；沿用現有 get_webhook／set_webhook 與可注入 opener，於 supervisor 觀測實際 PUT HTTP status。GET 回傳的 `endpoint` 欄位已對照 [LINE 官方 GET webhook endpoint 文件](https://developers.line.biz/en/reference/messaging-api/#get-webhook-endpoint-information) 與 [官方 PUT 文件](https://developers.line.biz/en/reference/messaging-api/#set-webhook-endpoint-url)；僅讀公開文件，沒有向 `api.line.me` 發送真實請求。

JSONL 每行都有 `ts`、`old_url`、`new_url`、`put_status`、`verify_status`，另有 `event`；每次 PUT／GET 加 `attempt`。ts 是本地 ISO 8601，含 UTC offset。尚未取得 HTTP 回應時 put_status 為 null，HTTPError 保留實際碼，傳輸失敗記 `error`；不偽造 200。回讀用 `pending`／`match`／`mismatch`／`error`／`not_run` 區分，只有 URL 一致才回傳成功。錯誤紀錄只存類型，不存 token、secret、任意錯誤文字或 API 回應 body。

重試解讀：卡片列出 2／5／10 三個間隔，故為「首次 PUT + 最多三次重試」，共最多四組 PUT／GET。GET 不一致會重 PUT；HTTP／網路錯誤共用相同有限預算。持續取得不同 endpoint 時，最後一筆為 `verify_status: mismatch`；無法完成 GET 則記 error，不宣稱比對完成。

supervisor 更新 `shop.json.server` 是既有執行行為，本卡保留；這一輪沒有執行真正 supervisor，也沒有編輯快照中的 `shop.json`。首次啟動的 old_url 為空，表示此程序還沒有上一個觀察到的網址，並非已查得 LINE 原端點為空。

## 測試命令與先紅後綠

全部使用使用者指定的 `C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe`。開啟 `PYTHONDONTWRITEBYTECODE=1` 避免 bytecode 雜檔；測試只在自己建立的隔離資料夾內寫入假的 shop／events，結束即清理。

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -m unittest discover -s shop-pc/fxwash/runtime -p 'test_*.py'
```

基線沒有 runtime 測試（Python 3.14 回報 `Ran 0 tests`／`NO TESTS RAN`，exit 1）。先新增 16 條測試，在正式程式尚未修改時得到以下有效紅燈：15 條失敗、0 errors，均為時間戳／可觀測及驗證功能未實作。之後另補 HTTPError stream 關閉與第二個網址的 old_url 測試，最終共 18 條。

紅燈原始輸出（exit 1；未截斷）：

```text
FFFFFFFFFFFF.FFF
======================================================================
FAIL: test_detected_url_is_recorded_and_duplicate_is_not_registered_again (test_tunnel_events.TunnelEventsTests.test_detected_url_is_recorded_and_duplicate_is_not_registered_again)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 200, in test_detected_url_is_recorded_and_duplicate_is_not_registered_again
    self.assertEqual(1, len(detected))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0

======================================================================
FAIL: test_get_http_error_is_not_match_and_can_recover (test_tunnel_events.TunnelEventsTests.test_get_http_error_is_not_match_and_can_recover)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 157, in test_get_http_error_is_not_match_and_can_recover
    self.assertTrue(self.register())
                    ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_mismatch_retries_put_and_recovers (test_tunnel_events.TunnelEventsTests.test_mismatch_retries_put_and_recovers)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 138, in test_mismatch_retries_put_and_recovers
    self.assertTrue(self.register())
                    ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_missing_endpoint_is_mismatch (test_tunnel_events.TunnelEventsTests.test_missing_endpoint_is_mismatch)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 180, in test_missing_endpoint_is_mismatch
    self.assertFalse(self.register())
                     ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_persistent_mismatch_stops_after_three_retries (test_tunnel_events.TunnelEventsTests.test_persistent_mismatch_stops_after_three_retries)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 147, in test_persistent_mismatch_stops_after_three_retries
    self.assertFalse(self.register())
                     ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_put_http_failure_records_response_code_without_get (test_tunnel_events.TunnelEventsTests.test_put_http_failure_records_response_code_without_get)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 165, in test_put_http_failure_records_response_code_without_get
    self.assertFalse(self.register())
                     ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_success_audits_put_before_after_and_get_match (test_tunnel_events.TunnelEventsTests.test_success_audits_put_before_after_and_get_match)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 123, in test_success_audits_put_before_after_and_get_match
    self.assertTrue(self.register())
                    ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_transport_failure_does_not_invent_http_status (test_tunnel_events.TunnelEventsTests.test_transport_failure_does_not_invent_http_status)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 173, in test_transport_failure_does_not_invent_http_status
    self.assertFalse(self.register())
                     ~~~~~~~~~~~~~^^
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 118, in register
    self.assertTrue(callable(register), "Missing bounded PUT/GET verification and JSONL audit")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : Missing bounded PUT/GET verification and JSONL audit

======================================================================
FAIL: test_tunnel_exit_records_return_code_and_elapsed_seconds (test_tunnel_events.TunnelEventsTests.test_tunnel_exit_records_return_code_and_elapsed_seconds)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_tunnel_events.py", line 208, in test_tunnel_exit_records_return_code_and_elapsed_seconds
    self.assertEqual(1, len(records), "Child exit must leave a JSONL event")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0 : Child exit must leave a JSONL event

======================================================================
FAIL: test_broken_console_does_not_drop_file_log (test_webhook_log_ts.WebhookLogTimestampTests.test_broken_console_does_not_drop_file_log)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 76, in test_broken_console_does_not_drop_file_log
    self.assertEqual("2026-10-29 11:12:13 still recorded\n", self.log.getvalue())
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '2026-10-29 11:12:13 still recorded\n' != 'still recorded\n'
- 2026-10-29 11:12:13 still recorded
+ still recorded


======================================================================
FAIL: test_broken_log_does_not_drop_console (test_webhook_log_ts.WebhookLogTimestampTests.test_broken_log_does_not_drop_console)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 82, in test_broken_log_does_not_drop_console
    self.assertEqual("2026-10-29 11:12:13 still visible\n", self.console.getvalue())
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '2026-10-29 11:12:13 still visible\n' != 'still visible\n'
- 2026-10-29 11:12:13 still visible
+ still visible


======================================================================
FAIL: test_each_multiline_and_blank_line_has_a_timestamp (test_webhook_log_ts.WebhookLogTimestampTests.test_each_multiline_and_blank_line_has_a_timestamp)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 66, in test_each_multiline_and_blank_line_has_a_timestamp
    self.assertEqual("2026-10-29 11:12:13 first\n2026-10-29 11:12:13 \n2026-10-29 11:12:13 third\n", self.log.getvalue())
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '2026-10-29 11:12:13 first\n2026-10-29 11:12:13 \n2026-10-29 11:12:13 third\n' != 'first\n\nthird\n'
- 2026-10-29 11:12:13 first
- 2026-10-29 11:12:13 
- 2026-10-29 11:12:13 third
+ first
+ 
+ third


======================================================================
FAIL: test_import_wraps_stdout_and_stderr_without_starting_server (test_webhook_log_ts.WebhookLogTimestampTests.test_import_wraps_stdout_and_stderr_without_starting_server)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 89, in test_import_wraps_stdout_and_stderr_without_starting_server
    self.assertRegex(value, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (normal|error)\n$")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Regex didn't match: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} (normal|error)\\n$' not found in 'normal\n'

======================================================================
FAIL: test_log_open_failure_still_timestamps_both_consoles (test_webhook_log_ts.WebhookLogTimestampTests.test_log_open_failure_still_timestamps_both_consoles)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 97, in test_log_open_failure_still_timestamps_both_consoles
    self.assertRegex(value, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} fallback\n$")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Regex didn't match: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} fallback\\n$' not found in 'fallback\n'

======================================================================
FAIL: test_print_parts_get_exactly_one_local_timestamp (test_webhook_log_ts.WebhookLogTimestampTests.test_print_parts_get_exactly_one_local_timestamp)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc\fxwash\runtime\test_webhook_log_ts.py", line 61, in test_print_parts_get_exactly_one_local_timestamp
    self.assertEqual(expected, self.log.getvalue())
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '2026-10-29 11:12:13 [Webhook] POST /line/webhook\n' != '[Webhook] POST /line/webhook\n'
- 2026-10-29 11:12:13 [Webhook] POST /line/webhook
+ [Webhook] POST /line/webhook


----------------------------------------------------------------------
Ran 16 tests in 0.107s

FAILED (failures=15)
```

第一次實作後 16 條已綠，但有 HTTPError ResourceWarning。新增 stream 關閉測試，實際觀察到 `test_http_error_response_streams_are_closed` 失敗後，才加 HTTPError.close()；沒有忽略警告來交卷。以下為完成修正、變異驗證後的最後完整綠燈。

綠燈原始輸出（exit 0）：

```text
..................
----------------------------------------------------------------------
Ran 18 tests in 0.494s

OK
```

18 條涵蓋：PUT 前紀錄已落檔、PUT HTTP status、GET 一致、mismatch 後恢復、三次重試耗盡、GET HTTP 錯誤、PUT HTTP 錯誤、傳輸失敗、不洩漏憑證／錯誤 body、缺 endpoint、HTTPError 關閉、網址去重／連續換址、退出 rc／存活秒數，以及時間戳的分段／多行／空行／輸出故障／載入 fallback。

## 移除重試的變異驗證

只在記憶體把 register_webhook 的重試 iterable 由 `(0, *RETRY_DELAYS)` 換成 `(0,)`；沒有改寫工作樹。執行以下兩條原有測試，確實全部轉紅：

- `test_mismatch_retries_put_and_recovers`
- `test_persistent_mismatch_stops_after_three_retries`

原始輸出：

```text
MUTATION: disable retries in memory; initial PUT + GET only
test_mismatch_retries_put_and_recovers (test_tunnel_events.TunnelEventsTests.test_mismatch_retries_put_and_recovers) ... FAIL
test_persistent_mismatch_stops_after_three_retries (test_tunnel_events.TunnelEventsTests.test_persistent_mismatch_stops_after_three_retries) ... FAIL

======================================================================
FAIL: test_mismatch_retries_put_and_recovers (test_tunnel_events.TunnelEventsTests.test_mismatch_retries_put_and_recovers)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc/fxwash/runtime\test_tunnel_events.py", line 142, in test_mismatch_retries_put_and_recovers
    self.assertTrue(self.register())
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^
AssertionError: False is not true

======================================================================
FAIL: test_persistent_mismatch_stops_after_three_retries (test_tunnel_events.TunnelEventsTests.test_persistent_mismatch_stops_after_three_retries)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\Documents\New project 5\shop-pc/fxwash/runtime\test_tunnel_events.py", line 152, in test_persistent_mismatch_stops_after_three_retries
    self.assertEqual(["PUT", "GET"] * 4, self.calls)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET'] != ['PUT', 'GET']

First list contains 6 additional elements.
First extra element 2:
'PUT'

- ['PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'PUT', 'GET']
+ ['PUT', 'GET']

----------------------------------------------------------------------
Ran 2 tests in 0.023s

FAILED (failures=2)
Original function restored; source files unchanged.
```

unittest runner 的結果是 `FAILED (failures=2)`；外層變異驗證命令的 exit 0 表示「精確抓到兩條失敗且沒有 errors」，並非把失敗說成全綠。finally 還原函式，之後重新跑完整 18 條得到前節的綠燈。

可重現的變異核心（在 repo 根目錄，以指定 Python 透過 stdin 執行）：

```python
import ast, inspect, sys, unittest
sys.path.insert(0, 'shop-pc/fxwash')
sys.path.insert(0, 'shop-pc/fxwash/runtime')
from runtime import tunnel_supervisor
from test_tunnel_events import TunnelEventsTests
original = tunnel_supervisor.register_webhook
tree = ast.parse(inspect.getsource(original))
loop = next(n for n in ast.walk(tree) if isinstance(n, ast.For))
loop.iter.args[0] = ast.Tuple(elts=[ast.Constant(value=0)], ctx=ast.Load())
try:
    exec(compile(ast.fix_missing_locations(tree), '<A4-2 no-retry mutation>', 'exec'),
         tunnel_supervisor.__dict__)
    suite = unittest.TestSuite(TunnelEventsTests(name) for name in (
        'test_mismatch_retries_put_and_recovers',
        'test_persistent_mismatch_stops_after_three_retries',
    ))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
finally:
    tunnel_supervisor.register_webhook = original
assert len(result.failures) == 2 and not result.errors
```

## 載入、相容性與變更邊界

真實 `python -c` 載入，沒有啟動 server：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -X utf8 -c "import sys; sys.path.insert(0, 'shop-pc/fxwash'); import runtime.webhook_server; print('A4-2 import OK; server not started')"
```

原始輸出（exit 0）：

```text
2026-10-29 23:37:30 A4-2 import OK; server not started
```

該次載入產生的本機人工驗收 log 已精確移除，沒有把本機測試 log 當成店機正式證據。unittest 另外攔截 ThreadingHTTPServer，確認模組載入沒有建 server。

相容性及未改業務函式的檢查原始輸出（exit 0）：

```text
Python 3.11 syntax: PASS (4 files)
Webhook business function AST: unchanged (13 functions)
shop.json SHA-256 unchanged: f3d2d68e5270f850db6c3b27e68d813ab9093faed16b4f75aa3e85c8f20f257d
Imports in changed/new modules: __future__, base64, connectors, contextlib, datetime, hashlib, hmac, http, importlib, io, json, pathlib, re, runtime, shop_config, shutil, subprocess, sys, threading, time, traceback, types, unittest, urllib, uuid
```

相容檢查以 `ast.parse(..., feature_version=(3, 11))` 解析四個新增／修改 Python 檔；新增 import／使用的 API 均為 Python 3.11 標準庫。實際執行器仍是指定的 Python 3.14，**未宣稱已在店機 Python 3.11 執行**；DEPLOY 第 3 節要求在 embedded 3.11 跑同一組離線測試。

以 git HEAD 的 webhook_server 與現檔比對，13 個頂層業務函式（含 handler 內部邏輯）的 AST 相同，只變更集中式輸出包裝；`shop.json` SHA-256 與開工基線相同。`git diff --check` 已通過；既有其他 dirty／untracked 檔案未重設或提交。

交付回讀另外確認：四個檔案的現行 SHA-256 都與下表相符、RESULT 含完整紅／綠／變異及 import 證據；DEPLOY 的七段 PowerShell 區塊經 Windows PowerShell 5.1 Parser 檢查為 `7 blocks, 0 errors`，僅解析語法，沒有執行部署命令。

四個交付檔 SHA-256（原始檔 bytes；部署時若傳輸工具轉換換行，需重新核對來源與目的）：

| 檔案 | SHA-256 |
| --- | --- |
| `runtime/webhook_server.py` | `161a4dd3473e3fc53fece18bd6db101f5035ee77e75e09b260970cfabb95bca7` |
| `runtime/tunnel_supervisor.py` | `ab5c7937bf15836112e3a8c52274070add8b5c5aa7e08afd3634d313f33329d3` |
| `runtime/test_tunnel_events.py` | `914c0e79f99c5f9b8cb719ff67906c0ef83ad705d6400360f4bf7552d078b562` |
| `runtime/test_webhook_log_ts.py` | `7dc89633fa0f34cecdf1a547af703db83972455619d35ccb6dc361f9336876e7` |

## 環境問題與未完成事項

- 首次測試使用 Python 3.14 TemporaryDirectory 時，mode=0o700 的九個暫存目錄在此受限 Windows runner 無法讀寫，造成 fixture PermissionError。已改用一般 mkdir 的 UUID 隔離目錄並重跑，正式紅綠輸出沒有這些 fixture errors。後續測試的自己建立目錄正常清理。
- 首輪留下九個空目錄：`runtime/.a4-2-00n6kb_z`、`.a4-2-1jgfv7bo`、`.a4-2-64on121k`、`.a4-2-9dm55x_c`、`.a4-2-m0n6ppe5`、`.a4-2-q6r96u4k`、`.a4-2-qdhnztc0`、`.a4-2-sa2v5ptb`、`.a4-2-z8hzdt_a`。它們是在第一個檔案寫入之前就失敗的 task-owned 空目錄；沒有客資或交付內容。
- 自動核准審查拒絕原清理命令，工具回覆 `blocked by policy`。改用單一固定路徑、非遞迴的 Directory.Delete 也實際得到拒絕存取；未修改 ACL、未提權、未擴大刪除。這九個目錄目前保留，git status 掃描它們會有 Permission denied 警告；不影響 18 條測試，不應部署或提交它們。
- 未執行既有 `tests/test_guiding_dialog.py`，因為它是頂層直接呼叫客服生成、指向 `C:\LaundryStores\fxwash` 的手動腳本，超出本卡離線驗收。卡片要求的 runtime `test_*.py` 已全部執行。
- 未連線／部署店機、未進行正式 API／手機／自然 tunnel_exit 驗收、未 commit。實際啟動來源／排程名稱須由總指揮在店機讀回，不由快照猜測。
- 本卡改善觀測與有限回讀重試，不提供固定網域、不保證零停機或客人訊息零遺失，也沒有計算實際每日客數。match 僅表示 endpoint 相符；不代表 LINE active、公開網址可達或通知／對話旅程已驗收。
- 寫入 tunnel_events.jsonl 若失敗，程式會在 stderr 警告並讓既有隧道繼續；部署驗收仍必須確認事件檔確實寫入，不能只看程序或 PUT 成功。
- Graphify 指引及 Windows ADOPTION 已讀；本專案沒有可用的既有 graph。建圖需寫 D 槽，超出本次使用者明定可寫範圍，故改以現行原始碼／呼叫點及 AST 核對影響，未建圖或改寫 Graphify 控制面。
- 九格留痕缺口：本次只允許指定 repo 路徑，因此沒有另外呼叫會寫 Vault 的 ai_vault.py 或修改 Vault 筆記；本次結果、錯誤、證據與接手事項都留在此 RESULT。正式獨立驗收與必要 Vault 收錄由總指揮續接。

部署文件：[`shop-pc/DEPLOY-A4-2.md`](../../shop-pc/DEPLOY-A4-2.md)。
