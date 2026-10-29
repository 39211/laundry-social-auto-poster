# A3-2 修補結果

**通知機制修補與新增 26 條測試通過；整卡驗收尚未全通過。** 既有回歸 29 條中 27 條通過、2 條失敗；以原始 HEAD monitor 再驗仍是相同兩條，屬本機快照既有缺件，未越過四檔範圍修補。

## 範圍與開工卡

- 日期：2026-10-30；owner：店主；maker：Codex，單一 writer；checker：Claude 總指揮待驗收。本輪是 Codex 自檢及離線行為驗證，沒有另派 reviewer，也不宣稱跨家族確認。
- outcome：本機通知失敗可持久重送、毀損狀態停止推播、基線失敗等待重試、完工判定一致、MDB 讀取失敗重查相同 mtime；不變動通知文案與金額。
- 工作目錄：`C:\Users\cyc39\AI-Lanes\a32\repo`；分支：`feat/a3-2-shop-notify-hardening`。
- 起始／目前 HEAD：`dfd6cedb9861cd2264eefc87d979f28f1dfffecc`。工作樹起始乾淨；未 stage、commit、push，未連店機、未呼叫 API。
- authority：只修改卡列四檔；不改 lookup、webhook、connectors、db_manager、shop.json、正式資料或通知文字。不寫 Vault／其他專案檔；本文件保存交接摘要與可重跑證據。
- 開工已取得 Obsidian 首頁注入、唯讀戰情板及相關 Vault 搜尋／live Current-Context；筆記沒有增加操作權限。記憶 registry 沒有本卡命中，判斷以卡片及目前原碼為準。
- 驗收證據：相同 26 條測試的紅→綠、兩個記憶體變異、既有回歸與原始 HEAD 對照、`-I -S` 標準庫隔離測試、3.11 AST 語法檢查與 diff 檢查，詳下文。

## 四檔差異

| 檔案 | 變更 |
| --- | --- |
| `shop-pc/fxwash/runtime/inbound_monitor.py` | 把輪詢拆成可離線驅動的 InboundMonitor；保留 run_monitor 入口與原 push／客號解析邊界；加入 append-only 收件人回條、原子 state、基線閘門、複合去重與失敗 mtime 重查。 |
| `shop-pc/fxwash/runtime/test_inbound_monitor.py` | 26 條 unittest；假 run_query 使用記憶體 SQLite，假 push_message／token／urlopen、可控時鐘，state/outbox 存在獨立臨時目錄。由真 run_monitor 入口驅動。 |
| `shop-pc/DEPLOY-A3-2.md` | 四檔交付清單、兩個 runtime 檔部署、停 watchdog／monitor 的精確 PID 規則、備份與 SHA、離線測試、讀回及有通知後禁止盲目倒回舊 state 的回退程序。未執行。 |
| `docs-internal/cards/A3-2-RESULT.md` | 本結果、原始測試輸出、限制與交接。 |

| 卡片項目 | 實作／驗證 |
| --- | --- |
| 1. push False／例外重送 | 初送前保存每事件與收件人的 intent；失敗留 pending，下一輪先重送 outbox，即使 mtime 不變、MDB 查詢失敗或 MDB 不存在仍可重送。每個 uid 各自保存 done／abandoned；成功者不陪失敗者重送。較早 intake 未結案時不越過 cursor。 |
| 2. 原子 state／毀損停止 | 同目錄 monitor_state.json.tmp 完整寫入、flush／fsync 後 os.replace。毀損 JSON／結構錯誤保留原檔及 .corrupt-時間戳副本，記 STATE_CORRUPT 停止推播；原檔留在原處防止 watchdog 重啟誤建新基線。 |
| 3. 首啟基線 | MAX(Did) 與目前完工集合都成功後才保存並進入正常掃描；任一失敗不保存半份、不發歷史，下一輪再試。空資料庫的成功基線也可持久保存。 |
| 4. 完工條件／去重 | Dater 空，且 Datei 非空或 State 為「完工」，對齊 connector 310–318 的先取件再完工順序；SQL 使用 Trim 對齊 db_manager 對欄位的 Trim。completed_keys 保存 (Dno, Did)，支援同 Dno 不同 Did。 |
| 5. MDB 失敗不吞 mtime | 同輪兩項掃描查詢都成功後才處理新事件並保存 mtime；失敗輪保留原 mtime。連續失敗每 10 輪只記一行 MDB_QUERY_FAILED，成功後重置計數。 |

outbox 檔為 `data/notify_outbox.jsonl`，含 ts（epoch 秒）、kind、dno、did、uid、attempts、last_error_type、status、recipients、messages。每行是不可覆寫的狀態更新，載入時按 (kind, dno, did, uid) 取最後一筆。原收件人與文字快照用於重啟後重送；不從後來的綁定替換收件人。缺綁定沿用略過政策，但明記 abandoned／NoBinding，不冒充送達。

