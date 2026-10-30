# A4-2 phase1: precheck -> backup -> disable tasks -> stop services -> copy 4 files -> offline tests
# On any failure: restore files from backup, re-enable tasks, kick watchdog (old version comes back).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

$root  = 'C:\LaundryStores\fxwash'
$py    = 'C:\LaundryStores\python-portable\python.exe'
$stage = 'C:\LaundryStores\A4-2-staging'
$files = @('runtime\webhook_server.py','runtime\tunnel_supervisor.py','runtime\test_tunnel_events.py','runtime\test_webhook_log_ts.py')
$expected = @{
  'runtime\webhook_server.py'     = '161A4DD3473E3FC53FECE18BD6DB101F5035EE77E75E09B260970CFABB95BCA7'
  'runtime\tunnel_supervisor.py'  = 'A7010A07AD16C0477A51B02BA937E085E7F800349E8E567F13406D901E6076F6'
  'runtime\test_tunnel_events.py' = '914C0E79F99C5F9B8CB719FF67906C0EF83AD705D6400360F4BF7552D078B562'
  'runtime\test_webhook_log_ts.py'= '7DC89633FA0F34CECDF1A547AF703DB83972455619D35CCB6DC361F9336876E7'
}
$taskNames = @('FXwash-Watchdog','FXwash-Daily-10AM')

# ---- 1. precheck ----
$now = Get-Date
if ($now.Hour -lt 10 -or $now.Hour -ge 20) { throw 'outside 10:00-20:00 maintenance window' }
if (-not (Test-Path -LiteralPath $py -PathType Leaf)) { throw 'shop python not found' }
$ErrorActionPreference = 'Continue'
$v = & $py -B -c 'import sys; assert sys.version_info[:2] == (3, 11); print(sys.version)' 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) { throw "python version mismatch: $v" }
Say "python $v"
foreach ($rel in $files) {
  $src = Join-Path $stage $rel
  if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "staging file missing: $rel" }
  $h = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
  if ($h -ne $expected[$rel]) { throw "staging hash mismatch: $rel $h" }
  Say "staging OK $rel $($h.Substring(0,12))"
}

# ---- 2. backup ----
$backup = Join-Path $root ('backups\A4-2-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path (Join-Path $backup 'runtime') | Out-Null
$shopHash = (Get-FileHash -LiteralPath (Join-Path $root 'shop.json') -Algorithm SHA256).Hash
$before = foreach ($rel in $files) {
  $target = Join-Path $root $rel
  $exists = Test-Path -LiteralPath $target -PathType Leaf
  if ($exists) {
    Copy-Item -LiteralPath $target -Destination (Join-Path $backup $rel)
    $hh = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($hh -ne (Get-FileHash -LiteralPath (Join-Path $backup $rel) -Algorithm SHA256).Hash) { throw "backup hash mismatch: $rel" }
  } else { $hh = $null }
  [pscustomobject]@{ Relative = $rel; Existed = $exists; SHA256 = $hh }
}
$before | Export-Clixml -LiteralPath (Join-Path $backup 'files-before.xml')
$shopHash | Set-Content -LiteralPath (Join-Path $backup 'shop-json-before.sha256') -Encoding ASCII
foreach ($b in $before) { Say ("before {0} existed={1} sha={2}" -f $b.Relative, $b.Existed, $(if ($b.SHA256) { $b.SHA256.Substring(0,12) } else { '-' })) }
Say "backup dir $backup"

# ---- helpers ----
function Find-Proc($pattern) { @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern }) }
function Stop-Verified($p) {
  $again = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ProcessId)"
  if (-not $again -or $again.CommandLine -ne $p.CommandLine -or $again.CreationDate -ne $p.CreationDate) { Say "pid $($p.ProcessId) gone or reused, skip"; return }
  Stop-Process -Id $p.ProcessId -Force
  Say ("stopped pid {0} {1} created={2}" -f $p.ProcessId, $p.Name, $p.CreationDate.ToString('HH:mm:ss'))
}
function Restore-Tasks($backupDir) {
  foreach ($t in (Import-Clixml -LiteralPath (Join-Path $backupDir 'tasks-before.xml'))) {
    if ($t.Enabled) { Enable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "re-enabled $($t.TaskName)" }
  }
}
function Rollback-Files($backupDir) {
  foreach ($b in (Import-Clixml -LiteralPath (Join-Path $backupDir 'files-before.xml'))) {
    $target = Join-Path $root $b.Relative
    if ($b.Existed) {
      Copy-Item -LiteralPath (Join-Path $backupDir $b.Relative) -Destination $target -Force
      $hh = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
      Say ("rollback {0} sha_ok={1}" -f $b.Relative, ($hh -eq $b.SHA256))
    } else {
      if ((Test-Path -LiteralPath $target -PathType Leaf) -and ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $expected[$b.Relative])) {
        Remove-Item -LiteralPath $target -Force; Say "rollback removed new file $($b.Relative)"
      }
    }
  }
}

