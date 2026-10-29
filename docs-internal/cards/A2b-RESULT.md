# A2b 結果：夜間 MDB 副本與資料時間

日期：2026-10-30。工作目錄：`C:\Users\cyc39\AI-Lanes\a2b\repo`，分支 `feat/a2b-night-mdb-copy`。

本機實作及離線驗證完成，交總指揮驗收；尚未部署、未執行真實拉檔、未啟用排程。沒有連 `shop-pc`、沒有存取 `C:\FXwash` 或正式 `laundry-repo`，沒有重啟程序、修改 LINE 設定或 commit。

## 開工卡與範圍

- Outcome：交付可備份、驗檔及替換 MDB 的腳本，查件顯示副本時間，過期快照阻擋到件通知，附可複驗的測試與部署指令。
- Owner：店主；總指揮／接手驗收：Claude；Maker：本次 Codex。已做本機自查，未宣稱另有獨立或跨模型驗收。
- Authority：只修改 `line-bot/` 與本結果檔；現役目錄、店機、真實 MDB、排程及程序均未操作。
- Acceptance：13 項新增測試先紅後綠，再補 3 項邊界測試；必要既有測試全綠；PowerShell 實際解析、離線 mock 與 `-DryRun -WhatIf`。
- 留痕：本檔及 `line-bot/a2b-evidence/`。依本次檔案白名單，未執行 Vault 寫入；總指揮可依本檔回存摘要。

## Diff 摘要

| 檔案 | 完成內容 |
| --- | --- |
| `line-bot/pull_shop_mdb.ps1` | SSH 讀來源 UTC mtime／大小，SCP BatchMode 下載至目的目錄唯一 `.tmp`，單次原生命令最多 60 秒；檢查 >10 MiB、Jet 標頭、版本及頁面大小對齊；再次核對來源大小／mtime，來源變動則保留現有檔。 |
| 同上 | 以獨占開檔檢查本地鎖定；備份 `backups/eHank-yyyyMMdd-HHmm.mdb` 後替換，只清理名稱符合格式的舊備份，保留最近 7 份，跳過 reparse point。保留來源 mtime，避免下載時間冒充資料時間。 |
| `line-bot/register-mdb-pull-task.ps1` | 一個目前使用者的排程，19 個每日觸發點，10:30、11:00…19:30，均落在 10:30–19:45；不補跑錯過班次、不重疊執行，不覆蓋既有同名排程。只交腳本。 |
| `line-bot/laundry_lookup.py` | 新增 `InventorySnapshot`，`Lookup` 帶 `data_as_of`／`stale`，保留既有 `inventory()` 三元組及原 connector／SELECT／解密方式。讀前後比對檔案 mtime／大小，途中替換或變動就標過期。 |
| `line-bot/conversation.py` | 只在查件組字處加尾行，按新鮮度選擇兩種指定文案；未取得時間時明示無法確認。未改綁定、路由、通知或估價邏輯。`quote_flow.py` 不需要修改。 |
| `line-bot/arrival_notify.py` | 快照傳遞資料時間，stale 時回 `STALE_HOLD`、HTTP=0、游標不動；在 baseline、事件寫入、重試與推播之前擋下。手動 rebaseline 同樣擋 stale。 |
| 測試 | 新增 `test_mdb_freshness.py`、`test_mdb_pull.ps1`、`run_a2b_tests.py`，原始輸出置於 `a2b-evidence/`。既有 arrival 假店提供自己的合成 MDB metadata；兩個明確使用 fixture 的測試保留 fixture 模式。 |

既有 `test_conversation.py` 的「趕時間」原本預期不通知，但基準實跑已會通知並顯示「需求已留給店員」。只把該測試預期改為 True，未調整這條正式邏輯。原始基準失敗保留在 `before-test_conversation.txt`。

## 時間與失敗規則

