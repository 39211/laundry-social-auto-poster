# A3-2 店機部署與回退

本文件供 Claude 總指揮安排維護時使用；本輪 Codex **未連店機、未呼叫 API、未停起正式服務、未 commit**。本機通知測試 26/26 通過；既有套件回歸 27/29，原始 HEAD 也有相同兩項缺件失敗，詳 A3-2-RESULT.md。**本卡整體驗收尚未全通過，不以這份操作文件視為部署放行。**

## 1. 四檔交付與部署前核對

正式根目錄 `C:\LaundryStores\fxwash`；店機 Python `C:\LaundryStores\python-portable\python.exe`（3.11 embedded、只用標準庫）。由總指揮在 10:00–20:00 安排維護，先確認既有缺件、Python 版本、來源 SHA-256、啟動來源與可回退備份。

| 交付檔（repo 相對路徑） | 用途／店機位置 |
| --- | --- |
| `shop-pc/fxwash/runtime/inbound_monitor.py` | 正式程式：`runtime\inbound_monitor.py` |
| `shop-pc/fxwash/runtime/test_inbound_monitor.py` | 離線測試：`runtime\test_inbound_monitor.py` |
| `shop-pc/DEPLOY-A3-2.md` | 操作文件，留交付暫存區 |
| `docs-internal/cards/A3-2-RESULT.md` | 差異、紅綠／變異原始輸出與程式 SHA-256，留交付暫存區 |

四檔交付，只有兩個 Python 檔進正式 runtime。不要整樹覆蓋，不帶本機測試暫存目錄；不更動 lookup、webhook、文案、shop.json、secrets、綁定或 MDB。狀態及 outbox 是正式通知資料，備份只留店機受限目錄，不貼 uid、完整訊息或檔案內容到 Vault／交接。

將四檔依上述 repo 結構放進 `C:\LaundryStores\A3-2-staging`，逐一核對交付版本；只核對兩個 Python 的 SHA 就不足以替代讀完本次 RESULT 的未通過項。

~~~powershell
$ErrorActionPreference = 'Stop'
$a32Now = Get-Date
if ($a32Now.Hour -lt 10 -or $a32Now.Hour -ge 20) { throw '不在 10:00–20:00 維護時段' }
$a32Root = 'C:\LaundryStores\fxwash'
$a32Python = 'C:\LaundryStores\python-portable\python.exe'
$a32Stage = 'C:\LaundryStores\A3-2-staging'
$a32Files = @('runtime\inbound_monitor.py', 'runtime\test_inbound_monitor.py')
& $a32Python -I -S -B -c 'import sys; assert sys.version_info[:2] == (3, 11); print(sys.version)'
if ($LASTEXITCODE -ne 0) { throw 'Python 版本不符' }
foreach ($a32Rel in $a32Files) {
    Get-FileHash -LiteralPath (Join-Path (Join-Path $a32Stage 'shop-pc\fxwash') $a32Rel) -Algorithm SHA256
}
~~~

## 2. 停止自動拉起來源，再精確停 monitor

本機 watchdog 快照會自動拉起 inbound_monitor；實際排程名稱未知，必須在現場核對 TaskPath、TaskName、Actions、原啟用狀態及手動入口。下面只列出候選，不自動停用整組門市服務：

~~~powershell
Get-ScheduledTask | Where-Object {
    (($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' ') -match [regex]::Escape($a32Root)
} | Select-Object TaskPath, TaskName, State, Actions | Format-List
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
        $_.CommandLine.Contains((Join-Path $a32Root 'watchdog.py')) -or
        $_.CommandLine.Contains((Join-Path $a32Root 'runtime\inbound_monitor.py'))
    )
} | Select-Object ProcessId, ExecutablePath, CommandLine, CreationDate
~~~

核對會拉起 monitor 的精確排程／現場啟動器，記下啟用狀態並暫停它們；不要修改排程動作。先停止本店仍在執行的 watchdog，再停止本店 inbound_monitor。webhook、tunnel、SSH、POS 及其他 Agent 不在停機範圍。

每個待停 PID 都須核對 ExecutablePath 為本店 portable Python、CommandLine 含本店完整腳本路徑，並保存 CreationDate；停止前再次讀取，比對三者未變，才 `Stop-Process -Id <已核對的 PID>`。不得依映像名稱批次終止。若命令列只有相對路徑或找不到啟動來源，先定位，不能猜 PID。停妥後再核對沒有 monitor／本店 watchdog 殘留。

## 3. 停妥後備份程式與通知資料

