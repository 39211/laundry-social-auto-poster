# Smoke test for bundle-rollback.ps1: stubs ScheduledTask/CIM/Stop-Process, temp fake root. Touches nothing real.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = [IO.File]::ReadAllText((Join-Path $here 'bundle-rollback.ps1'))
$stubs = @'
function Disable-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:T_LOG "disable $TaskName"; 'x' }
function Enable-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:T_LOG "enable $TaskName"; 'x' }
function Start-ScheduledTask { param($TaskName) Add-Content -LiteralPath $env:T_LOG "start $TaskName" }
function Get-CimInstance { param($ClassName, $Filter) @() }
function Stop-Process { param($Id, [switch]$Force) Add-Content -LiteralPath $env:T_LOG "stop $Id" }
'@
$p = $src.Replace("function Say(`$m) {", $stubs + "`r`nfunction Say(`$m) {").Replace("`$root = 'C:\LaundryStores\fxwash'", "`$root = `$env:T_ROOT")
if (-not $p.Contains('$env:T_ROOT')) { throw 'patch failed' }
$tmp = Join-Path $env:TEMP ('rb-' + [guid]::NewGuid().ToString('N').Substring(0, 8)); New-Item -ItemType Directory -Path $tmp | Out-Null
$script = Join-Path $tmp 'rb.ps1'; [IO.File]::WriteAllText($script, $p)
function Sha($f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash }
function New-Case($name, [bool]$stateChanged) {
  $d = Join-Path $tmp $name; $root = "$d\root"; $bk = "$d\bk"
  foreach ($x in "$root\runtime", "$root\data", "$bk\runtime", "$bk\data") { New-Item -ItemType Directory -Force -Path $x | Out-Null }
  [IO.File]::WriteAllText("$bk\runtime\inbound_monitor.py", 'old'); [IO.File]::WriteAllText("$bk\data\notify_outbox.jsonl", "a`n")
  [IO.File]::WriteAllText("$root\runtime\inbound_monitor.py", 'new')
  [IO.File]::WriteAllText("$root\data\notify_outbox.jsonl", $(if ($stateChanged) { "a`nb`n" } else { "a`n" }))
  @([pscustomobject]@{ Relative = 'runtime\inbound_monitor.py'; Existed = $true; SHA256 = (Sha "$bk\runtime\inbound_monitor.py"); IsState = $false },
    [pscustomobject]@{ Relative = 'data\notify_outbox.jsonl'; Existed = $true; SHA256 = (Sha "$bk\data\notify_outbox.jsonl"); IsState = $true }) | Export-Clixml "$bk\files-before.xml"
  @([pscustomobject]@{ TaskPath = '\'; TaskName = 'FXwash-Watchdog'; Enabled = $true }, [pscustomobject]@{ TaskPath = '\'; TaskName = 'FXwash-Daily-10AM'; Enabled = $false }) | Export-Clixml "$bk\tasks-before.xml"
  $env:T_ROOT = $root; $env:T_LOG = "$d\calls.log"; New-Item -ItemType File -Force -Path $env:T_LOG | Out-Null
  $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Bundle A3-2 -Backup $bk 2>&1 | ForEach-Object { $_.ToString() }
  return @{ rc = $LASTEXITCODE; out = ($out -join "`n"); root = $root; calls = @(Get-Content $env:T_LOG) }
}
$fails = 0
$r = New-Case 'unchanged' $false
$ok = ($r.rc -eq 0) -and ((Get-Content "$($r.root)\runtime\inbound_monitor.py") -eq 'old') -and ($r.calls -contains 'enable FXwash-Watchdog') -and (-not ($r.calls -contains 'enable FXwash-Daily-10AM')) -and ($r.calls -contains 'start FXwash-Watchdog')
if ($ok) { 'PASS state unchanged -> files restored, only originally-enabled task re-enabled' } else { $fails++; "FAIL unchanged rc=$($r.rc)"; $r.out }
$r = New-Case 'changed' $true
$ok = ($r.rc -eq 3) -and ($r.out -match 'MANUAL_RECONCILE_REQUIRED') -and ((Get-Content "$($r.root)\runtime\inbound_monitor.py") -eq 'new') -and (@($r.calls | Where-Object { $_ -like 'enable *' -or $_ -like 'start *' }).Count -eq 0)
if ($ok) { 'PASS outbox changed -> exit 3, nothing restored, tasks stay disabled' } else { $fails++; "FAIL changed rc=$($r.rc)"; $r.out }
Remove-Item -Recurse -Force $tmp
if ($fails -eq 0) { 'SMOKE_OK cases=2' } else { "SMOKE_FAIL $fails"; exit 1 }
