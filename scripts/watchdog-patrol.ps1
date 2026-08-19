# Every-30-minutes patrol. Exists because the publish task keeps getting
# disabled with surgical timing: on 2026-08-07 it was killed in the twenty
# minutes between the 11:15 approval and the 11:35 publish, and the next
# sibling watchdog (14:00) revived it only after every noon trigger was lost.
# That history is not permission to bypass a human stop. The patrol now treats
# disabled, legacy, and dead-trigger state as a hard stop; it never enables or
# re-registers a task. Only an already-approved enabled task may be started in
# a valid recovery window.
[CmdletBinding()]
param(
    [string]$RootOverride,
    [string]$NowOverride,
    [switch]$ObserveOnly
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($RootOverride) { [IO.Path]::GetFullPath($RootOverride) } else { Split-Path -Parent $PSScriptRoot }
$executingCheckout = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$requestedContractRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
if (-not $executingCheckout.Equals($requestedContractRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $fixtureRoot = $requestedContractRoot + '\'
    if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or -not $fixtureRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        [Console]::Error.WriteLine("BLOCKED production contract: RootOverride does not match the executing scripts checkout.")
        exit 1
    }
}
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
try {
    $now = if ($NowOverride) {
        [TimeZoneInfo]::ConvertTime([DateTimeOffset]::Parse($NowOverride), $tz).DateTime
    } else {
        [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    }
} catch {
    throw "Invalid -NowOverride: $NowOverride"
}
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\watchdog-logs"
$logFile = if ($ObserveOnly) { $null } else { Join-Path $logDir "$date.log" }
function Write-PatrolLog([string]$line) {
    if ($ObserveOnly) { Write-Output $line } else { $line | Add-Content -Path $logFile -Encoding UTF8 }
}

. (Join-Path $PSScriptRoot "_production-contract.ps1")
if (-not $ObserveOnly) {
    $productionContract = Test-CleanProductionContract -Root $root
    if (-not $productionContract.ok) {
        [Console]::Error.WriteLine("BLOCKED production contract before watchdog patrol: $($productionContract.reason). No task registration, task start, network, or post action was run.")
        exit 1
    }
    $ProductionContractVerified = $true
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

# Scheduler state is a safety boundary, not a self-healing input. A disabled
# task is a deliberate kill switch; an empty NextRunTime means the trigger is
# unhealthy; and the old inline sentinel is never safe to revive. All three
# conditions require manual review and the explicit guarded registration path.
$script:patrolKnownLaundryTasks = @(
    "Laundry-Daily-Generate",
    "Laundry-Weekly-Review",
    "Laundry-Daily-Approve",
    "Laundry-CatchUp-Publish",
    "Laundry-YouTube-Upload",
    "Laundry-Watchdog-Patrol",
    "Laundry-Reel-Production",
    "Laundry-Day-Audit"
)
$script:patrolScheduledTaskNames = @()
try {
    $patrolTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like "Laundry-*" })
} catch {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler state: Laundry task inventory is unverifiable. No task was enabled, unregistered, or registered. {1}" -f $now, $_.Exception.Message
    Write-PatrolLog $line
    [Console]::Error.WriteLine($line)
    exit 1
}
$script:patrolScheduledTaskNames = @($patrolTasks | ForEach-Object { [string]$_.TaskName })
$legacySentinels = @($patrolTasks | Where-Object { $_.TaskName -ceq "Laundry-Publish-Sentinel" })
if ($legacySentinels.Count -gt 0) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler state: legacy Laundry-Publish-Sentinel is present. Manual review/removal is required; no task was enabled, unregistered, or registered." -f $now
    Write-PatrolLog $line
    [Console]::Error.WriteLine($line)
    exit 1
}
$disabledTasks = @($patrolTasks | Where-Object { $_.State -eq "Disabled" })
if ($disabledTasks.Count -gt 0) {
    $names = ($disabledTasks | ForEach-Object { $_.TaskName }) -join ", "
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler kill switch: disabled Laundry task(s): {1}. Manual review is required; no task was enabled, unregistered, or registered." -f $now, $names
    Write-PatrolLog $line
    [Console]::Error.WriteLine($line)
    exit 1
}
$deadTasks = @()
foreach ($task in $patrolTasks) {
    $info = $null
    try {
        $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -ErrorAction Stop
    } catch {}
    if ($null -eq $info -or $null -eq $info.NextRunTime) { $deadTasks += $task.TaskName }
}
if ($deadTasks.Count -gt 0) {
    $names = ($deadTasks | Sort-Object -Unique) -join ", "
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler trigger health: empty or unverifiable NextRunTime on: {1}. Manual registration/review is required; no task was enabled, unregistered, or registered." -f $now, $names
    Write-PatrolLog $line
    [Console]::Error.WriteLine($line)
    exit 1
}