- `data_as_of`：MDB mtime 轉台北時間，例如 `2026-10-30T19:30:00+08:00`；不是下載時間。
- 日間：資料年齡 **超過** `LAUNDRY_FRESH_MINUTES` 才 stale，預設 120；剛好 120 分鐘仍新鮮。無效、負數或非有限值退回 120。
- 夜間 `[20:00, 次日10:00)`：一般年齡規則仍適用，另豁免該晚 19:00 起的副本。凌晨以**前一天** 19:00 為門檻，跨月也相同；10:00 起恢復日間規則。mtime 在未來、無法讀取或讀取途中變動，都不當成可靠的新資料。
- 新鮮尾行：`資料時間 10/30 19:30`
- 過期尾行：`以上是 10/30 19:30 的資料,最新狀態請於營業時間再確認`
- Exit 0：成功替換或 DryRun；1：本地／驗檔錯誤；2：本地檔鎖定；3：遠端 metadata／SCP 失敗、逾時或傳輸期間來源變動。
- Log：`%LOCALAPPDATA%\line-bot\mdb_pull.jsonl`，UTF-8 JSONL，含 `ts/result/bytes/source_mtime/exit`，不記憑證或客戶資料。
- 同一分鐘已有同名備份時，CreateNew 拒絕覆寫、exit 1，保留現有 MDB；稍後下一分鐘再試。

原子替換採同目錄 `.tmp`：第一次安裝使用 `Move-Item`；已存在的目的檔使用 .NET `File.Replace`，避免 PS 5.1 強制覆寫的刪除／移動空窗。使用 `NullString.Value` 傳真正的 null；允許忽略不支援的檔案 metadata 合併，不修改 ACL 設定。若舊 ACL 無法合併，新檔可能沿用同目錄暫存檔的繼承權限，部署時需以現役執行帳戶確認可讀。[Microsoft File.Replace 說明](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace?view=netframework-4.8.1)

## 驗證與原始輸出

| 驗證 | 結果 | 原始檔 |
| --- | --- | --- |
| 新功能紅燈 | 13 tests，缺欄位／尾行／HOLD，exit 1；subtest 納入後為 failures=4、errors=10 | [before-test_mdb_freshness.txt](../../line-bot/a2b-evidence/before-test_mdb_freshness.txt) |
| 新功能綠燈與補充邊界 | 16 tests，全部通過 | [after-test_mdb_freshness.txt](../../line-bot/a2b-evidence/after-test_mdb_freshness.txt) |
| `test_ehank_snapshot.py` | 4 tests，全部通過 | [after-test_ehank_snapshot.txt](../../line-bot/a2b-evidence/after-test_ehank_snapshot.txt) |
| `test_conversation.py` | PASS=60、FAIL=0、CASES=88 | [after-test_conversation.txt](../../line-bot/a2b-evidence/after-test_conversation.txt) |
| `test_arrival_notify.py` | 76 tests，全部通過 | [after-test_arrival_notify.txt](../../line-bot/a2b-evidence/after-test_arrival_notify.txt) |
| PowerShell | 73 checks，全部通過 | [powershell-offline.txt](../../line-bot/a2b-evidence/powershell-offline.txt) |

PowerShell 以 Parser 解析兩支腳本，抽取函式後 mock `ssh.exe`／`scp.exe`。真實檔案操作只用 `line-bot/.a2b-ps-test-<guid>/` 的合成檔，實驗斷線、SCP 失敗／逾時、檔頭錯誤、10 MiB 邊界、來源改變、鎖定、成功替換、首次安裝、備份原內容、保留 7 份及來源 mtime。原生程序 wrapper 另對本機自有 PowerShell 子程序測試路徑引號與 1 秒 timeout，未執行 SSH/SCP。

排程 cmdlet 全部替換為 mock，實際執行註冊腳本的組態組合並驗 19 個時刻及 IgnoreNew／Interactive；沒有註冊真排程。另實跑拉檔入口 `-DryRun -WhatIf` 與註冊入口 `-WhatIf`，在連線或寫入前返回。觸發器用每日時刻表，符合 [Microsoft New-ScheduledTaskTrigger](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger?view=windowsserver2025-ps)。