備份狀態與 outbox 必須在 monitor 停止後，確保是同一停機點。不刪除或重建狀態，不以空狀態啟動來消除錯誤。

~~~powershell
$a32Backup = Join-Path $a32Root ('backups\A3-2-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $a32Backup | Out-Null
$a32Protected = $a32Files + @('data\monitor_state.json', 'data\notify_outbox.jsonl')
$a32Before = foreach ($a32Rel in $a32Protected) {
    $a32Target = Join-Path $a32Root $a32Rel
    $a32Copy = Join-Path $a32Backup $a32Rel
    $a32Exists = Test-Path -LiteralPath $a32Target -PathType Leaf
    $a32Hash = $null
    if ($a32Exists) {
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($a32Copy)) -Force | Out-Null
        Copy-Item -LiteralPath $a32Target -Destination $a32Copy
        $a32Hash = (Get-FileHash -LiteralPath $a32Target -Algorithm SHA256).Hash
        if ($a32Hash -ne (Get-FileHash -LiteralPath $a32Copy -Algorithm SHA256).Hash) {
            throw "備份雜湊不符：$a32Rel"
        }
    }
    [pscustomobject]@{ Relative = $a32Rel; Existed = $a32Exists; SHA256 = $a32Hash }
}
$a32Before | Export-Clixml -LiteralPath (Join-Path $a32Backup 'files-before.xml')
$a32ShopHash = (Get-FileHash -LiteralPath (Join-Path $a32Root 'shop.json') -Algorithm SHA256).Hash
$a32ShopHash | Set-Content -LiteralPath (Join-Path $a32Backup 'shop-json-before.sha256') -Encoding ASCII
~~~

另把第 2 節核對過的排程名稱及原啟用狀態存入同一備份目錄；不匯出密碼或憑證。若 monitor_state.json 已存在但不是有效 JSON，先保持停機並處理；不要趁部署建立新基線掩蓋它。

## 4. 替換兩個 runtime 檔，離線驗證

~~~powershell
foreach ($a32Rel in $a32Files) {
    $a32Source = Join-Path (Join-Path $a32Stage 'shop-pc\fxwash') $a32Rel
    $a32Target = Join-Path $a32Root $a32Rel
    Copy-Item -LiteralPath $a32Source -Destination $a32Target
    if ((Get-FileHash -LiteralPath $a32Source -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $a32Target -Algorithm SHA256).Hash) {
        throw "部署雜湊不符：$a32Rel"
    }
}
Push-Location -LiteralPath $a32Root
try {
    & $a32Python -I -S -B -m unittest discover -s runtime -p test_inbound_monitor.py
    if ($LASTEXITCODE -ne 0) { throw '26 條離線測試未全通過；不啟動 monitor' }
} finally { Pop-Location }
if ($a32ShopHash -ne (Get-FileHash -LiteralPath (Join-Path $a32Root 'shop.json') -Algorithm SHA256).Hash) {
    throw 'shop.json 有非預期變更'
}
~~~

測試使用自己的臨時目錄、記憶體 SQLite、假 run_query／push_message／token；不讀正式 channel secrets，不查 MDB，不啟動其他服務、不發通知。不要改跑未隔離的 test_guiding_dialog.py：它有讀 Gemini 金鑰並呼叫 API 的入口。本機既有回歸用的隔離方式及兩項失敗見 RESULT，不把它說成全綠。

## 5. 啟動、回讀與新狀態規則

以下啟動會恢復正式通知，並可能重送已有的 pending；只能由總指揮在本次部署放行後操作，不能用它做發送測試。維持拉起觸發器停用，先手動啟動唯一一個 monitor：

~~~powershell
$a32RunStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$a32Stdout = Join-Path $a32Root ("logs\inbound-monitor-A3-2-$a32RunStamp.stdout.log")
$a32Stderr = Join-Path $a32Root ("logs\inbound-monitor-A3-2-$a32RunStamp.stderr.log")
$a32Monitor = Start-Process -FilePath $a32Python -ArgumentList @(
    '-B', '-u', ('"{0}"' -f (Join-Path $a32Root 'runtime\inbound_monitor.py'))
) -WorkingDirectory $a32Root -WindowStyle Hidden -PassThru -RedirectStandardOutput $a32Stdout -RedirectStandardError $a32Stderr
Start-Sleep -Seconds 12
Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $a32Monitor.Id) |
    Select-Object ProcessId, ExecutablePath, CommandLine, CreationDate
