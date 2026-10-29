# A4-2 店機部署與回退

本文件交給總指揮在店機執行。Codex 這一輪只修改本機快照，未連線店機、未呼叫正式 LINE API、未停止或啟動正式服務。**只在 10:00–20:00、總指揮安排好的維護時間內操作。**

## 1. 檔案與部署前條件

正式根目錄為 `C:\LaundryStores\fxwash`，Python 為 `C:\LaundryStores\python-portable\python.exe`（Python 3.11 embedded，標準庫即可）。不裝套件、不覆蓋整個資料夾。

只從本次已核對 SHA-256 的交付複製下列四個檔案；前兩個是正式程式，後兩個是完全離線的驗收測試：

| 來源（repo） | 店機相對位置 |
| --- | --- |
| `shop-pc/fxwash/runtime/webhook_server.py` | `runtime\webhook_server.py` |
| `shop-pc/fxwash/runtime/tunnel_supervisor.py` | `runtime\tunnel_supervisor.py` |
| `shop-pc/fxwash/runtime/test_tunnel_events.py` | `runtime\test_tunnel_events.py` |
| `shop-pc/fxwash/runtime/test_webhook_log_ts.py` | `runtime\test_webhook_log_ts.py` |

檔案雜湊與本機驗收在 `docs-internal/cards/A4-2-RESULT.md`。不要部署 RESULT、此文件、本機 logs、測試暫存目錄或其他同時在工作的 dirty 檔。不要複製／讀取 secrets，不改 `shop.json`、通知／對話模組、排程動作或 AI 電腦的隧道設定。