**attempts 定義為「重送次數」**：初送失敗是 0；再依序等待 6 秒、30 秒、120 秒、600 秒、3600 秒重送，最多 5 次重送（含初送至多 6 次 push）。這樣五個指定間隔都有使用；第 5 次重送失敗才 abandoned，成功才 done。間隔是下限，輪詢／查詢耗時與停機可延後。先持久化重送次數再跨外部邊界，重啟不重置預算。

舊 completed_dnos 的遷移只映射「同 Dno、Did 不高於舊 last_did」的當前可取件，不把所有當前件當新基線；新 Did 重用舊 Dno 仍通知。原檔只有 Dno，不能還原全部歷史 Did，此為資料限制。

## Python、雜湊與命令

指定直譯器：`C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe`，本機實際 3.14.6。全部新增程式只用標準庫及既有本機模組。另以 `-I -S -B` 跑 26 條測試通過，並對兩個 Python 檔 `ast.parse(..., feature_version=(3, 11))` 通過；**未在店機 3.11 embedded 實跑**，沒有把語法檢查稱為店機驗收。

| 檔案 | SHA-256（本機原始 bytes） |
| --- | --- |
| `runtime/inbound_monitor.py` | `81099947175e350437045a7da77f0ebb1a4cb8687b239be38d7d4da1463107d4` |
| `runtime/test_inbound_monitor.py` | `9ecd62ed430e45ba5c6b7cd9a5dc0a235ab07d1ecb249bc564abb8498fb47fa5` |
| `shop-pc/DEPLOY-A3-2.md` | `d643aa9f544034dbf302c0fea459c0f20f0161cfbe52cea4a73878c6caa8d2d7` |

git diff --check 通過。Git 提示原樹 autocrlf 可能在未來操作時轉成 CRLF；部署應以實際交付 bytes 重核 SHA，不能把換行不同的檔冒充上述雜湊。本 RESULT 不列自我雜湊。

## 紅→綠原始輸出

修 production 前先寫測試；有效紅燈 **26 條，22 failures、0 errors**，五件修補都有失敗的行為斷言。其餘 4 條是既有行為保護。修補後完全相同 26 條全綠。前兩輪因 Windows 3.14 的 mkdtemp 0700 ACL 造成 52 個環境 errors／輪，不計為有效紅燈；測試夾具改為在本樹建立、繼承權限的臨時目錄後，才取得下面的有效紅燈。未靠修改 production 來繞過環境錯誤。

兩次命令相同（避免產生 pyc）：
~~~powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe' -X utf8 -B -m unittest discover -s shop-pc/fxwash/runtime -p test_inbound_monitor.py
~~~

### 紅燈（exit 1）

~~~text
FFFFFFFFFFFF..FFFFF.FFFFF.
======================================================================
FAIL: test_atomic_replace_failure_leaves_previous_state_intact (test_inbound_monitor.InboundMonitorTests.test_atomic_replace_failure_leaves_previous_state_intact)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 260, in test_atomic_replace_failure_leaves_previous_state_intact
    self.assertEqual(before, f.state_file.read_bytes(), "direct overwrite destroys last good state")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: b'{"last_did": "000010", "completed_dnos": ["OLD"]}' != b'{\r\n  "last_did": "000010",\r\n  "complet[32 chars]r\n}' : direct overwrite destroys last good state

======================================================================
FAIL: test_completion_dedup_uses_dno_and_did (test_inbound_monitor.InboundMonitorTests.test_completion_dedup_uses_dno_and_did)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 361, in test_completion_dedup_uses_dno_and_did
    self.assertEqual(2, len(f.completions()), "same Dno with different Did are different pieces")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 1 : same Dno with different Did are different pieces

======================================================================
FAIL: test_corrupt_state_is_preserved_and_blocks_all_pushes (test_inbound_monitor.InboundMonitorTests.test_corrupt_state_is_preserved_and_blocks_all_pushes)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 275, in test_corrupt_state_is_preserved_and_blocks_all_pushes
    self.assertEqual([], f.pushes)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^