Get-Content -LiteralPath $a32Stderr -Encoding UTF8 -Tail 30
~~~

核對唯一 PID、無 STATE_CORRUPT／OUTBOX_CORRUPT／MONITOR_STOPPED、狀態可解析，再核對通知資料。只在店機輸出計數，正式檔案內容不外傳：

~~~powershell
Push-Location -LiteralPath $a32Root
try {
    @'
import collections, json
from pathlib import Path
p = Path("data/monitor_state.json")
if p.exists():
    s = json.loads(p.read_text(encoding="utf-8-sig"))
    print("baseline_initialized:", s.get("baseline_initialized"))
    print("completed_keys:", len(s.get("completed_keys", [])))
else:
    print("STATE_NOT_CREATED: baseline may still be waiting")
latest = {}
q = Path("data/notify_outbox.jsonl")
if q.exists():
    for line in q.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        latest[(r["kind"], r["dno"], r["did"], r["uid"])] = r
print("outbox_status_counts:", dict(collections.Counter(r["status"] for r in latest.values())))
'@ | & $a32Python -I -S -B -
    if ($LASTEXITCODE -ne 0) { throw '狀態／outbox 讀回失敗；停止 monitor 並保全資料' }
} finally { Pop-Location }
~~~

- 新 state 用 completed_keys 的 (Dno, Did)，並保存 baseline_initialized；空資料庫的成功基線及空完工集合都有效，不能據此重抓歷史基線。
- 舊 completed_dnos 首次成功掃描時，只把同件號且 Did 不高於舊 last_did 的當前可取件轉入新鍵；舊檔沒有歷史 Did，無法重建每筆歷史身份。新 Did 重用舊 Dno 仍會通知。
- 每事件／收件人記錄初送 intent、pending、done 或 abandoned，附原 uid 與文字快照。attempts 指「重送次數」：初送失敗為 0，再等 6 秒、30 秒、2 分鐘、10 分鐘、1 小時，各重送一次，最多五次；第 5 次重送仍失敗才 abandoned。停機時間及輪詢／查詢耗時可延後實際發送。
- done 表示 push_message 回傳 True，不能據此認定客戶手機送達／已讀。逾時或外部已接受、但成功回條尚未落盤就中斷，仍可能重複；本卡沒有外部冪等回條。
- STATE_CORRUPT 會保留原檔及 monitor_state.json.corrupt-時間戳副本，停止推播；保持原檔避免 watchdog 重啟後誤建基線。不能刪檔重試。毀損 outbox 同樣停止，不能丟掉待送資料。
- 連續 MDB 查詢失敗每 10 輪才記一行 MDB_QUERY_FAILED；該輪不消耗 mtime。無 MDB 變動／讀取失敗仍先處理到期 outbox。

完成本機回讀才恢復「原本啟用」的精確觸發器，原本停用的保持停用；再核對沒有第二個 monitor。程序存活、狀態更新與顧客實際收訊是不同證據，現場驗收需另外記錄，不能由本輪離線結果推定。

## 6. 回退

1. 依第 2 節再次暫停原拉起來源，核對 PID／命令列／建立時間後停 monitor。先把此刻 runtime 兩檔、state、outbox、.tmp、.corrupt-* 及本次兩份 log 保全到本店備份子目錄，逐檔 SHA 讀回，不清空 outbox。
2. **啟動後只要 outbox 有新增／改變，或仍有 pending，禁止直接恢復舊 state 再啟動舊程式。** 新程式可能已發送，舊程式又不懂 outbox／completed_keys；這樣會丟待送或重發。保持 monitor 停止，交總指揮依事件與收件人的最新回條調和，保留現況證據。
3. 只有確認啟動期間沒有通知嘗試、outbox 與備份逐位元相同且沒有 pending，才可把 files-before.xml 列為 Existed=True 的原程式及原 state／outbox，從同一停機點備份複製回原位置，逐檔比對原 SHA。原本不存在的檔不以空內容冒充舊檔；若新建 outbox 有任何內容，回到上一步人工調和。原本不存在的測試檔可留作離線交付，不會被 monitor 載入。
4. JSON、原檔 SHA 及 shop.json hash 都核對成功後，用第 5 節的隱藏啟動方式啟動已還原程式，核對唯一 PID，再恢復原啟用觸發器。若無法證明第 3 步條件，停在保全狀態，不自動起舊版。

回退不重建 customer_bindings，不改 MDB、不改對客文案，不以發測試 LINE 判定回退成功。本輪未實際演練店機部署或回退。
