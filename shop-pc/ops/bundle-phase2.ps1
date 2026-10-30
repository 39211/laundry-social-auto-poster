# bundle-phase2.ps1 - generic version of the proven a42-phase2.ps1.
# Re-enable the tasks that were enabled, let FXwash-Watchdog start the new services, then read back evidence.
# Prints PASS/FAIL per check; exit 0 only when all pass. Never prints uid, message text or data-file content.
# Commander-written 10/30; ASCII only, PS 5.1.
param(
  [Parameter(Mandatory = $true)][ValidateSet('A3-2', 'A4-4', 'B1-2', 'B2')][string]$Bundle,
  [Parameter(Mandatory = $true)][string]$Backup,
  [int]$WaitSeconds = 60
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Find-Proc($pattern) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }) }
$root = 'C:\LaundryStores\fxwash'
$py = 'C:\LaundryStores\python-portable\python.exe'
$svcRx = @{
  'webhook_server'    = 'LaundryStores\\fxwash\\runtime\\webhook_server\.py'
  'tunnel_supervisor' = 'LaundryStores\\fxwash\\runtime\\tunnel_supervisor\.py'
  'inbound_monitor'   = 'LaundryStores\\fxwash\\runtime\\inbound_monitor\.py'
}
$stopOf = @{ 'A3-2' = 'inbound_monitor'; 'A4-4' = 'tunnel_supervisor'; 'B1-2' = 'webhook_server'; 'B2' = 'webhook_server' }
$script:fails = 0
function Check([string]$name, [bool]$ok, [string]$detail) {
  if ($ok) { Say "PASS $name $detail" } else { $script:fails++; Say "FAIL $name $detail" }
}

$t0 = Get-Date
foreach ($t in (Import-Clixml -LiteralPath (Join-Path $Backup 'tasks-before.xml'))) {
  if ($t.Enabled) { Enable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "re-enabled $($t.TaskName)" }
}
Start-ScheduledTask -TaskName 'FXwash-Watchdog'
Say 'kicked FXwash-Watchdog'

