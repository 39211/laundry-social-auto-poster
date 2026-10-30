# Manual A4-3/A2-b deploy to the live ai line-bot (junction path). Start goes through the
# Laundry-LINE-Bot scheduled task (detached, same path the watchdog uses).
param([switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
$src    = 'C:\Users\cyc39\AI-Lanes\integ\repo'
$target = 'C:\Users\cyc39\laundry-repo'
$bot    = Join-Path $target 'line-bot'
$py     = 'C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe'
$ctl    = Join-Path $bot 'run_line_bot.ps1'
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "D:\AI-Lanes-work\_backups\ai-linebot\manual-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Push-Location $src
try {
  $head = (git rev-parse HEAD).Trim()
  $integ = (git rev-parse integration/20261030).Trim()
  if ($head -ne $integ) { throw "integ worktree HEAD $head != integration/20261030 $integ" }
  $paths = @(git diff --name-only release/sxj-live-2026-10..integration/20261030 -- line-bot/ | Where-Object { $_ })
} finally { Pop-Location }
if ($paths.Count -lt 20) { throw "payload too small: $($paths.Count)" }
Say "payload files=$($paths.Count) source HEAD=$($head.Substring(0,8))"

# backup existing targets
$manifest = foreach ($rel in $paths) {
  $from = Join-Path $src ($rel -replace '/','\')
  $to   = Join-Path $target ($rel -replace '/','\')
  if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "source missing: $rel" }
  $existed = Test-Path -LiteralPath $to -PathType Leaf
  $bsha = $null
  if ($existed) {
    $saved = Join-Path $backup ($rel -replace '/','\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
    Copy-Item -LiteralPath $to -Destination $saved
    $bsha = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash
    if ($bsha -ne (Get-FileHash -LiteralPath $saved -Algorithm SHA256).Hash) { throw "backup sha mismatch: $rel" }
  }
  [pscustomobject]@{ Path = $rel; Existed = $existed; BackupSha = $bsha; SourceSha = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $backup 'MANIFEST.json') -Encoding UTF8
Say "backup at $backup (existed=$(@($manifest | Where-Object Existed).Count))"

function Get-BotProcs {
  @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'laundry-repo\\line-bot\\|New project 5\\line-bot\\') -and $_.Name -match '^python' })
}
function Rollback {
  Say 'ROLLBACK: restoring backup'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ctl -Stop | ForEach-Object { Say "  $_" }
  foreach ($m in $manifest) {
    $to = Join-Path $target ($m.Path -replace '/','\')
    if ($m.Existed) { Copy-Item -LiteralPath (Join-Path $backup ($m.Path -replace '/','\')) -Destination $to -Force }
    elseif (Test-Path -LiteralPath $to -PathType Leaf) { Remove-Item -LiteralPath $to -Force }
  }
  Start-ScheduledTask -TaskName 'Laundry-LINE-Bot'
  Say 'ROLLBACK: files restored, Laundry-LINE-Bot kicked'
}

try {
  # stop
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ctl -Stop | ForEach-Object { Say "stop| $_" }
  Start-Sleep -Seconds 3
  foreach ($p in (Get-BotProcs)) {
    $again = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ProcessId)"
    if ($again -and $again.CommandLine -eq $p.CommandLine -and $again.CreationDate -eq $p.CreationDate) { Stop-Process -Id $p.ProcessId -Force; Say "stopped leftover pid $($p.ProcessId)" }
  }
  foreach ($c in @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match '127\.0\.0\.1:8791' })) {
    $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.ParentProcessId)"
    if (-not $par) { Stop-Process -Id $c.ProcessId -Force; Say "stopped orphan cloudflared pid $($c.ProcessId)" }
  }
  Start-Sleep -Seconds 2
  $listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8791,8792 })
  if ($listen.Count -gt 0) { throw "ports still listening: $(($listen | ForEach-Object { $_.LocalPort }) -join ',')" }
  if ((Get-BotProcs).Count -gt 0) { throw 'bot processes remain' }
  Say 'STOP verified (8791/8792 free, no bot python)'

  # copy
  foreach ($m in $manifest) {
    $from = Join-Path $src ($m.Path -replace '/','\')
    $to   = Join-Path $target ($m.Path -replace '/','\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash -ne $m.SourceSha) { throw "copy sha mismatch: $($m.Path)" }
  }
  Say "COPY done ($($manifest.Count) files)"

  # tests (venv python, cwd = live line-bot)
  if (-not $SkipTests) {
    Push-Location $bot
    try {
      $env:PYTHONDONTWRITEBYTECODE = '1'
      $ErrorActionPreference = 'Continue'
      $o1 = & $py -B -X utf8 -m unittest test_tunnel_manager test_day_night_handover 2>&1 | ForEach-Object { $_.ToString() }; $r1 = $LASTEXITCODE
      $o2 = & $py -B -X utf8 run_a2b_tests.py test_mdb_freshness 2>&1 | ForEach-Object { $_.ToString() }; $r2 = $LASTEXITCODE
      $o3 = & $py -B -X utf8 run_a2b_tests.py test_arrival_notify 2>&1 | ForEach-Object { $_.ToString() }; $r3 = $LASTEXITCODE
      if ($r3 -ne 0) { Say 'arrival tests failed once, retry'; $o3 = & $py -B -X utf8 run_a2b_tests.py test_arrival_notify 2>&1 | ForEach-Object { $_.ToString() }; $r3 = $LASTEXITCODE }
      $ErrorActionPreference = 'Stop'
      Say ("tests tunnel+handover rc=$r1 : " + (($o1 | Select-Object -Last 3) -join ' | '))
      Say ("tests mdb_freshness rc=$r2 : " + (($o2 | Select-Object -Last 3) -join ' | '))
      Say ("tests arrival_notify rc=$r3 : " + (($o3 | Select-Object -Last 3) -join ' | '))
      if ($r1 -ne 0 -or $r2 -ne 0 -or $r3 -ne 0) { throw 'offline tests failed' }
    } finally { Pop-Location }
  }

  # start via scheduled task (detached)
  $ev = Join-Path $env:LOCALAPPDATA 'line-bot\tunnel_events.jsonl'
  $evLen = 0; if (Test-Path $ev) { $evLen = (Get-Item $ev).Length }
  $t0 = Get-Date
  Start-ScheduledTask -TaskName 'Laundry-LINE-Bot'
  Say 'kicked Laundry-LINE-Bot'
  Start-Sleep -Seconds 15
  & powershell -NoProfile -ExecutionPolicy Bypass -File $ctl -Probe | ForEach-Object { Say "probe| $_" }
  $probeRc = $LASTEXITCODE
  if ($probeRc -ne 0) { Start-Sleep -Seconds 10; & powershell -NoProfile -ExecutionPolicy Bypass -File $ctl -Probe | ForEach-Object { Say "probe2| $_" }; $probeRc = $LASTEXITCODE }
  if ($probeRc -ne 0) { throw "probe failed rc=$probeRc" }
  Say "DEPLOY OK backup=$backup eventsOffset=$evLen started=$($t0.ToString('HH:mm:ss'))"
}
catch {
  Say "DEPLOY FAILED: $($_.Exception.Message)"
  try { Rollback } catch { Say "rollback error: $($_.Exception.Message)" }
  exit 1
}
