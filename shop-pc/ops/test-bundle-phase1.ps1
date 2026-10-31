# Smoke test for bundle-phase1.ps1 on any PC. No real task, process or port is touched:
# a patched copy stubs the ScheduledTask / CIM / Stop-Process / NetTCP cmdlets and points at a temp fake root.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = [IO.File]::ReadAllText((Join-Path $here 'bundle-phase1.ps1'))
$pyExe = (Get-Command python).Source
$tmp = Join-Path $env:TEMP ('bp1-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null

$stubs = @'
function Get-ScheduledTask { param($TaskPath, $TaskName) [pscustomobject]@{ TaskPath = '\'; TaskName = $TaskName; Settings = [pscustomobject]@{ Enabled = $true }; State = 'Ready' } }
function Disable-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:T_LOG "disable $TaskName"; 'x' }
function Enable-ScheduledTask { param($TaskPath, $TaskName) Add-Content -LiteralPath $env:T_LOG "enable $TaskName"; 'x' }
function Start-ScheduledTask { param($TaskName) Add-Content -LiteralPath $env:T_LOG "start $TaskName" }
function Get-CimInstance { param($ClassName, $Filter) @() }
function Stop-Process { param($Id, [switch]$Force) Add-Content -LiteralPath $env:T_LOG "stop $Id" }
function Get-NetTCPConnection { param($LocalPort, $State, $ErrorAction) $null }
'@
$patched = $src
$patched = $patched.Replace("function Say(`$m) {", $stubs + "`r`nfunction Say(`$m) {")
$patched = $patched.Replace("`$root = 'C:\LaundryStores\fxwash'", "`$root = `$env:T_ROOT")
$patched = $patched.Replace("`$py = 'C:\LaundryStores\python-portable\python.exe'", "`$py = `$env:T_PY")
$patched = $patched.Replace("`$stage = `"C:\LaundryStores\`$Bundle-staging`"", "`$stage = `$env:T_STAGE")
$patched = $patched.Replace("assert sys.version_info[:2] == (3, 11)", "assert sys.version_info[:2] >= (3, 11)")
$patched = $patched.Replace("`$now = Get-Date", "`$now = if (`$env:T_NOW) { [datetime]`$env:T_NOW } else { Get-Date }")
$patched = $patched.Replace("`$c = `$cfg[`$Bundle]", "`$c = `$cfg[`$Bundle]; if (`$env:T_CFG) { . `$env:T_CFG }")
foreach ($needle in @('$env:T_ROOT', '$env:T_PY', '$env:T_STAGE', '$env:T_NOW', '$env:T_CFG', 'function Get-CimInstance', '>= (3, 11)')) {
  if (-not $patched.Contains($needle)) { throw "patch failed: $needle" }
}
$script = Join-Path $tmp 'bp1-under-test.ps1'
[IO.File]::WriteAllText($script, $patched)

function New-Case([string]$name) {
  $d = Join-Path $tmp $name
  $root = Join-Path $d 'root'; $stage = Join-Path $d 'stage'
  foreach ($p in @("$root\runtime", "$root\data", "$root\backups", "$stage\runtime")) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
  [IO.File]::WriteAllText("$root\shop.json", '{"x":1}')
  [IO.File]::WriteAllText("$root\runtime\svc.py", "old = 1`n")
  [IO.File]::WriteAllText("$root\runtime\test_ok.py", "import unittest`nclass T(unittest.TestCase):`n    def test_ok(self):`n        pass`n")
  [IO.File]::WriteAllText("$root\data\state.json", '{"s":1}')
  [IO.File]::WriteAllText("$stage\runtime\svc.py", "new = 2`n")
  [IO.File]::WriteAllText("$stage\runtime\test_new.py", "x = 1`n")
  return @{ dir = $d; root = $root; stage = $stage; log = (Join-Path $d 'calls.log') }
}
function Sha($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Run-Case($k, [string]$cfgBody, [string]$now = '2026-10-31 11:00:00', [switch]$CheckOnly) {
  $cfgFile = Join-Path $k.dir 'cfg.ps1'
  [IO.File]::WriteAllText($cfgFile, $cfgBody)
  $env:T_ROOT = $k.root; $env:T_PY = $pyExe; $env:T_STAGE = $k.stage; $env:T_NOW = $now; $env:T_CFG = $cfgFile; $env:T_LOG = $k.log
  New-Item -ItemType File -Force -Path $k.log | Out-Null
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Bundle', 'A3-2')
  if ($CheckOnly) { $a += '-CheckOnly' }
  $out = & powershell.exe @a 2>&1 | ForEach-Object { $_.ToString() }
  return @{ rc = $LASTEXITCODE; out = ($out -join "`n"); calls = (Get-Content -LiteralPath $k.log) }
}
function Cfg($k, [string]$tests = "@(, @('-c', 'print(1)'))", [string]$requires = '@{}', [string]$svcHash = '') {
  if (-not $svcHash) { $svcHash = Sha "$($k.stage)\runtime\svc.py" }
  $tn = Sha "$($k.stage)\runtime\test_new.py"
  return "`$c = @{ expected = [ordered]@{ 'runtime\svc.py' = '$svcHash'; 'runtime\test_new.py' = '$tn' }; requires = $requires; stop = @('inbound_monitor'); tests = $tests; imports = 'json'; state = @('data\state.json') }"
}
$fails = 0; $n = 0
function Check([string]$name, [bool]$cond, $res) {
  $script:n++
  if ($cond) { Write-Output "PASS $name" } else { $script:fails++; Write-Output "FAIL $name rc=$($res.rc)"; Write-Output $res.out }
}

# 1 CheckOnly ok, zero writes
$k = New-Case 'c1'; $r = Run-Case $k (Cfg $k) -CheckOnly
Check 'checkonly ok + no backup' (($r.rc -eq 0) -and (@(Get-ChildItem "$($k.root)\backups").Count -eq 0) -and ((Get-Content "$($k.root)\runtime\svc.py") -eq 'old = 1')) $r
# 2 staging hash mismatch -> 2
$k = New-Case 'c2'; $r = Run-Case $k (Cfg $k -svcHash ('0' * 64))
Check 'staging hash mismatch refused' (($r.rc -eq 2) -and ($r.out -match 'staging hash mismatch') -and (@(Get-ChildItem "$($k.root)\backups").Count -eq 0)) $r
# 3 requires mismatch -> 2
$k = New-Case 'c3'; $r = Run-Case $k (Cfg $k -requires ("@{ 'runtime\svc.py' = '" + ('A' * 64) + "' }"))
Check 'requires mismatch refused' (($r.rc -eq 2) -and ($r.out -match 'REFUSED requires runtime\\svc.py')) $r
# 3b requires match passes
$k = New-Case 'c3b'; $live = Sha "$($k.root)\runtime\svc.py"; $r = Run-Case $k (Cfg $k -requires "@{ 'runtime\svc.py' = '$live' }") -CheckOnly
Check 'requires match ok' (($r.rc -eq 0) -and ($r.out -match 'requires OK')) $r
# 4 outside window -> 2
$k = New-Case 'c4'; $r = Run-Case $k (Cfg $k) -now '2026-10-31 19:45:00'
Check 'outside window refused' (($r.rc -eq 2) -and ($r.out -match 'outside 10:00-19:30')) $r
# 5 happy path
$k = New-Case 'c5'; $r = Run-Case $k (Cfg $k)
$bk = @(Get-ChildItem "$($k.root)\backups" -Directory)
$ok5 = ($r.rc -eq 0) -and ((Get-Content "$($k.root)\runtime\svc.py") -eq 'new = 2') -and (Test-Path "$($k.root)\runtime\test_new.py") -and ($bk.Count -eq 1)
if ($ok5) { $ok5 = ((Get-Content "$($bk[0].FullName)\runtime\svc.py") -eq 'old = 1') -and (Test-Path "$($bk[0].FullName)\data\state.json") -and (Test-Path "$($bk[0].FullName)\tasks-before.xml") }
$ok5 = $ok5 -and (@($r.calls | Where-Object { $_ -like 'disable *' }).Count -eq 2) -and (@($r.calls | Where-Object { $_ -like 'enable *' }).Count -eq 0) -and ($r.out -match 'PHASE1 OK')
Check 'happy path: replaced, backup, tasks disabled (phase2 re-enables)' $ok5 $r
# 6 test failure -> rollback
$k = New-Case 'c6'; $r = Run-Case $k (Cfg $k -tests "@(, @('-c', 'import sys; sys.exit(1)'))")
$ok6 = ($r.rc -eq 1) -and ((Get-Content "$($k.root)\runtime\svc.py") -eq 'old = 1') -and (-not (Test-Path "$($k.root)\runtime\test_new.py")) -and ($r.out -match 'retry once') -and ($r.out -match 'ROLLED BACK')
$ok6 = $ok6 -and (@($r.calls | Where-Object { $_ -like 'enable *' }).Count -eq 2) -and ($r.calls -contains 'start FXwash-Watchdog') -and ((Get-Content "$($k.root)\data\state.json") -eq '{"s":1}')
Check 'test failure: retried once, files rolled back, tasks re-enabled, watchdog kicked' $ok6 $r
# 7 retry once then pass
$k = New-Case 'c7'; $flag = Join-Path $k.dir 'flag'
$code = "import os,sys; f=r'$flag'; e=os.path.exists(f); open(f,'w').close(); sys.exit(0 if e else 1)"
$r = Run-Case $k (Cfg $k -tests "@(, @('-c', `"$code`"))")
Check 'flaky test passes on retry' (($r.rc -eq 0) -and ($r.out -match 'retry once') -and ($r.out -match 'PHASE1 OK')) $r
# 8 import failure -> rollback
$k = New-Case 'c8'; $cfg8 = (Cfg $k).Replace("imports = 'json'", "imports = 'no_such_module_xyz'"); $r = Run-Case $k $cfg8
Check 'import failure rolls back' (($r.rc -eq 1) -and ((Get-Content "$($k.root)\runtime\svc.py") -eq 'old = 1') -and ($r.out -match 'module import failed')) $r

Remove-Item -Recurse -Force $tmp
if ($fails -eq 0) { Write-Output "SMOKE_OK cases=$n" } else { Write-Output "SMOKE_FAIL $fails/$n"; exit 1 }
