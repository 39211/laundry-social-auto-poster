# Offline OPS-L1-10 integration: actual gate, fake root and fake catchup only.
param([string]$GateScript = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $GateScript) { $GateScript = Join-Path $root 'scripts\publish-time-gate.ps1' }
$fixture = Join-Path $root ('output\operations\ops-l1-gate-' + [guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory((Join-Path $fixture 'data\content-calendar'))
[void][IO.Directory]::CreateDirectory((Join-Path $fixture 'data\posted-log'))
[void][IO.Directory]::CreateDirectory((Join-Path $fixture 'scripts'))
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $fixture 'data\content-calendar\2026-11-01.json'), '{"date":"2026-11-01","slots":[{"slot":1},{"slot":2}]}', $utf8)
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\catchup-publish.ps1'), '# fixture only', $utf8)
$stub = Join-Path $fixture 'catchup.cmd'
[IO.File]::WriteAllText($stub, "@echo off`r`necho CALLED>> `"%~dp0calls.txt`"`r`nexit /b 0`r`n", [Text.Encoding]::ASCII)
$env:PUBLISH_GATE_DATE = '2026-11-01'
$env:PUBLISH_GATE_TIME = '11:50'
$env:PUBLISH_GATE_CATCHUP_CMD = $stub
$env:PUBLISH_GATE_TOAST_FILE = Join-Path $fixture 'toasts.txt'
$posted = Join-Path $fixture 'data\posted-log\2026-11-01.json'
[IO.File]::WriteAllText($posted, '[{"slot":1,"platform":"instagram","status":"success","dry_run":false},{"slot":1,"platform":"facebook","status":"uncertain","dry_run":false}]', $utf8)
$runner = Join-Path $fixture 'gate-runner.ps1'
[IO.File]::WriteAllText($runner, 'param($GatePath,$FixtureRoot); function Get-CimInstance { [CmdletBinding()] param($ClassName); return @() }; & $GatePath -RootPath $FixtureRoot; exit $LASTEXITCODE', $utf8)
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $runner -GatePath $GateScript -FixtureRoot $fixture
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $fixture 'calls.txt'))) {
    Write-Output 'CASE_FAIL FB_UNCERTAIN_IG_SUCCESS_WAS_SILENT'
    exit 1
}
Write-Output 'CASE_OK FB_UNCERTAIN_IG_SUCCESS_CALLS_RECOVERY'
# All files are synthetic and retained under the assigned worktree as evidence.
