# bundle-phase1.ps1 - generic version of the proven a42-phase1.ps1 (10/30 live A4-2 deploy).
# Steps: precheck -> backup -> disable tasks -> stop ONLY the bundle's services (verified PID) -> copy -> offline tests (retry once) -> import check.
# On any failure: restore files from backup, re-enable tasks, kick watchdog (old version comes back). Exit 1.
# -CheckOnly: precheck only (window, python, staging hashes, requires hashes); zero writes. Exit 2 on refusal.
# Commander-written (the API model refused this task under its cyber policy, 10/30 23:40); ASCII only, PS 5.1.
param(
  [Parameter(Mandatory = $true)][ValidateSet('A3-2', 'A4-4', 'B1-2', 'B2')][string]$Bundle,
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }

$root = 'C:\LaundryStores\fxwash'
$py = 'C:\LaundryStores\python-portable\python.exe'
$stage = "C:\LaundryStores\$Bundle-staging"
$taskNames = @('FXwash-Watchdog', 'FXwash-Daily-10AM')
$svcRx = @{
  'webhook_server'    = 'LaundryStores\\fxwash\\runtime\\webhook_server\.py'
  'tunnel_supervisor' = 'LaundryStores\\fxwash\\runtime\\tunnel_supervisor\.py'
  'inbound_monitor'   = 'LaundryStores\\fxwash\\runtime\\inbound_monitor\.py'
}
$kidRx1 = '-R 80:127\.0\.0\.1:18791'
$kidRx2 = 'nokey@localhost\.run'
$fullTests = @('-B', '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'test_*.py')

$cfg = @{
  'A3-2' = @{
    expected = [ordered]@{
      'runtime\inbound_monitor.py'      = '8D3EC62976805CD61805CCCB524F763B04B453A56DD9F52C48151222CD15F160'
      'runtime\test_inbound_monitor.py' = 'E0B1117AE0DC4FC6F6A3B885A8B3BA50B172552C7D488231A080646C1F1785EE'
    }
    requires = @{}
    stop     = @('inbound_monitor')
    tests    = @(, @('-I', '-S', '-B', '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'test_inbound_monitor.py'))
    imports  = 'inbound_monitor'
    state    = @('data\monitor_state.json', 'data\notify_outbox.jsonl')
  }
  'A4-4' = @{
    expected = [ordered]@{
      'runtime\tunnel_supervisor.py'  = '9EA3149A2F09E5DBB7894B71CB7095B249BF4B6C34C2F4EABB5D8830B2A9FA8E'
      'runtime\test_tunnel_events.py' = '261C77E24E351988BD821E26575D19345CDA7BB45B37FA43CD868AF2C8A88FB7'
    }
    requires = @{ 'runtime\tunnel_supervisor.py' = 'A7010A07AD16C0477A51B02BA937E085E7F800349E8E567F13406D901E6076F6' }
    stop     = @('tunnel_supervisor')
    tests    = @(, @('-B', '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'test_tunnel_events.py'))
    imports  = 'tunnel_supervisor'
    state    = @()
  }
  'B1-2' = @{
    expected = [ordered]@{
      'runtime\chat_service.py'    = '1B9E5A706F6D96E26C8633022880A92DCC7C6823AA8CB9024B72EE669B6F2E57'
      'config\dialog_corpus.py'    = '9746F5E076571E4240275851976D0212E1829CA850AAF9493ADE5EC5B4655ECF'
      'config\Dialog_Phrases.json' = '455F608F81EC63A98685A4498DB5B6808D7908FA0931673010264D8C80118A1C'
      'runtime\test_b1_facts.py'   = 'C376B453156CD8868F526C4E37A6A817965061189341B3C78EB27C32F57A1017'
      'build_expanded_corpus.py'    = '6755C6ED928C18069DA7BFAF9E5F6F4D5822A5EE6A1048DDA48A5C163F224719'
      'build_expanded_corpus_v5.py' = '5A96D3987CD721FC2E8583F3C45EEA8B87BE092F82789460838E56DED1124A3C'
    }
    requires = @{
      'runtime\chat_service.py'    = '36E170CE8556132ECF4F61218D45E51856D7D405279AF465E87CEE184AEDD027'
      'config\dialog_corpus.py'    = '3A14B2DF52A003EB70BC222CA15A6F2E62E3E4264E2C303326A954DE974EC9D3'
      'config\Dialog_Phrases.json' = 'BE60A141403EA8317419DEF5D3C8DD15F4FA213EFB9580EACBE1E26F29AFF732'
      'build_expanded_corpus.py'    = '43AE88B06706DED8836F01E64A786CF2961DF64267663A0E8547466EF446AB87'
      'build_expanded_corpus_v5.py' = 'B7584969E3EB15FB5925D397383B957D27850B406B1E69B2443DDC4A90F7E352'
    }
    stop     = @('webhook_server')
    tests    = @(, @('-I', '-S', '-B', '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'test_b1_facts.py'))
    imports  = 'webhook_server'
    state    = @()
  }
  'B2'   = @{
    expected = [ordered]@{
      'runtime\webhook_server.py'           = '22DDA24C08EED0C9A6850A1537E728FC695B75DDD529787D5097CE8F77D68748'
      'runtime\attribution_service.py'      = 'B32B19F083895F6E68EF72413AFC6BDDE2829CBCC9C96DA8AC0C95BA892F7634'
      'runtime\attribution_export.py'       = '3400FB5C204D44AD3D5B6E1DD567240BFD151F9BF5A224FA96B0A5CC5EAAE78A'
      'runtime\attribution_retention.py'    = '028524B0B474E190971907CF1140C639A216E003D9F7856C17B6AA100AE84248'
      'runtime\test_webhook_attribution.py' = '3DC65D49B2D6F06D7FE3E5A4D01171F58656A6DEA06EAAD7C3D11471C55BA622'
      'runtime\test_attribution_service.py' = '7F698DD4F97970A3F39F00ABFACA6EF5815ED9580BD7600449A8E1A894F689E7'
      'runtime\test_attribution_export.py'  = '549CDA9B1FB1674B1FDF16767C19C667A0CAA54F96ECA4B4175E22D915C10A24'
      'runtime\test_attribution_retention.py' = 'B5E96C2CBA7D3C9318622326110E2E1C1142D3E805BCEDA282884FE3C751F9A0'
      'tools\make_attribution_secret.py'    = '8899B826DEF51DC315DD8B17CFB8530E95DC1BC3EF5D38D57A294A043F9FF442'
      'data\attribution\source-codes.json'  = '361BC7EF1B38CDC5EB85498BABAB7911FB8C8DB9AC0B36EBCCF39AF29C69AAB8'
    }
    requires = @{ 'runtime\webhook_server.py' = '161A4DD3473E3FC53FECE18BD6DB101F5035EE77E75E09B260970CFABB95BCA7' }
    stop     = @('webhook_server')
    tests    = @(, @('-I', '-S', '-B', '-m', 'unittest', 'discover', '-s', 'runtime', '-p', 'test_*attribution*.py'))
    imports  = 'webhook_server'
    state    = @()
  }
}
$c = $cfg[$Bundle]
$files = @($c.expected.Keys)

# ---- 1. precheck (refuse = exit 2, nothing changed) ----
try {
  $now = Get-Date
  if ($now.Hour -lt 10 -or ($now.Hour -eq 19 -and $now.Minute -gt 30) -or $now.Hour -ge 20) { throw 'outside 10:00-19:30 maintenance window' }
  if (-not (Test-Path -LiteralPath $py -PathType Leaf)) { throw 'shop python not found' }
  $ErrorActionPreference = 'Continue'
  $v = & $py -B -c 'import sys; assert sys.version_info[:2] == (3, 11); print(sys.version)' 2>&1
  $vrc = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($vrc -ne 0) { throw "python version mismatch: $v" }
  Say "bundle $Bundle python $v"
  foreach ($rel in $files) {
    $src = Join-Path $stage $rel
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "staging file missing: $rel" }
    $h = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
    if ($h -ne $c.expected[$rel]) { throw "staging hash mismatch: $rel $($h.Substring(0,12))" }
    Say "staging OK $rel $($h.Substring(0,12))"
  }
  foreach ($rel in @($c.requires.Keys)) {
    $live = Join-Path $root $rel
    $lh = if (Test-Path -LiteralPath $live -PathType Leaf) { (Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash } else { 'MISSING' }
    if ($lh -ne $c.requires[$rel]) { throw ("REFUSED requires {0} live={1} expected={2}" -f $rel, $lh.Substring(0, [Math]::Min(12, $lh.Length)), $c.requires[$rel].Substring(0, 12)) }
    Say "requires OK $rel $($lh.Substring(0,12))"
  }
} catch {
  Say "PRECHECK REFUSED: $($_.Exception.Message)"
  exit 2
}
if ($CheckOnly) { Say "CHECK OK (no changes made)"; exit 0 }

# ---- 2. backup ----
$backup = Join-Path $root ("backups\$Bundle-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
$shopHash = (Get-FileHash -LiteralPath (Join-Path $root 'shop.json') -Algorithm SHA256).Hash
$backupList = @($files) + @($c.state)
$before = foreach ($rel in $backupList) {
  $target = Join-Path $root $rel
  $exists = Test-Path -LiteralPath $target -PathType Leaf
  if ($exists) {
    $dst = Join-Path $backup $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item -LiteralPath $target -Destination $dst
    $hh = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($hh -ne (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash) { throw "backup hash mismatch: $rel" }
  } else { $hh = $null }
  [pscustomobject]@{ Relative = $rel; Existed = $exists; SHA256 = $hh; IsState = ($c.state -contains $rel) }
}
$before = @($before)
$before | Export-Clixml -LiteralPath (Join-Path $backup 'files-before.xml')
$shopHash | Set-Content -LiteralPath (Join-Path $backup 'shop-json-before.sha256') -Encoding ASCII
foreach ($b in $before) { Say ("before {0} existed={1} state={2} sha={3}" -f $b.Relative, $b.Existed, $b.IsState, $(if ($b.SHA256) { $b.SHA256.Substring(0, 12) } else { '-' })) }
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
    if ($b.IsState) { continue }  # state files are never touched by phase1; nothing to restore
    $target = Join-Path $root $b.Relative
    if ($b.Existed) {
      Copy-Item -LiteralPath (Join-Path $backupDir $b.Relative) -Destination $target -Force
      $hh = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
      Say ("rollback {0} sha_ok={1}" -f $b.Relative, ($hh -eq $b.SHA256))
    } else {
      if ((Test-Path -LiteralPath $target -PathType Leaf) -and ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $c.expected[$b.Relative])) {
        Remove-Item -LiteralPath $target -Force; Say "rollback removed new file $($b.Relative)"
      }
    }
  }
}
function Invoke-Py([string[]]$pyArgs, [string]$label) {
  # Prints its own tail lines straight to the console so that the ONLY pipeline output is the exit code.
  $ErrorActionPreference = 'Continue'
  $out = @(& $py @pyArgs 2>&1 | ForEach-Object { $_.ToString() })
  $rc = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  foreach ($line in ($out | Select-Object -Last 8)) { [Console]::Out.WriteLine(("[{0}] {1}| {2}" -f (Get-Date -Format 'HH:mm:ss'), $label, $line)) }
  return [int]$rc
}

# ---- 3. disable tasks, stop the bundle's services ----
$tasksBefore = @(foreach ($n in $taskNames) {
  $t = Get-ScheduledTask -TaskPath '\' -TaskName $n
  [pscustomobject]@{ TaskPath = $t.TaskPath; TaskName = $t.TaskName; Enabled = $t.Settings.Enabled }
})
$tasksBefore | Export-Clixml -LiteralPath (Join-Path $backup 'tasks-before.xml')
foreach ($t in $tasksBefore) { if ($t.Enabled) { Disable-ScheduledTask -TaskPath $t.TaskPath -TaskName $t.TaskName | Out-Null; Say "disabled $($t.TaskName)" } }

try {
  for ($i = 0; $i -lt 4; $i++) {
    $wd = @(Find-Proc 'fxwash\\watchdog\.py')
    if ($wd.Count -eq 0) { break }
    Say "watchdog.py running pid $($wd.ProcessId -join ','), wait 15s"; Start-Sleep -Seconds 15
  }
  if (@(Find-Proc 'fxwash\\watchdog\.py').Count -gt 0) { throw 'watchdog.py still running after 60s' }
  $targets = @()
  foreach ($s in $c.stop) { $targets += @(Find-Proc $svcRx[$s]) }
  foreach ($p in $targets) {
    if ($p.ExecutablePath -ne $py) { throw "not portable python: $($p.ProcessId) $($p.ExecutablePath)" }
    Say ("found pid {0} created={1} cmd={2}" -f $p.ProcessId, $p.CreationDate.ToString('HH:mm:ss'), $p.CommandLine)
  }
  $kids = @()
  if ($c.stop -contains 'tunnel_supervisor') {
    foreach ($p in $targets) {
      $kids += @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($p.ProcessId)" | Where-Object { $_.CommandLine -match $kidRx1 -and $_.CommandLine -match $kidRx2 })
    }
    foreach ($k in $kids) { Say ("found tunnel child pid {0} parent={1} created={2}" -f $k.ProcessId, $k.ParentProcessId, $k.CreationDate.ToString('HH:mm:ss')) }
  }
  foreach ($p in $targets) { Stop-Verified $p }
  foreach ($k in $kids) { Stop-Verified $k }
  Start-Sleep -Seconds 2
  if ($c.stop -contains 'webhook_server') {
    $listen = Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue
    if ($listen) { throw "18791 still has listener pid $($listen.OwningProcess)" }
    Say '18791 free'
  }
  $left = @()
  foreach ($s in $c.stop) { $left += @(Find-Proc $svcRx[$s]) }
  if ($c.stop -contains 'tunnel_supervisor') { $left += @(Find-Proc $kidRx2) }
  if ($left.Count -gt 0) { throw "leftover processes: $($left.ProcessId -join ',')" }
  foreach ($s in @($svcRx.Keys | Where-Object { $c.stop -notcontains $_ })) { Say ("untouched {0}: {1} running" -f $s, @(Find-Proc $svcRx[$s]).Count) }

  # ---- 4. copy + offline tests ----
  foreach ($rel in $files) {
    $dst = Join-Path $root $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
    Copy-Item -LiteralPath (Join-Path $stage $rel) -Destination $dst -Force
    $hh = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
    if ($hh -ne $c.expected[$rel]) { throw "deploy hash mismatch: $rel" }
    Say "deployed $rel $($hh.Substring(0,12))"
  }
  if ($shopHash -ne (Get-FileHash -LiteralPath (Join-Path $root 'shop.json') -Algorithm SHA256).Hash) { throw 'shop.json changed during copy' }
  Push-Location -LiteralPath $root
  try {
    $env:PYTHONDONTWRITEBYTECODE = '1'
    foreach ($ta in (@(, $fullTests) + $c.tests)) {
      $label = 'unittest ' + $ta[-1]
      [int]$rc = Invoke-Py $ta $label
      if ($rc -ne 0) { Say "$label failed rc=$rc, retry once"; [int]$rc = Invoke-Py $ta $label }
      if ($rc -ne 0) { throw "offline tests failed: $label rc=$rc" }
    }
    $imp = "import sys; sys.path.insert(0, r'$root\runtime'); import $($c.imports); print('$Bundle import OK; service not started')"
    [int]$rc2 = Invoke-Py @('-B', '-c', $imp) 'import'
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