AssertionError: Lists differ: [] != [{'uid': 'test-user-a', 'messages': [{'typ[93 chars]6.0}]

Second list contains 1 additional elements.
First extra element 0:
{'uid': 'test-user-a', 'messages': [{'type': 'text', 'text': '您好，已收到您的送洗衣物：\n• 測試襯衫（單號：NEW）｜ 70 元\n衣物處理完成後會再第一時間主動發訊通知您！'}], 'ts': 1006.0}

- []
+ [{'messages': [{'text': '您好，已收到您的送洗衣物：\n'
+                         '• 測試襯衫（單號：NEW）｜ 70 元\n'
+                         '衣物處理完成後會再第一時間主動發訊通知您！',
+                 'type': 'text'}],
+   'ts': 1006.0,
+   'uid': 'test-user-a'}]

======================================================================
FAIL: test_empty_database_is_a_valid_persisted_baseline (test_inbound_monitor.InboundMonitorTests.test_empty_database_is_a_valid_persisted_baseline)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 332, in test_empty_database_is_a_valid_persisted_baseline
    self.assertIs(True, f.state().get("baseline_initialized"))
    ~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not None

======================================================================
FAIL: test_empty_legacy_ready_set_does_not_rebaseline_offline_completions (test_inbound_monitor.InboundMonitorTests.test_empty_legacy_ready_set_does_not_rebaseline_offline_completions)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 342, in test_empty_legacy_ready_set_does_not_rebaseline_offline_completions
    self.assertEqual(1, len(f.completions()))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0

======================================================================
FAIL: test_failed_baseline_does_not_save_half_initialized_state (test_inbound_monitor.InboundMonitorTests.test_failed_baseline_does_not_save_half_initialized_state)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 325, in test_failed_baseline_does_not_save_half_initialized_state
    self.assertFalse(f.state_file.exists(), "both baseline queries must succeed before save")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: True is not false : both baseline queries must succeed before save

======================================================================
FAIL: test_failed_completion_query_retries_same_mtime (test_inbound_monitor.InboundMonitorTests.test_failed_completion_query_retries_same_mtime)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 405, in test_failed_completion_query_retries_same_mtime
    self.assertEqual(1, len(f.completions()))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0

======================================================================
FAIL: test_failed_intake_query_retries_same_mtime (test_inbound_monitor.InboundMonitorTests.test_failed_intake_query_retries_same_mtime)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 389, in test_failed_intake_query_retries_same_mtime
    self.assertEqual(1, len(f.pushes), "failed query must not consume MDB mtime")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0 : failed query must not consume MDB mtime

======================================================================
FAIL: test_failed_max_baseline_retries_without_notifying_history (test_inbound_monitor.InboundMonitorTests.test_failed_max_baseline_retries_without_notifying_history)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 299, in test_failed_max_baseline_retries_without_notifying_history
    self.assertEqual([], f.pushes, "failed MAX must never become a 000000 baseline")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: [] != [{'uid': 'test-user-a', 'messages': [{'typ[97 chars]6.0}]

Second list contains 1 additional elements.
First extra element 0:
{'uid': 'test-user-a', 'messages': [{'type': 'text', 'text': '您好，已收到您的送洗衣物：\n• 測試襯衫（單號：HISTORY）｜ 70 元\n衣物處理完成後會再第一時間主動發訊通知您！'}], 'ts': 1006.0}

- []
+ [{'messages': [{'text': '您好，已收到您的送洗衣物：\n'
+                         '• 測試襯衫（單號：HISTORY）｜ 70 元\n'
+                         '衣物處理完成後會再第一時間主動發訊通知您！',
+                 'type': 'text'}],
+   'ts': 1006.0,
+   'uid': 'test-user-a'}] : failed MAX must never become a 000000 baseline

======================================================================
FAIL: test_failed_ready_baseline_retries_without_notifying_history (test_inbound_monitor.InboundMonitorTests.test_failed_ready_baseline_retries_without_notifying_history)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 317, in test_failed_ready_baseline_retries_without_notifying_history
    self.assertEqual([], f.pushes)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^
AssertionError: Lists differ: [] != [{'uid': 'test-user-a', 'messages': [{'typ[170 chars]6.0}]

Second list contains 1 additional elements.
First extra element 0:
{'uid': 'test-user-a', 'messages': [{'type': 'text', 'text': '您好，您的送洗衣物已經處理完工囉！\n• 測試襯衫（單號：HISTORY）｜ 70 元\n\n歡迎於門市營業時間前來取件。\n我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n週一至週五 10:00-20:00；週六 12:00-18:00；週日公休'}], 'ts': 1006.0}

- []
+ [{'messages': [{'text': '您好，您的送洗衣物已經處理完工囉！\n'
+                         '• 測試襯衫（單號：HISTORY）｜ 70 元\n'
+                         '\n'
+                         '歡迎於門市營業時間前來取件。\n'
+                         '我們在至善國中對面，407 臺中市西屯區至善里青海路二段365號。\n'
+                         '週一至週五 10:00-20:00；週六 12:00-18:00；週日公休',
+                 'type': 'text'}],
+   'ts': 1006.0,
+   'uid': 'test-user-a'}]

======================================================================
FAIL: test_false_push_is_queued_then_retried_without_mtime_change (test_inbound_monitor.InboundMonitorTests.test_false_push_is_queued_then_retried_without_mtime_change)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 159, in test_false_push_is_queued_then_retried_without_mtime_change
    self.assertEqual(2, len(f.pushes))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 1

======================================================================
FAIL: test_legacy_migration_preserves_history_without_suppressing_new_did (test_inbound_monitor.InboundMonitorTests.test_legacy_migration_preserves_history_without_suppressing_new_did)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 371, in test_legacy_migration_preserves_history_without_suppressing_new_did
    self.assertEqual(1, len(f.completions()))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0

======================================================================
FAIL: test_outbox_is_retried_before_fresh_database_queries (test_inbound_monitor.InboundMonitorTests.test_outbox_is_retried_before_fresh_database_queries)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 227, in test_outbox_is_retried_before_fresh_database_queries
    self.assertEqual(2, len(f.pushes), "MDB outage must not prevent queued retries")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 1 : MDB outage must not prevent queued retries

======================================================================
FAIL: test_outbox_retries_even_when_mdb_file_is_missing (test_inbound_monitor.InboundMonitorTests.test_outbox_retries_even_when_mdb_file_is_missing)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 237, in test_outbox_retries_even_when_mdb_file_is_missing
    self.assertEqual(2, len(f.pushes))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 1

======================================================================
FAIL: test_partial_recipient_failure_does_not_resend_successful_recipient (test_inbound_monitor.InboundMonitorTests.test_partial_recipient_failure_does_not_resend_successful_recipient)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 191, in test_partial_recipient_failure_does_not_resend_successful_recipient
    self.assertEqual(["test-user-a", "test-user-b", "test-user-b"], [p["uid"] for p in f.pushes])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: ['test-user-a', 'test-user-b', 'test-user-b'] != ['test-user-a', 'test-user-b']

First list contains 1 additional elements.
First extra element 2:
'test-user-b'

- ['test-user-a', 'test-user-b', 'test-user-b']
?                 ---------------

+ ['test-user-a', 'test-user-b']

======================================================================
FAIL: test_pending_completion_does_not_enter_dedup_set_until_delivered (test_inbound_monitor.InboundMonitorTests.test_pending_completion_does_not_enter_dedup_set_until_delivered)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 200, in test_pending_completion_does_not_enter_dedup_set_until_delivered
    self.assertNotIn("READY", state.get("completed_dnos", []))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 'READY' unexpectedly found in ['READY', 'OLD']

======================================================================
FAIL: test_pending_earlier_intake_blocks_cursor_but_does_not_repeat_later_success (test_inbound_monitor.InboundMonitorTests.test_pending_earlier_intake_blocks_cursor_but_does_not_repeat_later_success)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 422, in test_pending_earlier_intake_blocks_cursor_but_does_not_repeat_later_success
    self.assertEqual("000010", f.state()["last_did"])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '000010' != '000012'
- 000010
?      ^
+ 000012
?      ^


======================================================================
FAIL: test_push_exception_is_durable_with_error_type_only (test_inbound_monitor.InboundMonitorTests.test_push_exception_is_durable_with_error_type_only)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 168, in test_push_exception_is_durable_with_error_type_only
    self.assertTrue(f.outbox(), "exception must not lose event")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: [] is not true : exception must not lose event

======================================================================
FAIL: test_query_failure_logs_once_per_ten_consecutive_rounds (test_inbound_monitor.InboundMonitorTests.test_query_failure_logs_once_per_ten_consecutive_rounds)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 412, in test_query_failure_logs_once_per_ten_consecutive_rounds
    self.assertEqual(2, len(lines), f.stderr.getvalue())
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 0 : [Monitor Query Error] Intake check: synthetic MDB read failure
[Monitor Query Error] Completion check: synthetic MDB read failure


======================================================================
FAIL: test_restart_preserves_original_recipient_and_append_only_receipts (test_inbound_monitor.InboundMonitorTests.test_restart_preserves_original_recipient_and_append_only_receipts)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 210, in test_restart_preserves_original_recipient_and_append_only_receipts
    self.assertTrue(f.outbox_file.exists(), "outbox must survive restart")
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true : outbox must survive restart

======================================================================
FAIL: test_retry_uses_five_backoff_intervals_then_abandons (test_inbound_monitor.InboundMonitorTests.test_retry_uses_five_backoff_intervals_then_abandons)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 180, in test_retry_uses_five_backoff_intervals_then_abandons
    self.assertEqual([1006, 1012, 1042, 1162, 1762, 5362], [p["ts"] for p in f.pushes])
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: Lists differ: [1006, 1012, 1042, 1162, 1762, 5362] != [1006.0]

First list contains 5 additional elements.
First extra element 1:
1012

- [1006, 1012, 1042, 1162, 1762, 5362]
+ [1006.0]

======================================================================
FAIL: test_state_only_completion_matches_lookup (test_inbound_monitor.InboundMonitorTests.test_state_only_completion_matches_lookup)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 348, in test_state_only_completion_matches_lookup
    self.assertEqual(1, len(f.completions()), "State=完工 without Datei must notify")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 1 != 0 : State=完工 without Datei must notify

----------------------------------------------------------------------
Ran 26 tests in 0.420s

FAILED (failures=22)
~~~

### 綠燈（exit 0）

~~~text
..........................
----------------------------------------------------------------------
Ran 26 tests in 0.578s

OK
~~~

### 標準庫隔離再驗（exit 0）

命令使用同一直譯器加 `-I -S -B -m unittest discover -s shop-pc/fxwash/runtime -p test_inbound_monitor.py`。

~~~text
..........................
----------------------------------------------------------------------
Ran 26 tests in 0.738s

OK
~~~

## 指定變異的原始輸出

只在記憶體另建 mutant 模組；沒有覆寫受測檔。移除 poll 中 `_retry_outbox()`，指定重送測試紅；把 `os.replace(tmp, state_file)` 改回 `state_file.write_text(...)`，指定原子保存測試紅。兩個 mutant 均是 1 failure、0 errors，主檔 SHA 前後一致；runner exit 0 表示兩項預期退化都被抓到。

~~~text
MUTATION: OUTBOX_RETRY_REMOVED
test_false_push_is_queued_then_retried_without_mtime_change (a32_tests.InboundMonitorTests.test_false_push_is_queued_then_retried_without_mtime_change) ... FAIL

======================================================================
FAIL: test_false_push_is_queued_then_retried_without_mtime_change (a32_tests.InboundMonitorTests.test_false_push_is_queued_then_retried_without_mtime_change)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 159, in test_false_push_is_queued_then_retried_without_mtime_change
    self.assertEqual(2, len(f.pushes))
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^
AssertionError: 2 != 1

----------------------------------------------------------------------
Ran 1 test in 0.026s

FAILED (failures=1)
MUTATION DETECTED: OUTBOX_RETRY_REMOVED
MUTATION: ATOMIC_REPLACE_REMOVED
test_atomic_replace_failure_leaves_previous_state_intact (a32_tests.InboundMonitorTests.test_atomic_replace_failure_leaves_previous_state_intact) ... FAIL

======================================================================
FAIL: test_atomic_replace_failure_leaves_previous_state_intact (a32_tests.InboundMonitorTests.test_atomic_replace_failure_leaves_previous_state_intact)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\runtime\test_inbound_monitor.py", line 260, in test_atomic_replace_failure_leaves_previous_state_intact
    self.assertEqual(before, f.state_file.read_bytes(), "direct overwrite destroys last good state")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: b'{"last_did": "000010", "completed_dnos": ["OLD"]}' != b'{\r\n  "last_did": "000010",\r\n  "complet[48 chars]r\n}' : direct overwrite destroys last good state

----------------------------------------------------------------------
Ran 1 test in 0.021s

FAILED (failures=1)
MUTATION DETECTED: ATOMIC_REPLACE_REMOVED
Source bytes unchanged by mutation checks.
~~~

## 既有回歸：既有兩項缺件，未全綠

依卡執行 `unittest discover -s shop-pc/fxwash/tests` 的同一套 discovery。因其中 `test_guiding_dialog.py` 在 import 時會執行聊天範例，需先隔離 Gemini key 取得函式，移除兩個 API key 環境變數並用 audit hook 阻擋網路與正式門市路徑；沒有呼叫 API 或讀正式 secrets。Windows 臨時目錄同樣使用繼承 ACL，測試暫存根在本樹，正常測試結束後清除。這些隔離只在測試程序記憶體內，沒有改既有測試／設定。

可重跑的完整包裝如下（不是把外部結果假造成成功；LINE 等既有測試仍使用其原來的假 opener）：

~~~python
import os, runpy, socket, sys, tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path('shop-pc/fxwash').resolve()))
os.environ.pop('GEMINI_API_KEY', None)
os.environ.pop('GOOGLE_API_KEY', None)
blocked = []
def audit(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'http.client.connect'):
        blocked.append(event)
        raise AssertionError('A3-2: external network forbidden')
    if event == 'open' and isinstance(args[0], str) and args[0].lower().replace('/', '\\').startswith('c:\\laundrystores\\'):
        raise AssertionError('A3-2: formal store path forbidden')
sys.addaudithook(audit)
real_mkdir = os.mkdir
def inherited_mkdir(path, mode=0o777, **kwargs):
    return real_mkdir(path, 0o777 if os.name == 'nt' and mode == 0o700 else mode, **kwargs)
with patch.object(os, 'mkdir', side_effect=inherited_mkdir):
    with tempfile.TemporaryDirectory(prefix='.a3-2-regression-', dir=Path.cwd()) as raw:
        tempfile.tempdir = raw
        from runtime import chat_service
        with patch.object(chat_service, 'get_gemini_api_key', return_value=''):
            sys.argv = ['unittest', 'discover', '-s', 'shop-pc/fxwash/tests']
            try:
                runpy.run_module('unittest', run_name='__main__')
            finally:
                print('A3-2 network attempts:', len(blocked))
~~~

兩項失敗：

1. `test_install_creates_clean_instance_and_refuses_overwrite`：此快照沒有測試期待的 `shop-pc/fxwash/Install.ps1`。
2. `test_pack_product_kit_zip_excludes_real_secrets`：打包沒有 `secrets/line-channel.json.example`。

以上兩路徑在 HEAD 的 `git ls-tree` 無項目。未新增安裝腳本、secrets 樣板、假 skip 或修改測試來湊綠燈。以下為本輪完整輸出（exit 1）：

~~~text
............F.......F........
======================================================================
FAIL: test_install_creates_clean_instance_and_refuses_overwrite (test_product_kit.ProductKitTests.test_install_creates_clean_instance_and_refuses_overwrite)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\tests\test_product_kit.py", line 251, in test_install_creates_clean_instance_and_refuses_overwrite
    self.assertEqual(0, first.returncode, first.stderr)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 0 != 4294770688 : The argument 'C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\Install.ps1' to the -File parameter does not exist. Provide the path to an existing '.ps1' file as an argument to the -File parameter.


======================================================================
FAIL: test_pack_product_kit_zip_excludes_real_secrets (test_product_kit.ProductKitTests.test_pack_product_kit_zip_excludes_real_secrets)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\tests\test_product_kit.py", line 330, in test_pack_product_kit_zip_excludes_real_secrets
    self.assertTrue(any(m.endswith("secrets/line-channel.json.example") for m in members))
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true

----------------------------------------------------------------------
Ran 29 tests in 2.392s

FAILED (failures=2)
============================================================
Total phrases in Dialog Corpus: 659 across 21 categories
============================================================

[顧客詢問] 我羽絨衣自己丟洗衣機洗完，整件裡面的毛結成一球一坨的，還有救嗎？
[意圖分類] DOWN_AND_LEATHER_CARE
[Corpus 詞庫備援回覆] 真皮皮背心一件 800 元、真皮皮褲 700 元，定期上天然皮革保養乳，皮質可以維持十幾年依然柔軟有韌性。隨時歡迎送洗！
[AI 線上專員引導式回覆] 不管是羽絨還是皮衣，專業洗滌才能真正保養好高單價衣物。門市在至善國中正對面，開車門口超好臨停，隨時等候您的光臨！
------------------------------------------------------------

[顧客詢問] 衣服沾到立可白跟口香糖怎麼辦？
[意圖分類] SPECIAL_STAINS_AND_REPAIR
[Corpus 詞庫備援回覆] 汗漬若伴隨硬化鹽結晶，我們會先做活氧溫水軟化預浸再柔洗。您這件衣服大概放了多久呢？可以直接告訴我，我為您評估洗淨率～
[AI 線上專員引導式回覆] 衣服被奇異筆或麥克筆劃到，請勿使用水洗搓揉以免大面積暈染。拍張局部照傳給我，我先確認是油性筆還是水性筆～
------------------------------------------------------------

[顧客詢問] 我家貓咪尿在厚棉被上，味道超重可以洗掉嗎？
[意圖分類] PET_AND_ODOR_REMOVAL
[Corpus 詞庫備援回覆] 貓咪尿在皮包或鞋子裡？請務必第一時間用紙巾吸乾不要泡水，趕快拿來門市，師傅以皮革專用酵素除味劑處理，搶救成功率最高！
[AI 線上專員引導式回覆] 抱枕被咖啡打翻浸透，內部棉花若有發酸異味，整顆水洗高溫烘透只要約 100~150 元。直接帶來門市交給我們！
------------------------------------------------------------

[顧客詢問] 這件衣服洗標寫不能水洗也不能乾洗，你們能洗嗎？
[意圖分類] DRY_CLEANING_FAQ
[Corpus 詞庫備援回覆] 亞麻材質衣服容易縮水皺巴巴怎麼洗？亞麻水洗縮水率較高，門市會採低溫柔洗或乾洗，洗後使用高壓蒸汽整燙把織紋拉平伸展。隨時歡迎送洗！
[AI 線上專員引導式回覆] 西裝外套能不能局部水洗自己擦？西裝胸口有複合胸襯與墊肩，局部沾水易造成內襯脫膠起泡不平整！有污漬請整件交給門市做全套精緻乾洗與立體整燙最安全。
------------------------------------------------------------

[顧客詢問] 你們是稱重還是算件的？洗好可以先放你們那邊一個月嗎？
[意圖分類] SERVICE_LOGISTICS_FAQ
[Corpus 詞庫備援回覆] 私享家洗衣是算件計費還是稱重算的呢？我們門市一律採「單件標準透明計費」，襯衫棉T一件70元、西褲100元、外套150~180元、運動鞋一雙250元，對齊官方標準主檔，每件都有條碼追蹤，價格公道安心！想洗什麼直接跟我說～
[AI 線上專員引導式回覆] 手機號碼查進度需要先註冊密碼嗎？完全不需要密碼喔！只要您在門市留過手機號碼，隨時直接在本 LINE 對話框打入「手機號碼」（如 0912345678），系統 1 秒鐘直接列出您所有的送洗明細與進度，超級方便！
------------------------------------------------------------

[顧客詢問] 我的衣服好了沒？
[意圖分類] STATUS_LOOKUP_GUIDE
[Corpus 詞庫備援回覆] 查單完全免打電話排隊等待，在 LINE 上隨時隨地都能自主掌握衣物動態。
[AI 線上專員引導式回覆] 系統查詢服務 24 小時全年無休，半夜或清晨想確認衣服好了沒皆可自由查閱。
------------------------------------------------------------

[顧客詢問] 你們回答好官方喔，根本是機器人吧
[意圖分類] BOT_SKEPTICISM_AND_CHITCHAT
[Corpus 詞庫備援回覆] 不好意思，剛剛那是系統的快速分流回覆！我是門市的線上專員，您手邊有想洗的東西嗎？直接跟我聊聊您的需求。
[AI 線上專員引導式回覆] 抱歉！剛剛那是預設的快捷提示。我是門市線上接待專員，請問您今天想了解哪一類的洗滌服務呢？
------------------------------------------------------------
A3-2 network attempts: 0
~~~

另外將 `git show HEAD:shop-pc/fxwash/runtime/inbound_monitor.py` 載入記憶體作為原始 monitor，保持所有工作檔不變，用同一隔離包裝再跑。仍是同 29 條、同兩項 failures，網路嘗試 0（exit 1）：

~~~text
BASELINE: original HEAD inbound_monitor loaded in memory; working files unchanged.
============================================================
Total phrases in Dialog Corpus: 659 across 21 categories
============================================================

[顧客詢問] 我羽絨衣自己丟洗衣機洗完，整件裡面的毛結成一球一坨的，還有救嗎？
[意圖分類] DOWN_AND_LEATHER_CARE
[Corpus 詞庫備援回覆] 羽絨大衣帽子邊緣有化妝品粉底沾染，師傅洗前會先做帽簷局部預除油除漬。送洗時跟我們備註一下即可～
[AI 線上專員引導式回覆] 皮草領、可拆式毛領（貉子毛、狐狸毛），我們會拆下做專用皮草乾洗梳毛保養，洗後毛流柔順蓬鬆。送洗時記得連同毛領一起帶來喔！
------------------------------------------------------------

[顧客詢問] 衣服沾到立可白跟口香糖怎麼辦？
[意圖分類] SPECIAL_STAINS_AND_REPAIR
[Corpus 詞庫備援回覆] 皮帶金屬扣頭氧化失去光澤，保養皮帶時師傅會順道為您做五金拋光除氧化。送洗皮件時直接交給我們即可～
[AI 線上專員引導式回覆] 毛衣或針織衫穿久起毛球，送洗時若有需要，師傅會使用專業除毛球設備為您整理表面，讓衣服看起來平整如新！送洗時直接跟我們備註就可以囉～
------------------------------------------------------------

[顧客詢問] 我家貓咪尿在厚棉被上，味道超重可以洗掉嗎？
[意圖分類] PET_AND_ODOR_REMOVAL
[Corpus 詞庫備援回覆] 衣服長期使用過量柔軟精反而在纖維表面結蠟產生油垢味，門市專用去皂垢洗程能還原布料原本的透氣手感。送洗時跟我們說明一下即可～
[AI 線上專員引導式回覆] 抱枕被咖啡打翻浸透，內部棉花若有發酸異味，整顆水洗高溫烘透只要約 100~150 元。直接帶來門市交給我們！
------------------------------------------------------------

[顧客詢問] 這件衣服洗標寫不能水洗也不能乾洗，你們能洗嗎？
[意圖分類] DRY_CLEANING_FAQ
[Corpus 詞庫備援回覆] 雪紡紗裙洗完百褶摺痕會不會不見？師傅整燙時會以手工壓摺工藝固定摺線，維持百褶裙的飄逸立體感。送洗時跟我們備註一下即可！
[AI 線上專員引導式回覆] 為什麼衣服一定要乾洗？乾洗是使用不含水分的專業有機溶劑洗滌，天然羊毛、蠶絲等動物纖維遇水容易毛鱗片摩擦氈化縮水變形，乾洗能徹底溶解油垢同時保護面料原本的版型與光澤！送來門市交給專業乾洗最安心～
------------------------------------------------------------

[顧客詢問] 你們是稱重還是算件的？洗好可以先放你們那邊一個月嗎？
[意圖分類] SERVICE_LOGISTICS_FAQ
[Corpus 詞庫備援回覆] 如果遺失了送洗單據取件聯怎麼辦？您別擔心，只要出示您的手機 LINE 查詢畫面，或是跟店員核對您送洗時登記的手機號碼與姓名，確認身分後即可順利取件！
[AI 線上專員引導式回覆] 送洗需要先打電話跟你們講一聲嗎？完全不需要先打電話預約喔！只要在營業時間（週一至五 10:00-20:00、週六 12:00-18:00，週日公休）直接提著衣物過來門市，專員隨時為您收件點交！
------------------------------------------------------------

[顧客詢問] 我的衣服好了沒？
[意圖分類] STATUS_LOOKUP_GUIDE
[Corpus 詞庫備援回覆] 若您手邊有門市客號（如 0028 或 1133），亦可直接輸入客號進行即時查單。
[AI 線上專員引導式回覆] 輸入手機號碼即可 24 小時線上秒查進度，衣物洗好完成整燙時，系統也會主動發送 LINE 推播取件通知。
------------------------------------------------------------

[顧客詢問] 你們回答好官方喔，根本是機器人吧
[意圖分類] BOT_SKEPTICISM_AND_CHITCHAT
[Corpus 詞庫備援回覆] 不好意思！系統訊息確實比較生硬，我是門市線上服務人員，您想了解哪件衣物的洗滌方式，請直接跟我說。
[AI 線上專員引導式回覆] 抱歉讓您見笑了！剛剛的回覆確實太制式。我是私享家門市專員，您想了解洗滌天數、價格還是特殊去漬呢？我逐一為您解答。
------------------------------------------------------------
............F.......F........
======================================================================
FAIL: test_install_creates_clean_instance_and_refuses_overwrite (test_product_kit.ProductKitTests.test_install_creates_clean_instance_and_refuses_overwrite)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\tests\test_product_kit.py", line 251, in test_install_creates_clean_instance_and_refuses_overwrite
    self.assertEqual(0, first.returncode, first.stderr)
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: 0 != 4294770688 : The argument 'C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\Install.ps1' to the -File parameter does not exist. Provide the path to an existing '.ps1' file as an argument to the -File parameter.


======================================================================
FAIL: test_pack_product_kit_zip_excludes_real_secrets (test_product_kit.ProductKitTests.test_pack_product_kit_zip_excludes_real_secrets)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a32\repo\shop-pc\fxwash\tests\test_product_kit.py", line 330, in test_pack_product_kit_zip_excludes_real_secrets
    self.assertTrue(any(m.endswith("secrets/line-channel.json.example") for m in members))
    ~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: False is not true

----------------------------------------------------------------------
Ran 29 tests in 1.915s

FAILED (failures=2)
A3-2 network attempts: 0
~~~

## 未完成、限制與交接

- **卡片「既有測試仍全綠」門檻未滿足**；當前及原始 HEAD 都是 27/29。相關缺件不在允許四檔中，本輪未修補。因此只宣稱本機通知修補與新增測試通過，不能宣稱整卡全通過、正式可用或已部署。
- 未連店機、未查真 MDB、未呼叫 LINE／Gemini 等 API；未發測試訊息，未實測 3.11 embedded、正式程序停起、店機部署、店機回退或顧客手機送達。DEPLOY 是交接操作文件，沒有執行過。
- done 僅代表 push_message 回傳 True，不是客戶已讀；API 接受但回應逾時，或成功後回條落盤前斷電，仍可能重複。此卡未加入外部冪等識別，不能保證 exactly-once。
- 綁定身分漏洞、客號解析差異、綁定撤權／讀取失敗、MDB 正式／備份路徑一致性及 Did 重編不是此卡修補範圍；原本通知金額、字句、地址與營業時間均保留。兩個文案完整斷言通過。
- 初期 ACL 錯誤留下 **26 個本樹下 .a3-2-* 空目錄**（在建立 data 子目錄前即遭拒，未寫測試資料），另首輪系統 Temp 有同型 26 個 a3-2-* 空目錄。臨時目錄清理被 ACL 拒絕；對本樹目錄核對為非 reparse 後，僅嘗試非遞迴空目錄移除，也被拒絕。沒有改 ACL、提權、遞迴刪除或操作其他人的目錄。Git 會對本樹這 26 個空目錄出現 Permission denied 警告。後續 26 條測試及回歸測試的臨時目錄正常清除，沒有新的殘留資料檔。
- 四個交付檔以外沒有版本檔變更，沒有 stage／commit／push。依本次「只改四檔」及沙箱可寫範圍，沒有執行會寫 Vault 的 task_summary；開工卡、驗證與交接已完整留在本 RESULT，供總指揮驗收及保存。
- 九格缺：第 9 格的 Vault 回寫未做，原因如上；checker 尚未完成外部驗收。其餘依本卡範圍完成，沒有把自檢當獨立審查。

交接下一步：Claude 總指揮核對這四檔與上述證據，處理既有套件缺件及測試暫存 ACL 殘留；正式部署與現場驗收仍須依原維護流程安排，本輪不自行延伸執行。