重跑指令（都只測試離線假資料）：

```powershell
$python = 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe'
& $python -B -X utf8 line-bot/run_a2b_tests.py test_mdb_freshness
& $python -B -X utf8 line-bot/run_a2b_tests.py test_ehank_snapshot
& $python -B -X utf8 line-bot/run_a2b_tests.py test_conversation
& $python -B -X utf8 line-bot/run_a2b_tests.py test_arrival_notify
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File line-bot/test_mdb_pull.ps1
```

本機兩個既有 Python 都沒有 pytest，故使用指定 Python 3.14 的 unittest／既有測試入口，沒有安裝套件。主 Python 未裝 Flask，runner 只重用既有離線 shim 函式，補可被測試取代的 server stub；不啟動伺服器。Runner 設定獨立 REPO／EHANK_ROOT、合成 fixture／token，攔截正式路徑 open/stat 與網路；價格及商家公開設定只讀 worktree 內檔案。

## 兩支腳本用法與總指揮部署步驟（以下未執行）

1. 在總指揮核定的維護時段，先比較現役版本與本 worktree 的差異。只部署下列 **5 個正式檔**，不要整目錄覆蓋，也不要把測試、證據或合成資料部署到現役。
2. 現役若另有尚未整合的變更，逐段套用本 diff；確認一致後，將現役 5 檔先備份，再套入候選。部署位置通常是 `C:\Users\cyc39\laundry-repo\line-bot`，本次未探查或寫入該目錄。

```powershell
$candidateBot = 'C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot'
$runtimeBot = 'C:\Users\cyc39\laundry-repo\line-bot'
$deployBackup = Join-Path $env:LOCALAPPDATA ('line-bot\deploy-backup-A2b-' + (Get-Date -Format yyyyMMdd-HHmmss))
$deployFiles = @('laundry_lookup.py', 'conversation.py', 'arrival_notify.py', 'pull_shop_mdb.ps1', 'register-mdb-pull-task.ps1')
New-Item -ItemType Directory -Path $deployBackup
foreach ($name in $deployFiles) {
    $existing = Join-Path $runtimeBot $name
    if (Test-Path -LiteralPath $existing) {
        Copy-Item -LiteralPath $existing -Destination (Join-Path $deployBackup $name)
    }
    Copy-Item -LiteralPath (Join-Path $candidateBot $name) -Destination $existing
    if ((Get-FileHash -LiteralPath $existing).Hash -ne (Get-FileHash -LiteralPath (Join-Path $candidateBot $name)).Hash) {
        throw ('部署檔案雜湊不符：' + $name)
    }
}
```

3. 在 **10:30–19:45**、以原本具有 `shop-pc` 金鑰／known_hosts 的使用者，先跑 metadata，再第一次手動拉檔。沒有指定 Destination／LogPath 時，使用卡片規定的預設位置。StrictHostKeyChecking=yes，不接受未知主機金鑰、不互動索取密碼。

```powershell
$runtimeBot = 'C:\Users\cyc39\laundry-repo\line-bot'
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtimeBot\pull_shop_mdb.ps1" -DryRun
if ($LASTEXITCODE -ne 0) { throw '遠端 metadata 預檢未通過，停止' }
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtimeBot\pull_shop_mdb.ps1"
if ($LASTEXITCODE -ne 0) { throw '首次拉檔未完成，請讀 log；不要註冊排程' }
Get-Content -LiteralPath "$env:LOCALAPPDATA\line-bot\mdb_pull.jsonl" -Tail 1 -Encoding UTF8
Get-Item -LiteralPath 'C:\FXwash\eHank.mdb' | Select-Object Length, LastWriteTime
Get-ChildItem -LiteralPath 'C:\FXwash\backups' -Filter 'eHank-*.mdb'
```

