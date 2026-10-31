#requires -Version 5.1
# Offline checks for attribution_weekly.ps1 against temp fake roots with stub CLIs.
# Never touches C:\LaundryStores\fxwash data; everything lives under %TEMP%\attr-weekly-test-*.
[CmdletBinding()]
param([string]$Python = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
$script:failed = 0
function Assert-True($Condition, [string]$Name) {
    if ($Condition) { $script:passed++; Write-Output "PASS $Name" }
    else { $script:failed++; Write-Output "FAIL $Name" }
}

$weekly = Join-Path $PSScriptRoot 'attribution_weekly.ps1'
$powershell = Join-Path $PSHOME 'powershell.exe'

$tokens = $null; $errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($weekly, [ref]$tokens, [ref]$errors)
Assert-True ($errors.Count -eq 0) 'parse attribution_weekly.ps1'
foreach ($path in @($weekly, $MyInvocation.MyCommand.Path)) {
    $bytes = [IO.File]::ReadAllBytes($path)
    Assert-True (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0) ((Split-Path -Leaf $path) + ' is ASCII only')
}

if (-not $Python) {
    $found = @(Get-Command -Name python.exe -CommandType Application -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -notmatch '\\WindowsApps\\' })
    if ($found.Count -gt 0) { $Python = $found[0].Source }
    elseif ([IO.File]::Exists('C:\LaundryStores\python-portable\python.exe')) { $Python = 'C:\LaundryStores\python-portable\python.exe' }
}
if (-not $Python) {
    Write-Output 'FAIL python interpreter found (pass -Python <path to python.exe>)'
    exit 1
}
Write-Output ('INFO python: ' + $Python)

$stubTemplate = @'
import os, sys
code = int(os.environ.get("__VAR__", "0"))
with open(os.path.join("data", "stub_calls.txt"), "a") as f:
    f.write("__NAME__|" + " ".join(sys.argv[1:]) + "|flags=%d%d%d\n" % tuple(int(x in sys.orig_argv[1:len(sys.orig_argv) - len(sys.argv)]) for x in ("-I", "-S", "-B")))
print("first stdout line NOISE-NOT-SUMMARY")
print("__NAME__ summary rows=4 kept=2 exit=%d" % code)
sys.stderr.write("ROW-CONTENT-MUST-NOT-BE-LOGGED\n")
sys.exit(code)
'@

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$root = Join-Path $tempBase ('attr-weekly-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)

function New-FakeRoot([string]$Name) {
    $caseRoot = Join-Path $root $Name
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot 'runtime'))
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot 'data'))
    $map = @{ export = 'ATTR_TEST_EXPORT_EXIT'; retention = 'ATTR_TEST_RETENTION_EXIT' }
    foreach ($step in @('export', 'retention')) {
        $text = $stubTemplate.Replace('__NAME__', $step).Replace('__VAR__', $map[$step])
        [IO.File]::WriteAllText((Join-Path $caseRoot ('runtime\attribution_' + $step + '.py')), $text, [Text.Encoding]::ASCII)
    }
    return $caseRoot
}

function Invoke-Weekly([string]$CaseRoot, [int]$ExportExit, [int]$RetentionExit) {
    $env:ATTR_TEST_EXPORT_EXIT = [string]$ExportExit
    $env:ATTR_TEST_RETENTION_EXIT = [string]$RetentionExit
    $ErrorActionPreference = 'Continue'
    $null = & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $weekly -Root $CaseRoot -Python $Python
    return $LASTEXITCODE
}

function Get-LogLines([string]$CaseRoot) {
    $log = Join-Path $CaseRoot 'logs\attribution_weekly.log'
    if (-not [IO.File]::Exists($log)) { return }
    [IO.File]::ReadAllLines($log) | Where-Object { $_.Length -gt 0 }
}

function Get-Calls([string]$CaseRoot) {
    $calls = Join-Path $CaseRoot 'data\stub_calls.txt'
    if (-not [IO.File]::Exists($calls)) { return }
    [IO.File]::ReadAllLines($calls) | Where-Object { $_.Length -gt 0 }
}