先把這四個交付檔依相同 `runtime\` 結構放在店機獨立暫存資料夾 `C:\LaundryStores\A4-2-staging`；這一步由總指揮安排傳輸，本文件沒有執行傳輸。

在店機 PowerShell 設定本次操作範圍並檢查時間：

```powershell
$ErrorActionPreference = 'Stop'
$a42Now = Get-Date
if ($a42Now.Hour -lt 10 -or $a42Now.Hour -ge 20) { throw '不在 10:00–20:00 維護時段' }
$a42Root = 'C:\LaundryStores\fxwash'
$a42Python = 'C:\LaundryStores\python-portable\python.exe'
$a42Stage = 'C:\LaundryStores\A4-2-staging'
$a42Files = @(
    'runtime\webhook_server.py',
    'runtime\tunnel_supervisor.py',
    'runtime\test_tunnel_events.py',
    'runtime\test_webhook_log_ts.py'
)
if (-not (Test-Path -LiteralPath $a42Python -PathType Leaf)) { throw '找不到店機 Python' }
& $a42Python -B -c 'import sys; assert sys.version_info[:2] == (3, 11); print(sys.version)'
if ($LASTEXITCODE -ne 0) { throw 'Python 版本不符' }
foreach ($a42Rel in $a42Files) {
    $a42Source = Join-Path $a42Stage $a42Rel
    if (-not (Test-Path -LiteralPath $a42Source -PathType Leaf)) { throw "交付缺檔：$a42Rel" }
    Get-FileHash -LiteralPath $a42Source -Algorithm SHA256
}
```

逐一核對 RESULT 雜湊，再繼續。所有後續複製都只在這四個相對位置內。

## 2. 備份並暫停會拉起服務的工作

快照中的 `watchdog.py` 是一次檢查型程式；`run_services.bat`、`run_watchdog_silent.vbs` 等入口會啟動它。**正式排程名稱無法從快照確定，必須在店機核對，不能假設名稱。** 先列出動作提到此根目錄的排程，再核對其中哪些會啟動 watchdog、webhook 或 supervisor；也要確認是否有用相對路徑啟動的排程或現場手動啟動器。不要停通知 monitor 或其他門市服務。

```powershell
$a42Backup = Join-Path $a42Root ('backups\A4-2-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path (Join-Path $a42Backup 'runtime') | Out-Null
$a42ShopHash = (Get-FileHash -LiteralPath (Join-Path $a42Root 'shop.json') -Algorithm SHA256).Hash
$a42Before = foreach ($a42Rel in $a42Files) {
    $a42Target = Join-Path $a42Root $a42Rel
    $a42Exists = Test-Path -LiteralPath $a42Target -PathType Leaf
    if ($a42Exists) {
        Copy-Item -LiteralPath $a42Target -Destination (Join-Path $a42Backup $a42Rel)
        $a42Hash = (Get-FileHash -LiteralPath $a42Target -Algorithm SHA256).Hash
        if ($a42Hash -ne (Get-FileHash -LiteralPath (Join-Path $a42Backup $a42Rel) -Algorithm SHA256).Hash) {
            throw "備份雜湊不符：$a42Rel"
        }
    } else { $a42Hash = $null }
    [pscustomobject]@{ Relative = $a42Rel; Existed = $a42Exists; SHA256 = $a42Hash }
}
$a42Before | Export-Clixml -LiteralPath (Join-Path $a42Backup 'files-before.xml')
$a42ShopHash | Set-Content -LiteralPath (Join-Path $a42Backup 'shop-json-before.sha256') -Encoding ASCII
Get-ScheduledTask | Where-Object {
    (($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' ') -match [regex]::Escape($a42Root)
} | Select-Object TaskPath, TaskName, State, Actions | Format-List
```

把核對過的精確 TaskPath／TaskName 填入下面清單；若確認原本是手動啟動、沒有相關排程，可保留空陣列。未確定啟動來源時先不要停服務。只備份名稱及啟用狀態，不匯出憑證或任務密碼：

```powershell
$a42TaskIds = @(
    # [pscustomobject]@{ TaskPath = '\'; TaskName = '填入現場核對的工作名稱' }
)
$a42TasksBefore = @(foreach ($a42Id in $a42TaskIds) {
    $a42Task = Get-ScheduledTask -TaskPath $a42Id.TaskPath -TaskName $a42Id.TaskName
    [pscustomobject]@{ TaskPath = $a42Task.TaskPath; TaskName = $a42Task.TaskName; Enabled = $a42Task.Settings.Enabled }
})
$a42TasksBefore | Export-Clixml -LiteralPath (Join-Path $a42Backup 'tasks-before.xml')
foreach ($a42Task in $a42TasksBefore) {
    if ($a42Task.Enabled) { Disable-ScheduledTask -TaskPath $a42Task.TaskPath -TaskName $a42Task.TaskName | Out-Null }
}
```

停用觸發器後，以 `Get-CimInstance Win32_Process` 核對以下程序的 **PID、ExecutablePath、CommandLine、CreationDate**，並先停止本店仍在執行的 watchdog。再停本店 supervisor 及它的 SSH 子程序，最後停 webhook：

- Python 程式只限完整路徑 `C:\LaundryStores\fxwash\watchdog.py`、`C:\LaundryStores\fxwash\runtime\tunnel_supervisor.py`、`C:\LaundryStores\fxwash\runtime\webhook_server.py`，執行器應是本店 portable Python。
- SSH 子程序必須先由 supervisor 的 PID 找到 ParentProcessId，並核對命令列含 `-R 80:127.0.0.1:18791` 與 `nokey@localhost.run`；保留該 PID、建立時間及完整命令列供停止前再比對。
- 對每個已核對的 PID，停止前再讀一次 CIM，確認沒有 PID 重用，才 `Stop-Process -Id <該 PID>`。不能用 `Stop-Process -Name python/ssh`、`taskkill /IM` 或終止其他 Agent。
- `inbound_monitor.py` 不在本次停機清單；不啟動它來做驗證，也不發測試通知。

停妥後，確認 18791 已無本次 webhook listener，也沒有剩下的本店 supervisor／SSH 或會自動拉起它們的 watchdog。若有未辨識的 listener，先定位，不終止不明程序。

## 3. 部署四檔、離線驗收

```powershell
foreach ($a42Rel in $a42Files) {
    $a42Source = Join-Path $a42Stage $a42Rel
    $a42Target = Join-Path $a42Root $a42Rel
    Copy-Item -LiteralPath $a42Source -Destination $a42Target
    if ((Get-FileHash -LiteralPath $a42Source -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $a42Target -Algorithm SHA256).Hash) { throw "部署雜湊不符：$a42Rel" }
}
if ($a42ShopHash -ne (Get-FileHash -LiteralPath (Join-Path $a42Root 'shop.json') -Algorithm SHA256).Hash) {
    throw '拷檔階段 shop.json 有非預期變更'
}
Push-Location -LiteralPath $a42Root
try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    & $a42Python -m unittest discover -s runtime -p 'test_*.py'
    if ($LASTEXITCODE -ne 0) { throw '離線測試失敗，先回退，不啟動正式服務' }
    & $a42Python -B -c "import runtime.webhook_server; print('A4-2 import OK; server not started')"
    if ($LASTEXITCODE -ne 0) { throw '模組載入失敗，先回退' }
} finally { Pop-Location }
```

預期 18 條 unittest 全綠；它們只用假 urlopen／假程序，不讀取真正的 channel secrets、不啟動 server、不發 LINE 訊息。import 指令只測載入，會在本店 log 留下一筆帶本地時間的人工驗收字串。

## 4. 啟動與實際回讀

先啟動 webhook，再啟動 supervisor；保留傳回的 PID，後續如需回退只操作核對過的這些本店程序。`Start-Process` 使用隱藏視窗：

```powershell
$a42Webhook = Start-Process -FilePath $a42Python -ArgumentList @(
    '-u', ('"{0}"' -f (Join-Path $a42Root 'runtime\webhook_server.py')), '18791'
) -WorkingDirectory $a42Root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $a42Webhook.Id) |
    Select-Object ProcessId, ExecutablePath, CommandLine, CreationDate
Get-NetTCPConnection -LocalPort 18791 -State Listen |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