4. 確認 log=`REPLACED`、來源時間及備份內容後，依現役程序的維護流程重新載入三支 Python；本次沒有重啟任何程序。再以現役既有唯讀 connector 驗收副本可讀與查件尾行，勿從本機假資料通過推論實店可用。
5. 上述驗收完成才由總指揮執行下列排程預覽／註冊；本次只交腳本及 mock 結果。

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtimeBot\register-mdb-pull-task.ps1" -WhatIf
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$runtimeBot\register-mdb-pull-task.ps1"
Get-ScheduledTask -TaskName 'LineBot-PullShopMdb' | Select-Object TaskName, State, Triggers
```

`-ExecutionPolicy Bypass` 僅該 PowerShell 程序，沒有改系統或使用者 execution policy。排程採目前使用者 Interactive，不存密碼；該使用者未登入時不執行。沒有 `StartWhenAvailable`，避免錯過白天後補跑到夜間。

## 限制與交接

- Jet 大小／magic／版本／頁面對齊檢查屬結構驗檔，沒有做真實加密 MDB 的資料頁完整性掃描或 SELECT。來源前後 mtime／大小一致可擋明顯寫入，不能證明 POS 開啟中的檔案具有交易一致性；第一次現役拉檔仍要由總指揮依既有 connector 驗收。沒有變更 connector、密碼或價目。
- 現役連線、真實 MDB、任務排程執行歷史與 LINE 手機回覆均 **UNMEASURED**。本機測試通過不代表已部署或店機驗收。
- Graphify skill／ADOPTION 已讀；本 worktree／其 D 槽對應路徑沒有既有圖。因本次只允許兩處寫入且 Graphify 輸出規則指定 D 槽，未建立額外圖，改以目前原始碼核對查件／快照／通知呼叫路徑，未呼叫外部模型或派工。
- Python 3.14 初次 `mkdtemp` 的 mode=0700 在受限執行身分下造成 4 個空資料夾不可存取；runner 已改用一般 mkdir 繼承 worktree ACL，後續測試正常建立及清理。初次空目錄仍在 `line-bot/.a2b-test-tmp/`，無客戶檔案、無 MDB；受限身分無法清除，未改 ACL／提權。總指揮可在一般使用者終端核對後清理這個明確的測試目錄。Git status 會對其列 Permission denied；其餘測試暫存已清理。
- 九格缺項：第 9 格的 Vault 寫入受本次白名單限制，完整留痕改放本結果與證據；獨立 checker／現役驗收留總指揮。沒有將本機自查寫成獨立驗收。

## 原始紅綠輸出附錄

以下直接收錄證據檔內容，不手改測試輸出；其餘必要回歸測試原始輸出見上表連結。

### ?? 13 ??????????

```text
test_after_midnight_previous_evening_is_fresh (test_mdb_freshness.FreshnessTests.test_after_midnight_previous_evening_is_fresh) ... ERROR
test_arrival_snapshot_carries_metadata (test_mdb_freshness.FreshnessTests.test_arrival_snapshot_carries_metadata) ... ERROR
test_data_as_of_is_source_mtime_in_taipei (test_mdb_freshness.FreshnessTests.test_data_as_of_is_source_mtime_in_taipei) ... ERROR
test_day_at_10_ends_night_exception (test_mdb_freshness.FreshnessTests.test_day_at_10_ends_night_exception) ... ERROR
test_day_exactly_120_minutes_is_fresh (test_mdb_freshness.FreshnessTests.test_day_exactly_120_minutes_is_fresh) ... ERROR
test_day_over_120_minutes_is_stale (test_mdb_freshness.FreshnessTests.test_day_over_120_minutes_is_stale) ... ERROR
test_fresh_minutes_env_is_honored (test_mdb_freshness.FreshnessTests.test_fresh_minutes_env_is_honored) ... ERROR
test_fresh_reply_ends_with_data_time (test_mdb_freshness.FreshnessTests.test_fresh_reply_ends_with_data_time) ... FAIL
test_missing_mtime_holds_and_future_timestamp_is_stale (test_mdb_freshness.FreshnessTests.test_missing_mtime_holds_and_future_timestamp_is_stale) ... ERROR
test_night_after_19_is_fresh (test_mdb_freshness.FreshnessTests.test_night_after_19_is_fresh) ... ERROR
test_night_older_copy_is_stale (test_mdb_freshness.FreshnessTests.test_night_older_copy_is_stale) ... ERROR
test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) ... 
  test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) (mode='dry_run') ... FAIL
  test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) (mode='on') ... FAIL
