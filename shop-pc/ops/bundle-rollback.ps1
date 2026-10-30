# bundle-rollback.ps1 - put the pre-deploy files back after a phase2 FAIL.
# A3-2 rule (DEPLOY-A3-2.md section 6): if monitor_state.json / notify_outbox.jsonl changed since the backup,
# the new monitor may already have sent; keep the monitor STOPPED, keep every file, print MANUAL_RECONCILE_REQUIRED, exit 3.
# Exit: 0 rolled back, 1 error, 3 manual reconcile required. Commander-written 10/30; ASCII only, PS 5.1.
param(
  [Parameter(Mandatory = $true)][ValidateSet('A3-2', 'A4-4', 'B1-2', 'B2')][string]$Bundle,
  [Parameter(Mandatory = $true)][string]$Backup
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Find-Proc($pattern) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }) }
function Stop-Verified($p) {
  $again = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ProcessId)"
  if (-not $again -or $again.CommandLine -ne $p.CommandLine -or $again.CreationDate -ne $p.CreationDate) { Say "pid $($p.ProcessId) gone or reused, skip"; return }
  Stop-Process -Id $p.ProcessId -Force
  Say ("stopped pid {0} {1}" -f $p.ProcessId, $p.Name)
}
$root = 'C:\LaundryStores\fxwash'
$rx = @{ 'A3-2' = 'LaundryStores\\fxwash\\runtime\\inbound_monitor\.py'; 'A4-4' = 'LaundryStores\\fxwash\\runtime\\tunnel_supervisor\.py'; 'B1-2' = 'LaundryStores\\fxwash\\runtime\\webhook_server\.py'; 'B2' = 'LaundryStores\\fxwash\\runtime\\webhook_server\.py' }
$tasks = @(Import-Clixml -LiteralPath (Join-Path $Backup 'tasks-before.xml'))
$files = @(Import-Clixml -LiteralPath (Join-Path $Backup 'files-before.xml'))

foreach ($t in $tasks) { Disable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "disabled $($t.TaskName)" }
for ($i = 0; $i -lt 4 -and @(Find-Proc 'fxwash\\watchdog\.py').Count -gt 0; $i++) { Say 'watchdog.py running, wait 15s'; Start-Sleep -Seconds 15 }
$targets = @(Find-Proc $rx[$Bundle])
$kids = @()
if ($Bundle -eq 'A4-4') { foreach ($p in $targets) { $kids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.ProcessId)" | Where-Object { $_.CommandLine -match 'nokey@localhost\.run' }) } }
foreach ($p in $targets) { Stop-Verified $p }
foreach ($k in $kids) { Stop-Verified $k }
Start-Sleep -Seconds 2

$changed = @()
foreach ($b in ($files | Where-Object { $_.IsState })) {
  $cur = Join-Path $root $b.Relative
  $now = if (Test-Path -LiteralPath $cur -PathType Leaf) { (Get-FileHash -LiteralPath $cur -Algorithm SHA256).Hash } else { $null }
  if ($now -ne $b.SHA256) { $changed += $b.Relative }
}
if ($changed.Count -gt 0) {
  Say ("state changed since backup: {0}" -f ($changed -join ', '))
  Say 'MANUAL_RECONCILE_REQUIRED: monitor kept STOPPED, tasks kept disabled, all files kept as they are'
  exit 3
}
foreach ($b in ($files | Where-Object { -not $_.IsState })) {
  $target = Join-Path $root $b.Relative
  if ($b.Existed) {
    Copy-Item -LiteralPath (Join-Path $Backup $b.Relative) -Destination $target -Force
    $ok = ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $b.SHA256)
    Say ("restored {0} sha_ok={1}" -f $b.Relative, $ok)
    if (-not $ok) { throw "restore hash mismatch $($b.Relative)" }
  } elseif ((Test-Path -LiteralPath $target -PathType Leaf) -and ($b.Relative -like 'runtime\test_*')) {
    Say "kept new offline test file $($b.Relative) (not loaded by services)"
  }
}
foreach ($t in $tasks) { if ($t.Enabled) { Enable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "re-enabled $($t.TaskName)" } }
Start-ScheduledTask -TaskName 'FXwash-Watchdog'
Say "ROLLED_BACK $Bundle (watchdog kicked; old version starting)"
exit 0
