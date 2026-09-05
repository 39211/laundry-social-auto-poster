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

# F32: Start-ScheduledTask on a Disabled task fails with "The task is disabled".
# SilentlyContinue on that line left no log, so rescue believed it had acted.
# Plan is a pure function so PS-layer smoke can invoke it without touching the
# live scheduler. Invoke uses the plan, then logs Enable/Start failures instead
# of swallowing them.
function Get-ScheduledTaskRescuePlan {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        $Task
    )
    $enableFirst = $false
    $reason = "ready"
    if ($null -eq $Task) {
        $reason = "missing"
    } elseif ("$($Task.State)" -eq "Disabled") {
        $enableFirst = $true
        $reason = "disabled"
    }
    [pscustomobject]@{
        TaskName    = $TaskName
        EnableFirst = [bool]$enableFirst
        Start       = $true
        Reason      = $reason
    }
}

function Invoke-ScheduledTaskRescue {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$LogFile,
        $Now,
        [scriptblock]$GetTask,
        [scriptblock]$EnableTask,
        [scriptblock]$StartTask
    )
    if ($null -eq $Now) { $Now = Get-Date }
    if (-not $GetTask) {
        $GetTask = { param($n) Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue }
    }
    if (-not $EnableTask) {
        $EnableTask = { param($n) Enable-ScheduledTask -TaskName $n -ErrorAction Stop }
    }
    if (-not $StartTask) {
        $StartTask = { param($n) Start-ScheduledTask -TaskName $n -ErrorAction Stop }
    }

    $task = & $GetTask $TaskName
    $plan = Get-ScheduledTaskRescuePlan -TaskName $TaskName -Task $task
    $stamp = "{0:yyyy-MM-dd HH:mm:ss}" -f $Now

    if ($plan.EnableFirst) {
        ("[{0}] {1} is Disabled during an open window; re-enabling." -f $stamp, $TaskName) |
            Add-Content -Path $LogFile -Encoding UTF8
        try {
            & $EnableTask $TaskName
        } catch {
            ("[{0}] Enable-ScheduledTask {1} failed: {2}" -f $stamp, $TaskName, $_.Exception.Message) |
                Add-Content -Path $LogFile -Encoding UTF8
        }
    }

    try {
        & $StartTask $TaskName
    } catch {
        ("[{0}] Start-ScheduledTask {1} failed: {2}" -f $stamp, $TaskName, $_.Exception.Message) |
            Add-Content -Path $LogFile -Encoding UTF8
    }

    return $plan
}

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
    $regOut = & (Join-Path $PSScriptRoot "register-catchup-task.ps1") 2>&1
    $regOut | ForEach-Object { Add-Content -Path $logFile -Value ([string]$_) -Encoding UTF8 }
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
    # 2026-08-22: found Laundry-CatchUp-Publish sitting Disabled with an open,
    # unpublished window. Start-ScheduledTask on a disabled task fails with
    # "The task is disabled", and -ErrorAction SilentlyContinue on the line
    # below was swallowing that failure with no trace in this log -- the
    # rescue believed it had acted while nothing happened. The dead-trigger
    # check above (empty NextRunTime) does not reliably catch this: it only
    # runs before $approvedPath exists for the day, and by the time a slot is
    # actually due the task may have been disabled well after that check ran.
    Invoke-ScheduledTaskRescue -TaskName "Laundry-CatchUp-Publish" -LogFile $logFile -Now $now
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
        Invoke-ScheduledTaskRescue -TaskName "Laundry-YouTube-Upload" -LogFile $logFile -Now $now
    }
}
