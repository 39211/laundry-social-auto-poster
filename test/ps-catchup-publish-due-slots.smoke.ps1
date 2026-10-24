$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$productionSource = Join-Path $root "scripts\catchup-publish.ps1"
$slotTimesSource = Join-Path $root "scripts\publish-slot-times.ps1"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("catchup-due-smoke-" + [guid]::NewGuid().ToString("n"))
$isolatedScripts = Join-Path $tempRoot "scripts"
$production = Join-Path $isolatedScripts "catchup-publish.ps1"
$binRoot = Join-Path $tempRoot "bin"
$stub = Join-Path $binRoot "npm.cmd"
$stubText = @'
@echo off
echo %*>> "%CATCHUP_PUBLISH_COMMANDS%"
exit /b 0
'@

function Write-Utf8([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    [void][IO.Directory]::CreateDirectory($parent)
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Write-Utf8Bom([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    [void][IO.Directory]::CreateDirectory($parent)
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($true))
}

function Assert-Case([string]$Name, [bool]$Ok, [string]$Evidence) {
    if (-not $Ok) { Write-Output ("CASE_FAIL name={0} evidence={1}" -f $Name, $Evidence); $script:failed = $true }
    else { Write-Output ("CASE_OK name={0} evidence={1}" -f $Name, $Evidence) }
}

function Invoke-CatchupCase {
    param([string]$Name, [string]$Date, [string]$Time, [string]$Calendar, [string]$Approved, [string]$Posted = "[]", [string]$PublishTimes = "", [bool]$PublishTimesBom = $false, [string]$VideoQueue = "", [bool]$PlanOnly = $false)
    $caseRoot = Join-Path $tempRoot $Name
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot "probe"))
    Write-Utf8 (Join-Path $caseRoot "data\content-calendar\$Date.json") $Calendar
    Write-Utf8 (Join-Path $caseRoot "data\approved-log\$Date.json") $Approved
    Write-Utf8 (Join-Path $caseRoot "data\posted-log\$Date.json") $Posted
    Write-Utf8 (Join-Path $caseRoot "output\operations\indexing-push-$Date.json") '{"ok":true}'
    if ($PublishTimes) {
        $publishTimesPath = Join-Path $caseRoot "data\publish-times\$Date.json"
        if ($PublishTimesBom) { Write-Utf8Bom $publishTimesPath $PublishTimes }
        else { Write-Utf8 $publishTimesPath $PublishTimes }
    }
    if ($VideoQueue) { Write-Utf8 (Join-Path $caseRoot "data\video-repair-queue\queue.json") $VideoQueue }
    $toast = Join-Path $caseRoot "probe\toasts.log"
    $commands = Join-Path $caseRoot "probe\commands.log"
    if (Test-Path -LiteralPath $commands) { Remove-Item -LiteralPath $commands -Force }
    $env:CATCHUP_PUBLISH_ROOT = $caseRoot
    $env:CATCHUP_PUBLISH_DATE = $Date
    $env:CATCHUP_PUBLISH_TIME = $Time
    $env:CATCHUP_PUBLISH_TOAST_FILE = $toast
    $env:CATCHUP_PUBLISH_PLAN_ONLY = if ($PlanOnly) { "true" } else { "false" }
    $env:CATCHUP_PUBLISH_COMMANDS = $commands
    $env:PATH = "$binRoot;$savedPath"
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $production 2>&1 | Out-String
    $exit = $LASTEXITCODE
    $logPath = Join-Path $caseRoot "output\catch-up-logs\$Date.log"
    [pscustomobject]@{
        ExitCode = $exit
        Output = $output
        Toast = if (Test-Path -LiteralPath $toast) { [IO.File]::ReadAllText($toast, [Text.UTF8Encoding]::new($false)) } else { "" }
        Commands = if (Test-Path -LiteralPath $commands) { [IO.File]::ReadAllText($commands, [Text.UTF8Encoding]::new($false)) } else { "" }
        Log = if (Test-Path -LiteralPath $logPath) { [IO.File]::ReadAllText($logPath, [Text.UTF8Encoding]::new($false)) } else { "" }
        DailyTimesExists = Test-Path -LiteralPath (Join-Path $caseRoot "data\publish-times\$Date.json")
    }
}

