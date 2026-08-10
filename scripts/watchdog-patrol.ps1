# Every-30-minutes patrol. Exists because the publish task keeps getting
# disabled with surgical timing: on 2026-08-07 it was killed in the twenty
# minutes between the 11:15 approval and the 11:35 publish, and the next
# sibling watchdog (14:00) revived it only after every noon trigger was lost.
# The patrol shrinks the maximum kill window to thirty minutes, and it does
# not just revive the task -- when a publish window is open and its slot has
# not published, it starts the catch-up task immediately instead of waiting
# for the next trigger.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\watchdog-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

. (Join-Path $PSScriptRoot "_watchdog.ps1")

# Dead-trigger detection (both review families): a task can be State=Ready
# with an empty NextRunTime -- the exact way the patrol itself died on 08-08.
# Enable-only watchdogs never catch that; re-registering rebuilds the triggers.
$deadTasks = @(Get-ScheduledTask | Where-Object { $_.TaskName -like "Laundry-*" } | Where-Object {
    $info = Get-ScheduledTaskInfo -TaskName $_.TaskName -ErrorAction SilentlyContinue
    $null -ne $info -and ($null -eq $info.NextRunTime)
})
if ($deadTasks.Count -gt 0) {
    $names = ($deadTasks | ForEach-Object { $_.TaskName }) -join ", "
    "[{0:yyyy-MM-dd HH:mm:ss}] Dead trigger (empty NextRunTime) on: {1}; re-registering all tasks." -f $now, $names |
        Add-Content -Path $logFile -Encoding UTF8
    & (Join-Path $PSScriptRoot "register-catchup-task.ps1") *>> $logFile
}

# Nothing to do unless approvals exist (before 10:20 the day has not started).
$approvedPath = Join-Path $root "data\approved-log\$date.json"
if (-not (Test-Path $approvedPath)) { exit 0 }

$slotTimes = @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
$recovery = [TimeSpan]::FromHours(4)

$postedSlots = @()
$postedPath = Join-Path $root "data\posted-log\$date.json"
if (Test-Path $postedPath) {
    try {
        $parsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json
        # Both platforms must have succeeded before a slot counts as done:
        # IG-only success used to mark the slot complete and FB stayed
        # permanently unpublished if the retry trigger died (luna, high).
        $igSlots = @(@($parsed) | Where-Object {
            $_.platform -eq "instagram" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status)
        } | ForEach-Object { $_.slot })
        $fbSlots = @(@($parsed) | Where-Object {
            $_.platform -eq "facebook" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status)
        } | ForEach-Object { $_.slot })
        $postedSlots = @($igSlots | Where-Object { $fbSlots -contains $_ })
    } catch {}
}

$needsRescue = $false
foreach ($slot in 1, 2, 3) {
    $t = $slotTimes[$slot]
    $inWindow = ($now.TimeOfDay -ge $t) -and (($now.TimeOfDay - $t) -le $recovery)
    if ($inWindow -and ($postedSlots -notcontains $slot)) { $needsRescue = $true }
}

if ($needsRescue) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] Patrol found an open window with an unpublished slot; starting catch-up." -f $now
    $line | Add-Content -Path $logFile -Encoding UTF8
    Start-ScheduledTask -TaskName "Laundry-CatchUp-Publish" -ErrorAction SilentlyContinue
}

# YouTube rescue, session-independent: after 21:05 every live IG Reel should
# have its Short. The upload script is idempotent (skips already-uploaded), so
# starting it again is safe. Before this, YT rescue lived only in ad-hoc
# session monitors, which die with the session.
if ($now.TimeOfDay -ge [TimeSpan]"21:05") {
    $liveReels = @($postedSlots | Where-Object { $_ -in 2, 3 } | Sort-Object -Unique).Count
    $ytCount = 0
    $ytPath = Join-Path $root "data\youtube-log\$date.json"
    if (Test-Path $ytPath) {
        try {
            $ytParsed = [IO.File]::ReadAllText($ytPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
            $ytCount = @(@($ytParsed) | Where-Object { $_.video_id }).Count
        } catch {}
    }
    if ($liveReels -gt $ytCount) {
        $line = "[{0:yyyy-MM-dd HH:mm:ss}] Patrol: {1} live Reel(s) but {2} Short(s); starting YouTube upload." -f $now, $liveReels, $ytCount
        $line | Add-Content -Path $logFile -Encoding UTF8
        Start-ScheduledTask -TaskName "Laundry-YouTube-Upload" -ErrorAction SilentlyContinue
    }
}