# ---- 3. disable tasks, stop services ----
$tasksBefore = @(foreach ($n in $taskNames) {
  $t = Get-ScheduledTask -TaskPath '\' -TaskName $n
  [pscustomobject]@{ TaskPath = $t.TaskPath; TaskName = $t.TaskName; Enabled = $t.Settings.Enabled }
})
$tasksBefore | Export-Clixml -LiteralPath (Join-Path $backup 'tasks-before.xml')
foreach ($t in $tasksBefore) { if ($t.Enabled) { Disable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "disabled $($t.TaskName)" } }

try {
  $wd = @(Find-Proc 'fxwash\\watchdog\.py')
  if ($wd.Count -gt 0) { Say "watchdog.py running pid $($wd.ProcessId), wait 15s"; Start-Sleep -Seconds 15 }
  $sup = @(Find-Proc 'LaundryStores\\fxwash\\runtime\\tunnel_supervisor\.py')
  $web = @(Find-Proc 'LaundryStores\\fxwash\\runtime\\webhook_server\.py')
  foreach ($p in (@($sup) + @($web))) {
    if ($p.ExecutablePath -ne $py) { throw "not portable python: $($p.ProcessId) $($p.ExecutablePath)" }
    Say ("found pid {0} created={1} cmd={2}" -f $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss'), $p.CommandLine)
  }
  $sshKids = @()
  foreach ($p in $sup) {
    $sshKids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.ProcessId)" | Where-Object { $_.CommandLine -match '-R 80:127\.0\.0\.1:18791' -and $_.CommandLine -match 'nokey@localhost\.run' })
  }
  foreach ($k in $sshKids) { Say ("found ssh child pid {0} parent={1} created={2}" -f $k.ProcessId, $k.ParentProcessId, $k.CreationDate.ToString('HH:mm:ss')) }
  foreach ($p in $sup) { Stop-Verified $p }
  foreach ($k in $sshKids) { Stop-Verified $k }
  foreach ($p in $web) { Stop-Verified $p }
  Start-Sleep -Seconds 2
  $listen = Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue
  if ($listen) { throw "18791 still has listener pid $($listen.OwningProcess)" }
  Say '18791 free'
  $left = @(Find-Proc 'LaundryStores\\fxwash\\runtime\\(tunnel_supervisor|webhook_server)\.py') + @(Find-Proc 'nokey@localhost\.run')
  if ($left.Count -gt 0) { throw "leftover processes: $($left.ProcessId -join ',')" }

  # ---- 4. copy + offline tests ----
  foreach ($rel in $files) {
    Copy-Item -LiteralPath (Join-Path $stage $rel) -Destination (Join-Path $root $rel) -Force
    $hh = (Get-FileHash -LiteralPath (Join-Path $root $rel) -Algorithm SHA256).Hash
    if ($hh -ne $expected[$rel]) { throw "deploy hash mismatch: $rel" }
    Say "deployed $rel $($hh.Substring(0,12))"
  }
  if ($shopHash -ne (Get-FileHash -LiteralPath (Join-Path $root 'shop.json') -Algorithm SHA256).Hash) { throw 'shop.json changed during copy' }
  Push-Location -LiteralPath $root
  try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $ErrorActionPreference = 'Continue'
    $out = & $py -B -m unittest discover -s runtime -p 'test_*.py' 2>&1 | ForEach-Object { $_.ToString() }
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $out | Select-Object -Last 12 | ForEach-Object { Say "unittest| $_" }
    if ($rc -ne 0) { throw "offline tests failed rc=$rc" }
    $ErrorActionPreference = 'Continue'
    $imp = & $py -B -c "import sys; sys.path.insert(0, r'C:\LaundryStores\fxwash\runtime'); import webhook_server, tunnel_supervisor; print('A4-2 import OK; server not started')" 2>&1 | ForEach-Object { $_.ToString() }
    $rc2 = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Say "import| $imp"
    if ($rc2 -ne 0) { throw "module import failed rc=$rc2" }
  } finally { Pop-Location }
  Say "PHASE1 OK backup=$backup"
}
catch {
  Say "PHASE1 FAILED: $($_.Exception.Message)"
  try { Rollback-Files $backup } catch { Say "rollback files error: $($_.Exception.Message)" }
  try { Restore-Tasks $backup } catch { Say "restore tasks error: $($_.Exception.Message)" }
  try { Start-ScheduledTask -TaskName 'FXwash-Watchdog'; Say 'kicked FXwash-Watchdog (old version restart)' } catch { Say "kick watchdog error: $($_.Exception.Message)" }
  Say "PHASE1 ROLLED BACK backup=$backup"
  exit 1
}
