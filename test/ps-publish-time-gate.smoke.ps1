$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$gate = Join-Path $root "scripts\publish-time-gate.ps1"
$register = Join-Path $root "scripts\register-publish-time-gate-task.ps1"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("publish-gate-smoke-" + [guid]::NewGuid().ToString("n"))
$stub = Join-Path $tempRoot "gate-catchup.cmd"
$stubText = @'
@echo off
echo CATCHUP>> "%~dp0calls.txt"
exit /b 0
'@

function Write-Utf8([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    [void][IO.Directory]::CreateDirectory($parent)
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Invoke-GateCase {
    param([string]$Name, [string]$Time, [string]$Posted = "", [string]$Calendar = '{"slots":[{"slot":1},{"slot":2}]}', [string]$PublishTimes = "", [string]$TriggerLog = "")
    $caseRoot = Join-Path $tempRoot $Name
    [void][IO.Directory]::CreateDirectory($caseRoot)
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot "probe"))
    $caseStub = Join-Path $caseRoot "gate-catchup.cmd"
    [IO.File]::Copy($stub, $caseStub, $true)
    Write-Utf8 (Join-Path $caseRoot "scripts\catchup-publish.ps1") "# test target"
    Write-Utf8 (Join-Path $caseRoot "data\content-calendar\$date.json") $Calendar
    if ($Posted) { Write-Utf8 (Join-Path $caseRoot "data\posted-log\$date.json") $Posted }
    if ($PublishTimes) { Write-Utf8 (Join-Path $caseRoot "data\publish-times\$date.json") $PublishTimes }
    if ($TriggerLog) { Write-Utf8 (Join-Path $caseRoot "output\catch-up-logs\gate-$date.json") $TriggerLog }
    $toastPath = Join-Path $caseRoot "probe\toasts.log"
    $env:PUBLISH_GATE_ROOT = $caseRoot
    $env:PUBLISH_GATE_DATE = $date
    $env:PUBLISH_GATE_TIME = $Time
    $env:PUBLISH_GATE_CATCHUP_CMD = $caseStub
    $env:PUBLISH_GATE_TOAST_FILE = $toastPath
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $gate -RootPath $caseRoot 2>&1 | Out-String
    $exit = $LASTEXITCODE
    $callsPath = Join-Path $caseRoot "calls.txt"
    [pscustomobject]@{
        ExitCode = $exit
        Output = $output
        Calls = if (Test-Path -LiteralPath $callsPath) { [IO.File]::ReadAllText($callsPath, [Text.UTF8Encoding]::new($false)) } else { "" }
        Toast = if (Test-Path -LiteralPath $toastPath) { [IO.File]::ReadAllText($toastPath, [Text.UTF8Encoding]::new($false)) } else { "" }
        TriggerLog = if (Test-Path -LiteralPath (Join-Path $caseRoot "output\catch-up-logs\gate-$date.json")) { [IO.File]::ReadAllText((Join-Path $caseRoot "output\catch-up-logs\gate-$date.json"), [Text.UTF8Encoding]::new($false)) } else { "" }
        TextLog = if (Test-Path -LiteralPath (Join-Path $caseRoot "output\catch-up-logs\gate-$date.log")) { [IO.File]::ReadAllText((Join-Path $caseRoot "output\catch-up-logs\gate-$date.log"), [Text.UTF8Encoding]::new($false)) } else { "" }
    }
}

$date = "2026-10-06"
$saved = @{}
foreach ($key in @("PUBLISH_GATE_ROOT", "PUBLISH_GATE_DATE", "PUBLISH_GATE_TIME", "PUBLISH_GATE_CATCHUP_CMD", "PUBLISH_GATE_TOAST_FILE")) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
$script:failed = $false
function Assert-GateCase([string]$Name, [bool]$Ok, [string]$Evidence) {
    if (-not $Ok) { Write-Output ("CASE_FAIL name={0} evidence={1}" -f $Name, $Evidence); $script:failed = $true }
    else { Write-Output ("CASE_OK name={0} evidence={1}" -f $Name, $Evidence) }
}