function Test-PatrolTaskStartable([string]$TaskName) {
    if ($script:patrolKnownLaundryTasks -notcontains $TaskName -or $script:patrolScheduledTaskNames -notcontains $TaskName) {
        $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler state: approved task {1} is absent or unknown. No task start was attempted." -f $now, $TaskName
        Write-PatrolLog $line
        [Console]::Error.WriteLine($line)
        return $false
    }
    return $true
}

# A successful-looking row is not a completed transport without an immutable
# remote identity.  Keep this aligned with postCurrentSlot's completed-post
# guard: missing/ambiguous evidence is a data gap, never permission to retry.
function Get-TransportCompletionQualification(
    [object]$Entry,
    [string]$ExpectedDate,
    [int]$ExpectedSlot,
    [string]$ExpectedPlatform
) {
    $reasons = @()
    if ($null -eq $Entry) { $reasons += "record is missing" }
    else {
        if ($Entry.date -cne $ExpectedDate) { $reasons += "wrong date" }
        if ($Entry.slot -ne $ExpectedSlot) { $reasons += "wrong slot" }
        if ($Entry.platform -cne $ExpectedPlatform) { $reasons += "wrong platform" }
        if ($Entry.dry_run -isnot [bool] -or $Entry.dry_run) { $reasons += "dry_run is not boolean false" }
        if ($Entry.status -cnotin @("success", "posted")) { $reasons += "status is not live success" }
        $postId = $Entry.post_id
        if ($postId -isnot [string] -or $postId.Length -eq 0 -or $postId -cne $postId.Trim()) {
            $reasons += "post_id is missing or not trimmed"
        }
    }
    $claimsLive = $null -ne $Entry -and $Entry.status -cin @("success", "posted")
    return [pscustomobject]@{
        qualified = $reasons.Count -eq 0
        claims_live = $claimsLive
        reasons = @($reasons)
    }
}

. (Join-Path $PSScriptRoot "_publishing-reconciliation.ps1")
try {
    $canonicalCalendarIntegrity = Get-CanonicalCalendarIntegrity -Root $root -Date $date
    if ($canonicalCalendarIntegrity.present -isnot [bool] -or $canonicalCalendarIntegrity.tampered -isnot [bool]) {
        throw "Canonical calendar integrity runner returned non-boolean integrity flags."
    }
    $calendarIntegrity = [pscustomobject]@{
        present = $canonicalCalendarIntegrity.present
        tampered = $canonicalCalendarIntegrity.tampered
        inspection_status = "verified"
        error = $null
    }
} catch {
    # A failed trusted inspector proves neither a clean nor a tampered
    # calendar. Keep the patrol fail-closed without reporting a false tamper.
    $calendarIntegrity = [pscustomobject]@{
        present = $false
        tampered = $false
        inspection_status = "unverifiable"
        error = $_.Exception.Message
    }
}
$calendarIntegrityState = if ($calendarIntegrity.inspection_status -ceq "unverifiable") {
    "unverifiable"
} elseif ($calendarIntegrity.present -ne $true) {
    "missing"
} elseif ($calendarIntegrity.tampered -eq $true) {
    "tampered"
} else {
    "verified"
}
$calendarIntegrityOk = $calendarIntegrityState -ceq "verified"
$calendarIntegrityBlockReason = switch ($calendarIntegrityState) {
    "tampered" { "current calendar integrity is tampered" }
    "unverifiable" { "current calendar integrity inspection is unverifiable" }
    "missing" { "current calendar is missing" }
    default { "current calendar integrity is not verified" }
}
$WatchdogObserveOnly = $ObserveOnly -or -not $calendarIntegrityOk
. (Join-Path $PSScriptRoot "_watchdog.ps1")
if (-not $calendarIntegrityOk) {
    Write-PatrolLog ("[{0:yyyy-MM-dd HH:mm:ss}] Patrol: {1}; no task re-arm, catch-up, or YouTube rescue was started." -f $now, $calendarIntegrityBlockReason)
    exit 1
}

# Empty/unverifiable NextRunTime was checked before any calendar, network, or
# catch-up work. It is intentionally reported as a hard stop, not repaired by
# re-registering tasks from this automatic patrol.

# Nothing to do unless approvals exist (before 10:20 the day has not started).
$approvedPath = Join-Path $root "data\approved-log\$date.json"
if (-not (Test-Path $approvedPath)) { exit 0 }

$slotTimes = @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
$recovery = [TimeSpan]::FromHours(4)