確認 listener 屬於剛啟動的 webhook PID，且 log 沒有啟動錯誤，再執行：

```powershell
$a42Tunnel = Start-Process -FilePath $a42Python -ArgumentList @(
    '-u', ('"{0}"' -f (Join-Path $a42Root 'runtime\tunnel_supervisor.py')), '18791'
) -WorkingDirectory $a42Root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5
Get-Content -LiteralPath (Join-Path $a42Root 'logs\tunnel_events.jsonl') -Encoding UTF8 -Tail 20 |
    ForEach-Object { $_ | ConvertFrom-Json } |
    Select-Object ts, event, old_url, new_url, put_status, verify_status, attempt, rc, alive_seconds
```

啟動 supervisor 會恢復它原有的 LINE 註冊與測試流程，屬於總指揮此次正式部署操作。以下必須看 **本次啟動時間之後**、同一個 new_url 的紀錄，不能用舊 log 或只有「程序存在」當成功：

1. `url_detected` 的 ts 有本地 UTC offset，old_url／new_url 可追溯。每次新 supervisor 啟動時 old_url 為空，表示此程序尚未觀察到前一個網址；不是 LINE 先前端點為空。
2. 同一 attempt 有 `put_start` → `put_result`，後者有 HTTP 回應碼（正常為 200）。
3. 接著 `verify_result.verify_status = match`，表示 GET 回讀的 endpoint 等於 new_url。`pending`、只有 PUT 200、`mismatch`、`error` 或 `not_run` 都不能當驗證成功。
4. 不一致時最多首次加三次 PUT，重試間隔 2／5／10 秒；HTTP／網路錯誤也使用相同有限預算。網路 timeout 可能讓整輪超過 17 秒；不要在等待中重複啟動 supervisor。
5. `logs\webhook_server.log` 本次新增的 stdout／stderr 每行應以 `YYYY-MM-DD HH:MM:SS ` 開頭；LINE 原有的空事件 webhook 測試也應出現帶時間的存取紀錄。舊行不回填時間戳。不要複製含客人訊息的整段 log 到交卷或外部服務。
6. 子程序自然退出後，`tunnel_exit` 應含實際 rc、以 monotonic 計算的 `alive_seconds`。本輪若沒有自然退出就記「店機退出事件尚未觀測」，不要刻意中斷營業隧道來補這個證據。作業系統直接強制終止 supervisor 本身時，Python 無法保證執行 finally。

supervisor 原本就會把觀察到的網址寫回 `shop.json.server`；本卡保留這項既有行為。因此啟動後不能要求 shop.json 的整檔雜湊維持不變，也不要回填備份中的過期網址。

確認本次 URL match、webhook listener 與新 log 格式都正確後，把原本啟用的觸發器恢復；原本停用的保持停用：

```powershell
foreach ($a42Task in (Import-Clixml -LiteralPath (Join-Path $a42Backup 'tasks-before.xml'))) {
    if ($a42Task.Enabled) { Enable-ScheduledTask -TaskPath $a42Task.TaskPath -TaskName $a42Task.TaskName | Out-Null }
}
```

核對排程回讀狀態、服務沒有重複，再交卷。端點 match 只證明登記的 URL 相符，不證明客人訊息零遺失、LINE webhook 已啟用或手機旅程已驗收；本卡沒有新增客人訊息／通知實測授權。

## 5. 回退

以下任何一項發生就不要宣告成功：店機 3.11 測試失敗、模組載入失敗、新檔 hash 不符、服務啟動失敗、整輪結束仍沒有 match、或 `tunnel_events.jsonl` 無法寫入。先保留本次事件與錯誤摘要，不擷取 credentials／客資。

1. 依第 2 節再次暫停已核對的觸發器，核對 PID／命令列／建立時間後停止這次 webhook、supervisor、其 SSH 子程序與會拉起它們的 watchdog。
2. 從本次 `$a42Backup` 的 `files-before.xml` 逐檔回復：`Existed = true` 才以備份覆蓋原檔，並與原 SHA-256 比對；`Existed = false` 只移除本次新增的那個測試檔（精確 LiteralPath、非遞迴，且先核對它仍是本次部署的 hash）。不要刪目錄、logs、data 或 secrets，也不要用舊備份覆蓋之後別人改過的檔案。
3. 保留 `logs\tunnel_events.jsonl` 供追查，不恢復過期的 shop.json 網址。不要啟動另一台電腦的隧道搶正式端點。
4. 依第 4 節只重啟原版 webhook 與 supervisor，確認 listener、程序與舊版註冊流程恢復，再按 `tasks-before.xml` 還原觸發器的原啟用狀態。舊版沒有 GET 驗證事件，不能把它當成 A4-2 驗收成功。
5. 回報已部署／已回退的四檔 hash、備份路徑、時間、被操作的精確 PID／排程、離線測試結果與實際 log 證據。真正的 3.11 執行、正式 API 回讀、自然退出及手機旅程各自列出已驗／未驗。