try {
    [void][IO.Directory]::CreateDirectory($tempRoot)
    [IO.File]::WriteAllText($stub, $stubText, [Text.Encoding]::ASCII)

    $due = Invoke-GateCase -Name "due-unposted" -Time "11:45"
    Assert-GateCase "due-unposted-calls-once" ($due.ExitCode -eq 0 -and ([regex]::Matches($due.Calls, "CATCHUP")).Count -eq 1) $due.TextLog.Trim()

    $notDue = Invoke-GateCase -Name "not-due" -Time "11:29"
    Assert-GateCase "not-due-no-call" ($notDue.ExitCode -eq 0 -and -not $notDue.Calls.Contains("CATCHUP")) $notDue.TextLog.Trim()

    $liveIg = '[{"slot":1,"platform":"instagram","status":"success","dry_run":false}]'
    $posted = Invoke-GateCase -Name "instagram-already-posted" -Time "11:45" -Posted $liveIg
    Assert-GateCase "instagram-posted-no-call" ($posted.ExitCode -eq 0 -and -not $posted.Calls.Contains("CATCHUP")) $posted.TextLog.Trim()

    $dryIg = '[{"slot":1,"platform":"instagram","status":"success","dry_run":true}]'
    $dryOnly = Invoke-GateCase -Name "instagram-dry-run-only" -Time "11:45" -Posted $dryIg
    Assert-GateCase "instagram-dry-run-still-needs-publish" ($dryOnly.ExitCode -eq 0 -and ([regex]::Matches($dryOnly.Calls, "CATCHUP")).Count -eq 1) $dryOnly.TextLog.Trim()

    $earlyEveningTimes = '{"date":"2026-10-06","slots":[{"slot":2,"time":"19:07","arm":"early-evening"}]}'
    $eveningDue = Invoke-GateCase -Name "early-evening-due-unposted" -Time "19:10" -PublishTimes $earlyEveningTimes
    Assert-GateCase "early-evening-due-unposted-calls-once" ($eveningDue.ExitCode -eq 0 -and ([regex]::Matches($eveningDue.Calls, "CATCHUP")).Count -eq 1) $eveningDue.TextLog.Trim()

    $postedEveningIg = '[{"slot":2,"platform":"instagram","status":"success","dry_run":false}]'
    $eveningPosted = Invoke-GateCase -Name "early-evening-instagram-already-posted" -Time "19:10" -Posted $postedEveningIg -PublishTimes $earlyEveningTimes
    Assert-GateCase "early-evening-posted-no-call" ($eveningPosted.ExitCode -eq 0 -and -not $eveningPosted.Calls.Contains("CATCHUP")) $eveningPosted.TextLog.Trim()

    $repeatName = "retry-window-and-limit"
    $first = Invoke-GateCase -Name $repeatName -Time "11:45"
    $early = Invoke-GateCase -Name $repeatName -Time "12:14"
    $second = Invoke-GateCase -Name $repeatName -Time "12:15"
    $third = Invoke-GateCase -Name $repeatName -Time "12:45"
    $totalCalls = [regex]::Matches($third.Calls, "CATCHUP").Count
    $records = @(($third.TriggerLog | ConvertFrom-Json).triggers)
    Assert-GateCase "second-trigger-waits-30m-third-blocked" ($first.ExitCode -eq 0 -and $early.ExitCode -eq 0 -and $second.ExitCode -eq 0 -and $third.ExitCode -eq 0 -and $totalCalls -eq 2 -and $records.Count -eq 2 -and $records[1].attempt -eq 2) ("calls={0}; records={1}" -f $totalCalls, $records.Count)

    $assigned = '{"date":"2026-10-06","experiment":"afternoon-vs-usual-2026-10","assigned_at":"2026-10-03T13:40:12.345Z","slots":[{"slot":1,"time":"14:12","arm":"afternoon"}]}'
    $expired = Invoke-GateCase -Name "four-hour-boundary" -Time "18:12" -PublishTimes $assigned
    Assert-GateCase "four-hour-window-is-exclusive-at-end" ($expired.ExitCode -eq 0 -and -not $expired.Calls.Contains("CATCHUP")) $expired.TextLog.Trim()

    $missingSlot1 = Invoke-GateCase -Name "calendar-missing-slot1" -Time "12:00" -Calendar '{"date":"2026-10-06","slots":[{"slot":2}]}'
    Assert-GateCase "calendar-missing-slot1-still-due-and-hard-fails" ($missingSlot1.ExitCode -eq 1 -and -not $missingSlot1.Calls.Contains("CATCHUP") -and $missingSlot1.TextLog.Contains("mandatory due slot(s) still included: 1") -and $missingSlot1.Toast.Contains("缺少必備 slot 1")) $missingSlot1.TextLog.Trim()

    $processTarget = Join-Path $tempRoot "scripts\catchup-publish.ps1"
    $registerText = [IO.File]::ReadAllText($gate, [Text.UTF8Encoding]::new($false))
    $functionStart = $registerText.IndexOf("function Test-CatchupProcessRunning")
    $functionEnd = $registerText.IndexOf("`nfunction ", $functionStart + 1)
    if ($functionEnd -lt 0) { $functionEnd = $registerText.IndexOf("`n`$calendarSlots", $functionStart + 1) }
    $processFunction = $registerText.Substring($functionStart, $functionEnd - $functionStart)
    . ([scriptblock]::Create($processFunction))
    $processes = @([pscustomobject]@{ ProcessId = 99999; CommandLine = "powershell.exe -File `"$processTarget`"" })
    $running = Test-CatchupProcessRunning -Processes $processes -CatchupPath $processTarget -CurrentProcessId 5
    $selfOnly = Test-CatchupProcessRunning -Processes (@([pscustomobject]@{ ProcessId = 5; CommandLine = "powershell.exe -File `"$processTarget`"" })) -CatchupPath $processTarget -CurrentProcessId 5
    Assert-GateCase "exact-catchup-process-path-detection" ($running -and -not $selfOnly) ("other={0}; self={1}" -f $running, $selfOnly)

    $whatIfOutput = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $register -RootPath $tempRoot -WhatIf 2>&1 | Out-String
    $whatIfExit = $LASTEXITCODE
    $registerSource = [IO.File]::ReadAllText($register, [Text.UTF8Encoding]::new($false))
    $hasHiddenAction = $whatIfOutput.Contains("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File")
    $hasTriggers = $whatIfOutput.Contains("trigger=daily at 14:00") -and $whatIfOutput.Contains("repetition=PT5M for PT6H") -and $whatIfOutput.Contains("trigger=daily at 16:40") -and $whatIfOutput.Contains("repetition=none")
    $hasCommonSettings = $whatIfOutput.Contains("AllowStartIfOnBatteries:True") -and $whatIfOutput.Contains("DontStopIfGoingOnBatteries:True") -and $whatIfOutput.Contains("WakeToRun:True") -and $whatIfOutput.Contains("MultipleInstances:IgnoreNew") -and $whatIfOutput.Contains("ExecutionTimeLimit:PT2H")
    Assert-GateCase "register-whatif-only-two-names" ($whatIfExit -eq 0 -and $whatIfOutput.Contains("Laundry-Publish-Time-Gate") -and $whatIfOutput.Contains("Laundry-Publish-Sentinel-Afternoon") -and $hasHiddenAction -and $hasTriggers -and $hasCommonSettings -and ([regex]::Matches($registerSource, "Register-ScheduledTask")).Count -eq 1 -and $registerSource.IndexOf("if (`$WhatIfPreference)") -lt $registerSource.IndexOf("Register-ScheduledTask")) $whatIfOutput.Trim()
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], "Process") }
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($tempRoot)
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected Temp fixture path" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

if ($script:failed) { Write-Output "SMOKE_FAIL"; exit 1 }
Write-Output "SMOKE_OK"