$postedSlots = @()
$transportEvidenceGaps = @()
$postedPath = Join-Path $root "data\posted-log\$date.json"
if (Test-Path $postedPath) {
    try {
        $parsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json
        # Both platforms must have succeeded before a slot counts as done:
        # IG-only success used to mark the slot complete and FB stayed
        # permanently unpublished if the retry trigger died (luna, high).
        $entries = @($parsed)
        foreach ($slot in 1, 2, 3) {
            $ig = Get-StrictTransportCompletionQualification -Entries $entries -ExpectedDate $date -ExpectedSlot $slot -ExpectedPlatform "instagram"
            $fb = Get-StrictTransportCompletionQualification -Entries $entries -ExpectedDate $date -ExpectedSlot $slot -ExpectedPlatform "facebook"
            if ($ig.qualified -and $fb.qualified) {
                $postedSlots += $slot
            }
            if (-not $ig.qualified -and $ig.claims_live) {
                $transportEvidenceGaps += [pscustomobject]@{ slot = $slot; platform = "instagram"; reasons = @($ig.reasons) }
            }
            if (-not $fb.qualified -and $fb.claims_live) {
                $transportEvidenceGaps += [pscustomobject]@{ slot = $slot; platform = "facebook"; reasons = @($fb.reasons) }
            }
        }
        $postedSlots = @($postedSlots | Sort-Object -Unique)
    } catch {
        $transportEvidenceGaps += [pscustomobject]@{ slot = $null; platform = $null; reasons = @("posted-log cannot be parsed: $($_.Exception.Message)") }
    }
}

$transportEvidenceGapSlots = @(
    $transportEvidenceGaps |
        Where-Object { $null -ne $_.slot } |
        ForEach-Object { [int]$_.slot } |
        Sort-Object -Unique
)
if ($transportEvidenceGaps.Count -gt 0) {
    $gapSlots = if ($transportEvidenceGapSlots.Count -gt 0) { $transportEvidenceGapSlots -join "," } else { "unknown" }
    Write-PatrolLog ("[{0:yyyy-MM-dd HH:mm:ss}] Patrol: transport evidence data gap for slot(s) {1}; automatic catch-up is blocked for affected slots." -f $now, $gapSlots)
}

$needsRescue = $false
foreach ($slot in 1, 2, 3) {
    $t = $slotTimes[$slot]
    $inWindow = ($now.TimeOfDay -ge $t) -and (($now.TimeOfDay - $t) -le $recovery)
    if ($inWindow -and ($postedSlots -notcontains $slot) -and ($transportEvidenceGapSlots -notcontains $slot)) { $needsRescue = $true }
}

if ($needsRescue) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] Patrol found an open window with an unpublished slot; checking the approved catch-up task." -f $now
    Write-PatrolLog $line
    if (-not $ObserveOnly) {
        if (-not (Test-PatrolTaskStartable "Laundry-CatchUp-Publish")) { exit 1 }
        if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "catch-up task start")) {
            Write-PatrolLog ("[{0:yyyy-MM-dd HH:mm:ss}] Patrol: production contract drift blocked catch-up start." -f $now)
            exit 1
        }
        Start-ScheduledTask -TaskName "Laundry-CatchUp-Publish" -ErrorAction SilentlyContinue
    }
}

# YouTube rescue, session-independent: after 21:05 every *qualified* live IG
# Reel should have the Short from the same slot. Do not infer a Reel from its
# slot number: a slot 2 image fallback is a successful Meta post, not a Reel.
if ($now.TimeOfDay -ge [TimeSpan]"21:05") {
    try {
        $reconciliation = Get-PublishingReconciliation -Root $root -Date $date
        $expectedReelSlots = @($reconciliation.expected_reel_slots)
        $uploadedReelSlots = @($reconciliation.uploaded_reel_slots)
        $missingReelSlots = @($reconciliation.missing_reel_slots)
        $unexpectedYouTubeSlots = @($reconciliation.unexpected_youtube_slots)
        if ($unexpectedYouTubeSlots.Count -gt 0) {
            Write-PatrolLog ("[{0:yyyy-MM-dd HH:mm:ss}] Patrol: YouTube log has no matching qualified IG Reel for slot(s) {1}; not counting them as fulfilled." -f $now, ($unexpectedYouTubeSlots -join ","))
        }
        if ($missingReelSlots.Count -gt 0) {
            $line = "[{0:yyyy-MM-dd HH:mm:ss}] Patrol: Reel slot(s) {1} lack matching Short(s) (fulfilled {2}/{3}); checking the approved YouTube task." -f $now, ($missingReelSlots -join ","), $uploadedReelSlots.Count, $expectedReelSlots.Count
            Write-PatrolLog $line
            if (-not $ObserveOnly) {
                if (-not (Test-PatrolTaskStartable "Laundry-YouTube-Upload")) { exit 1 }
                if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube task start")) {
                    Write-PatrolLog ("[{0:yyyy-MM-dd HH:mm:ss}] Patrol: production contract drift blocked YouTube start." -f $now)
                    exit 1
                }
                Start-ScheduledTask -TaskName "Laundry-YouTube-Upload" -ErrorAction SilentlyContinue
            }
        }
    } catch {
        $line = "[{0:yyyy-MM-dd HH:mm:ss}] Patrol: YouTube reconciliation failed; no upload was started. {1}" -f $now, $_.Exception.Message
        Write-PatrolLog $line
    }
}

if ($transportEvidenceGaps.Count -gt 0) { exit 1 }
