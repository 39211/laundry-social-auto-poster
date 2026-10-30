# A4-2 phase2: re-enable tasks, let FXwash-Watchdog start the (new) services, then read back evidence.
param([Parameter(Mandatory=$true)][string]$Backup, [int]$WaitSeconds = 45)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Find-Proc($pattern) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }) }
$root = 'C:\LaundryStores\fxwash'
$t0 = Get-Date
foreach ($t in (Import-Clixml -LiteralPath (Join-Path $Backup 'tasks-before.xml'))) {
  if ($t.Enabled) { Enable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "re-enabled $($t.TaskName)" }
}
Start-ScheduledTask -TaskName 'FXwash-Watchdog'
Say 'kicked FXwash-Watchdog'
Start-Sleep -Seconds 12
foreach ($p in (Find-Proc 'LaundryStores\\fxwash\\runtime\\(webhook_server|tunnel_supervisor|inbound_monitor)\.py')) {
  Say ("proc pid {0} created={1} cmd={2}" -f $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss'), $p.CommandLine)
}
$listen = Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue
if ($listen) { Say ("18791 listener pid {0}" -f $listen.OwningProcess) } else { Say '18791 NO LISTENER' }
Say "waiting $WaitSeconds s for tunnel + PUT/GET verify"
Start-Sleep -Seconds $WaitSeconds
foreach ($k in (Find-Proc 'nokey@localhost\.run')) { Say ("ssh child pid {0} parent={1} created={2}" -f $k.ProcessId, $k.ParentProcessId, $k.CreationDate.ToString('HH:mm:ss')) }
$ev = Join-Path $root 'logs\tunnel_events.jsonl'
if (Test-Path -LiteralPath $ev) {
  Say '--- tunnel_events.jsonl (this run) ---'
  Get-Content -LiteralPath $ev -Encoding UTF8 -Tail 40 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ -and ([datetime]$_.ts) -ge $t0.AddSeconds(-5) } |
    ForEach-Object { Say ("ev {0} {1} old={2} new={3} put={4} verify={5} attempt={6} rc={7} alive={8}" -f $_.ts, $_.event, $_.old_url, $_.new_url, $_.put_status, $_.verify_status, $_.attempt, $_.rc, $_.alive_seconds) }
} else { Say 'tunnel_events.jsonl NOT FOUND' }
$wl = Join-Path $root 'logs\webhook_server.log'
Say '--- webhook_server.log tail (truncated 110 chars) ---'
Get-Content -LiteralPath $wl -Encoding UTF8 -Tail 8 | ForEach-Object { $s = $_; if ($s.Length -gt 110) { $s = $s.Substring(0,110) + '...' }; Say ("wl| ts_ok={0} {1}" -f ($s -match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} '), $s) }
Say '--- watchdog.log tail ---'
Get-Content -LiteralPath (Join-Path $root 'logs\watchdog.log') -Tail 6 | ForEach-Object { Say "wd| $_" }
foreach ($n in 'FXwash-Watchdog','FXwash-Daily-10AM') { $t = Get-ScheduledTask -TaskName $n; Say ("task {0} State={1} Enabled={2}" -f $n, $t.State, $t.Settings.Enabled) }
Say 'PHASE2 DONE'