test_stale_reply_ends_with_business_hours_confirmation (test_mdb_freshness.FreshnessTests.test_stale_reply_ends_with_business_hours_confirmation) ... FAIL

======================================================================
ERROR: test_after_midnight_previous_evening_is_fresh (test_mdb_freshness.FreshnessTests.test_after_midnight_previous_evening_is_fresh)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 58, in test_after_midnight_previous_evening_is_fresh
    self.assertFalse(self.row("2026-10-31T19:30:00+08:00", "2026-11-01T09:59:00+08:00").stale)
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_arrival_snapshot_carries_metadata (test_mdb_freshness.FreshnessTests.test_arrival_snapshot_carries_metadata)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 87, in test_arrival_snapshot_carries_metadata
    self.assertEqual(snap.data_as_of, row.data_as_of)
                     ^^^^^^^^^^^^^^^
AttributeError: 'Snapshot' object has no attribute 'data_as_of'

======================================================================
ERROR: test_data_as_of_is_source_mtime_in_taipei (test_mdb_freshness.FreshnessTests.test_data_as_of_is_source_mtime_in_taipei)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 39, in test_data_as_of_is_source_mtime_in_taipei
    self.assertEqual(row.data_as_of, "2026-10-30T12:00:00+08:00")
                     ^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'data_as_of'