$savedPath = $env:PATH
$saved = @{}
foreach ($key in @("CATCHUP_PUBLISH_ROOT", "CATCHUP_PUBLISH_DATE", "CATCHUP_PUBLISH_TIME", "CATCHUP_PUBLISH_TOAST_FILE", "CATCHUP_PUBLISH_PLAN_ONLY", "CATCHUP_PUBLISH_COMMANDS")) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}
$script:failed = $false
try {
    [void][IO.Directory]::CreateDirectory($binRoot)
    [void][IO.Directory]::CreateDirectory($isolatedScripts)
    [IO.File]::Copy($productionSource, $production)
    [IO.File]::Copy($slotTimesSource, (Join-Path $isolatedScripts "publish-slot-times.ps1"))
    [IO.File]::WriteAllText((Join-Path $isolatedScripts "_watchdog.ps1"), "", [Text.UTF8Encoding]::new($true))
    [IO.File]::WriteAllText($stub, $stubText, [Text.Encoding]::ASCII)
    $date = "2026-10-06"
    $calendar12 = '{"date":"2026-10-06","slots":[{"slot":1},{"slot":2}]}'
    $approved12 = '[{"slot":1},{"slot":2}]'
    $posted1 = '[{"slot":1,"platform":"instagram","status":"success","dry_run":false},{"slot":1,"platform":"facebook","status":"success","dry_run":false}]'

    $legacyLate = Invoke-CatchupCase -Name "no-slot3-no-false-stale-toast" -Date $date -Time "16:30" -Calendar $calendar12 -Approved $approved12 -Posted $posted1
    Assert-Case "no-slot3-no-false-stale-toast" ($legacyLate.ExitCode -eq 0 -and -not $legacyLate.Toast.Contains("超過補發時限") -and -not $legacyLate.Log.Contains("Slot 3")) ("toast=" + $legacyLate.Toast)

    $assigned = '{"date":"2026-10-06","experiment":"afternoon-vs-usual-2026-10","assigned_at":"2026-10-03T13:40:12.345Z","slots":[{"slot":1,"time":"14:12","arm":"afternoon"}]}'
    $before = Invoke-CatchupCase -Name "assigned-1412-not-due" -Date $date -Time "11:30" -Calendar $calendar12 -Approved $approved12 -PublishTimes $assigned
    Assert-Case "assigned-1412-not-due" ($before.ExitCode -eq 0 -and $before.Log.Contains("No slot is due yet.") -and -not $before.Toast) $before.Log

    $after = Invoke-CatchupCase -Name "assigned-1412-due" -Date $date -Time "14:15" -Calendar '{"date":"2026-10-06","slots":[{"slot":1}]}' -Approved '[{"slot":1}]' -PublishTimes $assigned -PlanOnly $true
    $plan = $null
    try { $plan = $after.Output | ConvertFrom-Json -ErrorAction Stop } catch {}
    Assert-Case "assigned-1412-due" ($after.ExitCode -eq 0 -and $null -ne $plan -and (@($plan.due_slots) -join ",") -eq "1") $after.Output.Trim()

    $earlyEveningTimes = '{"date":"2026-10-06","slots":[{"slot":2,"time":"19:07","arm":"early-evening"}]}'
    $eveningDue = Invoke-CatchupCase -Name "early-evening-1907-due-at-1910" -Date $date -Time "19:10" -Calendar $calendar12 -Approved $approved12 -PublishTimes $earlyEveningTimes -PlanOnly $true
    $eveningPlan = @()
    try { $eveningPlan = @($eveningDue.Output | ConvertFrom-Json -ErrorAction Stop) } catch {}
    $eveningDueSlots = @($eveningPlan[0].due_slots)
    $eveningStaleSlots = @($eveningPlan[0].stale_slots)
    Assert-Case "slot2-early-evening-due-slot1-stale" ($eveningDue.ExitCode -eq 0 -and $eveningDueSlots -join "," -eq "2" -and $eveningStaleSlots -join "," -eq "1") $eveningDue.Output.Trim()

    $beforeEvening = Invoke-CatchupCase -Name "early-evening-1907-not-due-at-1900" -Date $date -Time "19:00" -Calendar $calendar12 -Approved $approved12 -PublishTimes $earlyEveningTimes -PlanOnly $true
    $beforeEveningPlan = @()
    try { $beforeEveningPlan = @($beforeEvening.Output | ConvertFrom-Json -ErrorAction Stop) } catch {}
    $beforeEveningDueSlots = @($beforeEveningPlan[0].due_slots)
    $beforeEveningStaleSlots = @($beforeEveningPlan[0].stale_slots)
    Assert-Case "slot2-not-due-or-stale-before-1907" ($beforeEvening.ExitCode -eq 0 -and $beforeEveningDueSlots.Count -eq 0 -and $beforeEveningStaleSlots -join "," -eq "1") $beforeEvening.Output.Trim()

    $badTimes = '{"date":"2026-10-06","experiment":"afternoon-vs-usual-2026-10","assigned_at":"bad","slots":[{"slot":1,"time":"99:99"}]}'
    $invalidTime = Invoke-CatchupCase -Name "invalid-daily-times-fallback" -Date $date -Time "11:30" -Calendar '{"date":"2026-10-06","slots":[{"slot":1}]}' -Approved '[{"slot":1}]' -PublishTimes $badTimes -PlanOnly $true
    $invalidPlan = $null
    try { $invalidPlan = $invalidTime.Output | ConvertFrom-Json -ErrorAction Stop } catch {}
    Assert-Case "invalid-daily-times-fallback" ($invalidTime.ExitCode -eq 0 -and $invalidTime.Log.Contains("Invalid publish-time file") -and (@($invalidPlan.due_slots) -join ",") -eq "1") $invalidTime.Output.Trim()

    $unreadable = Invoke-CatchupCase -Name "calendar-read-error-fallback" -Date $date -Time "12:30" -Calendar '{bad json' -Approved '[]' -PlanOnly $true
    $fallbackPlan = $null
    try { $fallbackPlan = $unreadable.Output | ConvertFrom-Json -ErrorAction Stop } catch {}
    Assert-Case "calendar-read-error-fallback" ($unreadable.ExitCode -eq 0 -and $unreadable.Log.Contains("Calendar unreadable; falling back to slots 1, 2, 3.") -and (@($fallbackPlan.due_slots) -join ",") -eq "1,3") $unreadable.Output.Trim()

    $bomTimes = '{"date":"2026-10-06","slots":[{"slot":1,"time":"14:12"}]}'
    $bom = Invoke-CatchupCase -Name "utf8-bom-daily-time-file" -Date $date -Time "12:00" -Calendar '{"date":"2026-10-06","slots":[{"slot":1}]}' -Approved '[{"slot":1}]' -PublishTimes $bomTimes -PublishTimesBom $true -PlanOnly $true
    try { $bomPlan = $bom.Output | ConvertFrom-Json -ErrorAction Stop } catch { $bomPlan = $null }
    Assert-Case "utf8-bom-daily-time-file" ($bom.ExitCode -eq 0 -and $null -ne $bomPlan -and @($bomPlan.due_slots).Count -eq 0 -and -not $bom.Log.Contains("Invalid publish-time file")) $bom.Log.Trim()

    $duplicateTimes = '{"date":"2026-10-06","slots":[{"slot":1,"time":"14:12"},{"slot":1,"time":"15:10"}]}'
    $duplicate = Invoke-CatchupCase -Name "duplicate-daily-time-slot" -Date $date -Time "12:00" -Calendar '{"date":"2026-10-06","slots":[{"slot":1}]}' -Approved '[{"slot":1}]' -PublishTimes $duplicateTimes -PlanOnly $true
    try { $duplicatePlan = $duplicate.Output | ConvertFrom-Json -ErrorAction Stop } catch { $duplicatePlan = $null }
    Assert-Case "duplicate-daily-time-slot-rejects-whole-file" ($duplicate.ExitCode -eq 0 -and $null -ne $duplicatePlan -and (@($duplicatePlan.due_slots) -join ",") -eq "1" -and $duplicate.Log.Contains("Invalid publish-time file") -and $duplicate.Log.Contains("duplicate slot 1")) $duplicate.Log.Trim()

    $missingSlot1 = Invoke-CatchupCase -Name "calendar-missing-slot1-plan" -Date $date -Time "12:30" -Calendar '{"date":"2026-10-06","slots":[{"slot":2}]}' -Approved '[{"slot":2}]' -PlanOnly $true
    try { $missingSlot1Plan = $missingSlot1.Output | ConvertFrom-Json -ErrorAction Stop } catch { $missingSlot1Plan = $null }
    Assert-Case "calendar-missing-slot1-still-due" ($missingSlot1.ExitCode -eq 0 -and $null -ne $missingSlot1Plan -and (@($missingSlot1Plan.due_slots) -join ",") -eq "1") $missingSlot1.Output.Trim()

    $missingSlot1Failure = Invoke-CatchupCase -Name "calendar-missing-slot1-hard-failure" -Date $date -Time "12:30" -Calendar '{"date":"2026-10-06","slots":[{"slot":2}]}' -Approved '[{"slot":2}]'
    Assert-Case "calendar-missing-required-slot-hard-fails" ($missingSlot1Failure.ExitCode -eq 1 -and $missingSlot1Failure.Toast.Contains("缺少必備 slot 1") -and -not $missingSlot1Failure.Log.Contains("Running post-current-slot")) $missingSlot1Failure.Log.Trim()

    $posted12 = '[{"slot":1,"platform":"instagram","status":"success","dry_run":false},{"slot":1,"platform":"facebook","status":"success","dry_run":false},{"slot":2,"platform":"instagram","status":"success","dry_run":false},{"slot":2,"platform":"facebook","status":"success","dry_run":false}]'
    $openVideo = '[{"source_date":"2026-10-06","source_slot":2,"status":"VIDEO_DEFERRED","defer_kind":"review","dry_run":false}]'
    $lateAssigned = '{"date":"2026-10-06","slots":[{"slot":2,"time":"15:10"}]}'
    $lateWithTimes = Invoke-CatchupCase -Name "late-assigned-no-due-evening-closeout" -Date $date -Time "20:35" -Calendar $calendar12 -Approved $approved12 -Posted $posted12 -PublishTimes $lateAssigned -VideoQueue $openVideo
    $lateCommands = @($lateWithTimes.Commands -split "`r?`n" | Where-Object { $_ })
    Assert-Case "late-assigned-no-due-runs-evening-closeout" ($lateWithTimes.ExitCode -eq 0 -and $lateWithTimes.Toast.Contains("有 1 支影片待修復") -and @($lateCommands | Where-Object { $_ -match "run first-comment" }).Count -eq 1 -and @($lateCommands | Where-Object { $_ -match "run share-story" }).Count -eq 1 -and @($lateCommands | Where-Object { $_ -match "run local-reach" }).Count -eq 1) ($lateWithTimes.Log + $lateWithTimes.Commands)

    $defaultLate = Invoke-CatchupCase -Name "default-time-no-file-evening-closeout" -Date $date -Time "20:35" -Calendar $calendar12 -Approved $approved12 -Posted $posted1
    $defaultCommands = @($defaultLate.Commands -split "`r?`n" | Where-Object { $_ })
    Assert-Case "no-daily-time-file-keeps-default-evening-path" ($defaultLate.ExitCode -eq 0 -and -not $defaultLate.DailyTimesExists -and $defaultLate.Log.Contains("Running post-current-slot --slot 2") -and @($defaultCommands | Where-Object { $_ -match "run first-comment" }).Count -eq 1 -and @($defaultCommands | Where-Object { $_ -match "run share-story" }).Count -eq 1 -and @($defaultCommands | Where-Object { $_ -match "run local-reach" }).Count -eq 1) ($defaultLate.Log + $defaultLate.Commands)
} finally {
    $env:PATH = $savedPath
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], "Process") }
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($tempRoot)
    if (-not $resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected Temp fixture path" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

if ($script:failed) { Write-Output "SMOKE_FAIL"; exit 1 }
Write-Output "SMOKE_OK"