# every service exactly once; the restarted one must be new (created after t0)
$deadline = (Get-Date).AddSeconds(40)
do {
  Start-Sleep -Seconds 4
  $counts = @{}; foreach ($s in $svcRx.Keys) { $counts[$s] = @(Find-Proc $svcRx[$s]).Count }
  $mine = @(Find-Proc $svcRx[$stopOf[$Bundle]])
  $fresh = ($mine.Count -eq 1) -and ($mine[0].CreationDate -ge $t0.AddSeconds(-2))
} until (($fresh -and @($counts.Values | Where-Object { $_ -ne 1 }).Count -eq 0) -or (Get-Date) -gt $deadline)
foreach ($s in $svcRx.Keys) { Check "process_single $s" ($counts[$s] -eq 1) "count=$($counts[$s])" }
foreach ($p in $mine) { Check "restarted $($stopOf[$Bundle])" ($p.CreationDate -ge $t0.AddSeconds(-2)) ("pid {0} created={1}" -f $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss')) }
foreach ($p in $mine) { Check "portable python" ($p.ExecutablePath -eq $py) $p.ExecutablePath }

if (@('A4-4', 'B1-2', 'B2') -contains $Bundle) {
  $listen = Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue
  Check 'webhook 18791 listening' ([bool]$listen) $(if ($listen) { "pid $($listen.OwningProcess)" } else { 'none' })
}

if ($Bundle -eq 'A4-4') {
  $sup = @(Find-Proc $svcRx['tunnel_supervisor'])
  $kids = @(); foreach ($p in $sup) { $kids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.ProcessId)" | Where-Object { $_.CommandLine -match 'nokey@localhost\.run' }) }
  Check 'child_single tunnel' ($kids.Count -eq 1) "count=$($kids.Count)"
  $ev = Join-Path $root 'logs\tunnel_events.jsonl'
  $day = ($t0.Hour -ge 10 -and $t0.Hour -lt 20)
  $okEv = $false; $seen = @()
  $end = (Get-Date).AddSeconds($WaitSeconds)
  while (-not $okEv -and (Get-Date) -lt $end) {
    Start-Sleep -Seconds 5
    if (-not (Test-Path -LiteralPath $ev)) { continue }
    $seen = @(Get-Content -LiteralPath $ev -Encoding UTF8 -Tail 60 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -and $_.ts -and ([datetime]$_.ts) -ge $t0.AddSeconds(-5) })
    if ($day) {
      $okEv = (@($seen | Where-Object { $_.event -eq 'put_result' -and "$($_.put_status)" -eq '200' }).Count -gt 0) -and (@($seen | Where-Object { $_.event -eq 'verify_result' -and $_.verify_status -eq 'match' }).Count -gt 0)
    } else {
      $okEv = @($seen | Where-Object { $_.event -eq 'skipped_night' }).Count -gt 0
    }
  }
  foreach ($e in $seen) { Say ("ev {0} {1} put={2} verify={3} attempt={4}" -f $e.ts, $e.event, $e.put_status, $e.verify_status, $e.attempt) }
  Check $(if ($day) { 'tunnel PUT 200 + verify match' } else { 'tunnel skipped_night' }) $okEv "events=$($seen.Count)"
}

if ($Bundle -eq 'A3-2') {
  Start-Sleep -Seconds 10
  Push-Location -LiteralPath $root
  try {
    $code = @'
import collections, json, sys
from pathlib import Path
ok = True
p = Path("data/monitor_state.json")
if p.exists():
    s = json.loads(p.read_text(encoding="utf-8-sig"))
    b, k = s.get("baseline_initialized"), s.get("completed_keys")
    print("baseline_initialized=%r completed_keys=%s" % (b, len(k) if isinstance(k, list) else "MISSING"))
    ok = isinstance(b, bool) and isinstance(k, list)
else:
    print("STATE_NOT_CREATED")
latest = {}
q = Path("data/notify_outbox.jsonl")
if q.exists():
    for line in q.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            latest[(r.get("kind"), r.get("dno"), r.get("did"), r.get("uid"))] = r
print("outbox_status_counts=%s" % dict(collections.Counter(r.get("status") for r in latest.values())))
sys.exit(0 if ok else 1)
'@
    $ErrorActionPreference = 'Continue'
    $out = @($code | & $py -I -S -B - 2>&1 | ForEach-Object { $_.ToString() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    foreach ($l in $out) { Say "state| $l" }
    Check 'json_readback monitor_state' ($rc -eq 0) "rc=$rc"
  } finally { Pop-Location }
  $logs = @(Get-ChildItem -LiteralPath (Join-Path $root 'logs') -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'inbound' -and $_.LastWriteTime -ge $t0.AddSeconds(-5) })
  if ($logs.Count -eq 0) { Say 'WARN no inbound monitor log written since restart' }
  $bad = 0
  foreach ($f in $logs) { $bad += @(Get-Content -LiteralPath $f.FullName -Tail 200 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'STATE_CORRUPT|OUTBOX_CORRUPT|MONITOR_STOPPED|Traceback' }).Count }
  Check 'no_log_marker inbound monitor' ($bad -eq 0) "files=$($logs.Count) hits=$bad"
}

if (@('B1-2', 'B2') -contains $Bundle) {
  $wl = Join-Path $root 'logs\webhook_server.log'
  $recent = @(Get-Content -LiteralPath $wl -Encoding UTF8 -Tail 30 -ErrorAction SilentlyContinue)
  $tb = @($recent | Where-Object { $_ -match 'Traceback|ImportError|SyntaxError' }).Count
  Check 'webhook log clean' ($tb -eq 0) "traceback_lines=$tb (LINE webhook/test is run from the ai PC with ops\Get-LineEndpoint.ps1 -Test)"
}

Say '--- watchdog.log tail ---'
Get-Content -LiteralPath (Join-Path $root 'logs\watchdog.log') -Tail 4 -ErrorAction SilentlyContinue | ForEach-Object { Say "wd| $_" }
foreach ($n in 'FXwash-Watchdog', 'FXwash-Daily-10AM') { $t = Get-ScheduledTask -TaskName $n; Say ("task {0} State={1} Enabled={2}" -f $n, $t.State, $t.Settings.Enabled) }
if ($script:fails -eq 0) { Say "PHASE2 PASS $Bundle"; exit 0 } else { Say "PHASE2 FAIL $Bundle fails=$($script:fails)"; exit 1 }