======================================================================
ERROR: test_day_at_10_ends_night_exception (test_mdb_freshness.FreshnessTests.test_day_at_10_ends_night_exception)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 61, in test_day_at_10_ends_night_exception
    self.assertTrue(self.row("2026-10-30T19:30:00+08:00", "2026-10-31T10:00:00+08:00").stale)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_day_exactly_120_minutes_is_fresh (test_mdb_freshness.FreshnessTests.test_day_exactly_120_minutes_is_fresh)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 45, in test_day_exactly_120_minutes_is_fresh
    self.assertFalse(self.row("2026-10-30T10:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_day_over_120_minutes_is_stale (test_mdb_freshness.FreshnessTests.test_day_over_120_minutes_is_stale)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 42, in test_day_over_120_minutes_is_stale
    self.assertTrue(self.row("2026-10-30T10:00:00+08:00", "2026-10-30T12:01:00+08:00").stale)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_fresh_minutes_env_is_honored (test_mdb_freshness.FreshnessTests.test_fresh_minutes_env_is_honored)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 49, in test_fresh_minutes_env_is_honored
    self.assertTrue(self.row("2026-10-30T11:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_missing_mtime_holds_and_future_timestamp_is_stale (test_mdb_freshness.FreshnessTests.test_missing_mtime_holds_and_future_timestamp_is_stale)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 64, in test_missing_mtime_holds_and_future_timestamp_is_stale
    self.assertTrue(self.row("2026-10-30T13:00:00+08:00", "2026-10-30T12:00:00+08:00").stale)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_night_after_19_is_fresh (test_mdb_freshness.FreshnessTests.test_night_after_19_is_fresh)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 52, in test_night_after_19_is_fresh
    self.assertFalse(self.row("2026-10-30T19:00:00+08:00", "2026-10-30T23:59:00+08:00").stale)
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
ERROR: test_night_older_copy_is_stale (test_mdb_freshness.FreshnessTests.test_night_older_copy_is_stale)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 55, in test_night_older_copy_is_stale
    self.assertTrue(self.row("2026-10-30T18:59:00+08:00", "2026-10-30T23:00:00+08:00").stale)
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Lookup' object has no attribute 'stale'

======================================================================
FAIL: test_fresh_reply_ends_with_data_time (test_mdb_freshness.FreshnessTests.test_fresh_reply_ends_with_data_time)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 78, in test_fresh_reply_ends_with_data_time
    self.assertEqual(self.customer_copy(False).splitlines()[-1], "資料時間 10/30 12:00")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '金額先供您查閱，最後仍以門市實際結帳為準。' != '資料時間 10/30 12:00'
- 金額先供您查閱，最後仍以門市實際結帳為準。
+ 資料時間 10/30 12:00


======================================================================
FAIL: test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) (mode='dry_run')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 100, in test_stale_arrival_holds_before_baseline_or_send_in_both_modes
    self.assertEqual(result["code"], "STALE_HOLD")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: <MagicMock name='_dispatch().__getitem__()' id='2195816384896'> != 'STALE_HOLD'

======================================================================
FAIL: test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) (mode='on')
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 100, in test_stale_arrival_holds_before_baseline_or_send_in_both_modes
    self.assertEqual(result["code"], "STALE_HOLD")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: <MagicMock name='_dispatch().__getitem__()' id='2195816391952'> != 'STALE_HOLD'

======================================================================
FAIL: test_stale_reply_ends_with_business_hours_confirmation (test_mdb_freshness.FreshnessTests.test_stale_reply_ends_with_business_hours_confirmation)
----------------------------------------------------------------------
Traceback (most recent call last):
  File "C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\test_mdb_freshness.py", line 81, in test_stale_reply_ends_with_business_hours_confirmation
    self.assertEqual(self.customer_copy(True).splitlines()[-1], "以上是 10/30 12:00 的資料,最新狀態請於營業時間再確認")
    ~~~~~~~~~~~~~~~~^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: '金額先供您查閱，最後仍以門市實際結帳為準。' != '以上是 10/30 12:00 的資料,最新狀態請於營業時間再確認'
- 金額先供您查閱，最後仍以門市實際結帳為準。
+ 以上是 10/30 12:00 的資料,最新狀態請於營業時間再確認


----------------------------------------------------------------------
Ran 13 tests in 0.099s

FAILED (failures=4, errors=10)
```

### 16 ????? 3 ??????

```text
test_after_midnight_previous_evening_is_fresh (test_mdb_freshness.FreshnessTests.test_after_midnight_previous_evening_is_fresh) ... ok
test_arrival_snapshot_carries_metadata (test_mdb_freshness.FreshnessTests.test_arrival_snapshot_carries_metadata) ... ok
test_data_as_of_is_source_mtime_in_taipei (test_mdb_freshness.FreshnessTests.test_data_as_of_is_source_mtime_in_taipei) ... ok
test_day_at_10_ends_night_exception (test_mdb_freshness.FreshnessTests.test_day_at_10_ends_night_exception) ... ok
test_day_exactly_120_minutes_is_fresh (test_mdb_freshness.FreshnessTests.test_day_exactly_120_minutes_is_fresh) ... ok
test_day_over_120_minutes_is_stale (test_mdb_freshness.FreshnessTests.test_day_over_120_minutes_is_stale) ... ok
test_fresh_minutes_env_is_honored (test_mdb_freshness.FreshnessTests.test_fresh_minutes_env_is_honored) ... ok
test_fresh_reply_ends_with_data_time (test_mdb_freshness.FreshnessTests.test_fresh_reply_ends_with_data_time) ... ok
test_invalid_fresh_minutes_falls_back_to_120 (test_mdb_freshness.FreshnessTests.test_invalid_fresh_minutes_falls_back_to_120) ... ok
test_mdb_changed_during_read_is_held (test_mdb_freshness.FreshnessTests.test_mdb_changed_during_read_is_held) ... ok
test_missing_mtime_holds_and_future_timestamp_is_stale (test_mdb_freshness.FreshnessTests.test_missing_mtime_holds_and_future_timestamp_is_stale) ... ok
test_night_after_19_is_fresh (test_mdb_freshness.FreshnessTests.test_night_after_19_is_fresh) ... ok
test_night_older_copy_is_stale (test_mdb_freshness.FreshnessTests.test_night_older_copy_is_stale) ... ok
test_rebaseline_stale_snapshot_does_not_write_state (test_mdb_freshness.FreshnessTests.test_rebaseline_stale_snapshot_does_not_write_state) ... ok
test_stale_arrival_holds_before_baseline_or_send_in_both_modes (test_mdb_freshness.FreshnessTests.test_stale_arrival_holds_before_baseline_or_send_in_both_modes) ... ok
test_stale_reply_ends_with_business_hours_confirmation (test_mdb_freshness.FreshnessTests.test_stale_reply_ends_with_business_hours_confirmation) ... ok

----------------------------------------------------------------------
Ran 16 tests in 0.054s

OK
```

### PowerShell ????

```text
PASS parse pull_shop_mdb.ps1

PASS parse register-mdb-pull-task.ps1

PASS unreachable exit 3

PASS unreachable structured log

PASS unreachable temp cleanup

PASS unreachable original unchanged

PASS unreachable no backup mutation

PASS unreachable batch/timeout arguments

PASS scp-fail exit 3

PASS scp-fail structured log

PASS scp-fail temp cleanup

PASS scp-fail original unchanged

PASS scp-fail no backup mutation

PASS scp-fail batch/timeout arguments

PASS scp-fail batch/timeout arguments

PASS timeout exit 3

PASS timeout structured log

PASS timeout temp cleanup

PASS timeout original unchanged

PASS timeout no backup mutation

PASS timeout batch/timeout arguments

PASS timeout batch/timeout arguments

PASS invalid exit 1

PASS invalid structured log

PASS invalid temp cleanup

PASS invalid original unchanged

PASS invalid no backup mutation

PASS invalid batch/timeout arguments

PASS invalid batch/timeout arguments

PASS small exit 1

PASS small structured log

PASS small temp cleanup

PASS small original unchanged

PASS small no backup mutation

PASS small batch/timeout arguments

PASS small batch/timeout arguments

PASS changed exit 3

PASS changed structured log

PASS changed temp cleanup

PASS changed original unchanged

PASS changed no backup mutation

PASS changed batch/timeout arguments

PASS changed batch/timeout arguments

PASS changed batch/timeout arguments

PASS locked exit 2

PASS locked structured log

PASS locked temp cleanup

PASS locked original unchanged

PASS locked no backup mutation

PASS locked batch/timeout arguments

PASS locked batch/timeout arguments

PASS locked batch/timeout arguments

PASS good exit 0

PASS good structured log

PASS good temp cleanup

PASS replacement installed

PASS source mtime preserved

PASS retain latest 7 backups

PASS backup is prior original

PASS unrelated backup directory file preserved

PASS good batch/timeout arguments

PASS good batch/timeout arguments

PASS good batch/timeout arguments

PASS DryRun metadata only, no scp

PASS DryRun no destination directory or file

PASS DryRun log metadata

PASS first install via same-directory Move-Item

PASS mock schedule 19 daily triggers within window

PASS mock schedule current-user and no overlapping runs

PASS real native wrapper quoting

PASS real native wrapper timeout kills only owned child

What if: Performing the operation "Read remote MDB metadata only" on target "shop-pc -> C:\Users\cyc39\AI-Lanes\a2b\repo\line-bot\.a2b-ps-test-8cd8bb326b87416ab73b187c813729b7\not-created\eHank.mdb".

PASS DryRun WhatIf no writes or connection

What if: Performing the operation "Register daily 10:30-19:30 MDB pull, every 30 minutes" on target "LineBot-PullShopMdb".

PASS registration WhatIf returned without scheduler operation

RESULT PASS=73 FAIL=0
```