try {
    $cases = @(
        @{ name = 'export0-retention0'; e = 0; r = 0; code = 0; steps = @('export', 'retention') },
        @{ name = 'export2-retention0'; e = 2; r = 0; code = 0; steps = @('export', 'retention') },
        @{ name = 'export1-skip';       e = 1; r = 0; code = 1; steps = @('export') },
        @{ name = 'export0-retention3'; e = 0; r = 3; code = 3; steps = @('export', 'retention') },
        @{ name = 'export0-retention1'; e = 0; r = 1; code = 1; steps = @('export', 'retention') }
    )
    foreach ($case in $cases) {
        $n = $case.name
        $caseRoot = New-FakeRoot $n
        $code = Invoke-Weekly $caseRoot $case.e $case.r
        Assert-True ($code -eq $case.code) "$n exit $($case.code) (got $code)"
        $lines = @(Get-LogLines $caseRoot)
        Assert-True ($lines.Count -eq $case.steps.Count) "$n log has exactly one line per step run"
        foreach ($step in @('export', 'retention')) {
            $count = @($lines | Where-Object { $_ -match (' step=' + $step + ' ') }).Count
            $want = if ($case.steps -contains $step) { 1 } else { 0 }
            Assert-True ($count -eq $want) "$n log lines for $step = $want"
        }
        $calls = @(Get-Calls $caseRoot)
        $names = @($calls | ForEach-Object { $_.Split('|')[0] })
        Assert-True (($names -join ',') -ceq ($case.steps -join ',')) "$n steps ran in order: $($case.steps -join ',')"
        Assert-True (@($calls | Where-Object { $_.Split('|')[1] -cne '--root .' }).Count -eq 0) "$n CLI args are exactly --root . (no --week)"
        Assert-True (@($calls | Where-Object { $_.Split('|')[2] -cne 'flags=111' }).Count -eq 0) "$n python runs with -I -S -B"
        $exportLine = @($lines | Where-Object { $_ -match ' step=export ' })
        Assert-True ($exportLine.Count -eq 1 -and $exportLine[0] -match ('^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} step=export exit=' + $case.e + ' summary=export summary rows=4 kept=2 exit=' + $case.e + ' stderr_lines=1$')) "$n export line = timestamp, step, exit, CLI summary"
        $text = $lines -join "`n"
        Assert-True ($text -notmatch 'ROW-CONTENT' -and $text -notmatch 'NOISE') "$n stderr and non-summary output not logged"
        Assert-True (-not [IO.File]::Exists((Join-Path $caseRoot 'data\attribution_weekly.lock'))) "$n lock released"
    }

    $caseRoot = New-FakeRoot 'fresh-lock'
    $lockPath = Join-Path $caseRoot 'data\attribution_weekly.lock'
    [IO.File]::WriteAllText($lockPath, 'pid=1 test-held')
    $code = Invoke-Weekly $caseRoot 0 0
    Assert-True ($code -ne 0) "fresh lock: run exits non-zero (got $code)"
    Assert-True (@(Get-Calls $caseRoot).Count -eq 0) 'fresh lock: neither step ran'
    $lines = @(Get-LogLines $caseRoot)
    Assert-True (@($lines | Where-Object { $_ -match ' step=(export|retention) ' }).Count -eq 0) 'fresh lock: no step lines logged'
    Assert-True ([IO.File]::Exists($lockPath) -and [IO.File]::ReadAllText($lockPath) -eq 'pid=1 test-held') 'fresh lock: the other run lock is left untouched'

    $caseRoot = New-FakeRoot 'stale-lock'
    $lockPath = Join-Path $caseRoot 'data\attribution_weekly.lock'
    [IO.File]::WriteAllText($lockPath, 'pid=1 crashed-run')
    [IO.File]::SetLastWriteTimeUtc($lockPath, [DateTime]::UtcNow.AddHours(-3))
    $code = Invoke-Weekly $caseRoot 0 0
    Assert-True ($code -eq 0) "stale lock: taken over, exit 0 (got $code)"
    Assert-True (@(Get-Calls $caseRoot).Count -eq 2) 'stale lock: both steps ran'
    $lines = @(Get-LogLines $caseRoot)
    Assert-True ($lines.Count -eq 2 -and $lines[0] -match 'stale lock taken over') 'stale lock: takeover noted in export line'
    Assert-True (-not [IO.File]::Exists($lockPath)) 'stale lock: lock released after run'
}
catch {
    Write-Output ('FAIL unexpected error: ' + $_.Exception.Message)
    $script:failed++
}
finally {
    Remove-Item Env:\ATTR_TEST_EXPORT_EXIT -ErrorAction SilentlyContinue
    Remove-Item Env:\ATTR_TEST_RETENTION_EXIT -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith($tempBase) -and (Split-Path -Leaf $resolved) -like 'attr-weekly-test-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Output "RESULT PASS=$script:passed FAIL=$script:failed"
if ($script:failed -gt 0) { exit 1 }
exit 0
