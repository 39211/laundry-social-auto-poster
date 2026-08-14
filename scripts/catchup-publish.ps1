# Catch-up publisher for the daily 私享家 FB/IG slots.
# Safe to run repeatedly: post-current-slot enforces the approved-log gate and
# skips slots already recorded in posted-log. Same-day catch-up is authorized
# by data/publishing-policy.json (same_day_catch_up: true).
$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\catch-up-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Write-Log([string]$message) {
    $line = "[{0}] {1}" -f $now.ToString("yyyy-MM-dd HH:mm:ss"), $message
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家發文補跑")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryCatchUp").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

Write-Log "Catch-up run started (Taipei time $($now.ToString('HH:mm')))."

# Restore today's scheduled Reel before publishing anything: a morning rewrite
# of the calendar (it has happened three times) must cost nothing more than
# this heal step. No-op when the slot is already correct.
Push-Location $root
# Slot 1 heals from the day lock too: on 2026-08-07 a morning rewrite swapped
# slot 1's topic after the images were made, and the mismatch published.
# Create-if-absent first: on 2026-08-10 the images arrived hours after 06:30,
# no generate branch ever locked the day, and a midday rewrite went unhealed.
# Locking at first publish attempt freezes whatever is about to be published.
cmd /c "npm.cmd run day-lock -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$lockExit = $LASTEXITCODE
cmd /c "npm.cmd run day-lock -- --date $date --heal 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$healExit = $LASTEXITCODE
cmd /c "npm.cmd run heal-reel-slot -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$reelHealExit = $LASTEXITCODE
Pop-Location
# A failed heal means the calendar may still be clobbered; publishing an
# unrepaired package is worse than publishing late (luna, high).
if ($lockExit -ne 0 -or $healExit -ne 0 -or $reelHealExit -ne 0) {
    Write-Log "Lock/heal step failed (lock=$lockExit heal=$healExit reel=$reelHealExit); refusing to publish."
    Show-Toast "$date 自癒步驟失敗,補發已停止,請看 output\catch-up-logs\$date.log"
    exit 1
}

$approvedPath = Join-Path $root "data\approved-log\$date.json"
# Late-images day: when the package became complete only after the 11:15
# approve retry, no scheduled run ever re-judges it and the whole day used to
# publish nothing (both review families flagged this; it happened on 08-10).
# auto-approve is idempotent and every gate still applies -- this only moves
# WHEN the judgment happens, never what it decides.
# A partial approval used to be permanent. The condition below was "no approval
# log at all", so the moment ONE slot was approved the day stopped being
# re-judged -- and a slot blocked at 10:20 for a fixable reason stayed blocked
# until a human deleted the log. That failure mode got much more likely once
# approval started demanding image evidence per slot, so re-judge whenever any
# calendar slot is still missing its approval, not only when none has one.
$needsJudging = $true
if (Test-Path $approvedPath) {
    try {
        $calendarPath = Join-Path $root "data\content-calendar\$date.json"
        $calendarSlots = ([IO.File]::ReadAllText($calendarPath, [Text.UTF8Encoding]::new($false)) |
            ConvertFrom-Json).slots | ForEach-Object { $_.slot }
        $approvedSlots = ([IO.File]::ReadAllText($approvedPath, [Text.UTF8Encoding]::new($false)) |
            ConvertFrom-Json) | ForEach-Object { $_.slot } | Sort-Object -Unique
        $needsJudging = @($calendarSlots | Where-Object { $approvedSlots -notcontains $_ }).Count -gt 0
    } catch {
        # Unreadable either file: re-judging is the safe direction, since
        # auto-approve applies every gate and approves nothing it should not.
        $needsJudging = $true
    }
}
if ($needsJudging) {
    Write-Log "One or more slots for $date are still unapproved; running auto-approve now (gates unchanged)."
    Push-Location $root
    cmd /c "npm.cmd run auto-approve -- --date $date --no-fail 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}
# Indexing has no trigger of its own -- it only ever runs as a side effect of
# the 06:30 generate. So any morning that script does not complete, IndexNow is
# silently skipped for the day and the loss shows up weeks later as pages that
# were never recrawled. 08-12 and 08-13 have no indexing record for exactly
# that reason: the machine was asleep and the script never ran at all.
#
# This runs many times a day, so it is the natural place to notice. It only
# resubmits and re-audits; it publishes nothing.
$indexingRecord = Join-Path $root "output\operations\indexing-push-$date.json"
if (-not (Test-Path $indexingRecord)) {
    Write-Log "No indexing record for $date; submitting IndexNow and running the indexing audit now."
    Push-Location $root
    cmd /c "npm.cmd run submit-indexnow -- --live 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    cmd /c "npm.cmd run indexing-push -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}

if (-not (Test-Path $approvedPath)) {
    Write-Log "No approved-log for $date. Nothing can be published yet."
    Show-Toast "今天 ($date) 還沒有審核紀錄,請執行 Codex 審核流程,否則今天不會發文。"
    exit 0
}

# A slot recovers only within a few hours of its own time. Past that the evening
# run would fire both slots minutes apart, which reaches fewer people than one
# well-placed post and reads as automated. A stale slot is reported, not posted.
$slotTimes = @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
$recoveryWindow = [TimeSpan]::FromHours(4)

$dueSlots = @()
$staleSlots = @()
foreach ($slot in 1, 2, 3) {
    $scheduled = $slotTimes[$slot]
    if ($now.TimeOfDay -lt $scheduled) { continue }
    if (($now.TimeOfDay - $scheduled) -le $recoveryWindow) { $dueSlots += $slot }
    else { $staleSlots += $slot }
}

if ($staleSlots.Count -gt 0) {
    $stale = $staleSlots -join ", "
    Write-Log "Slot $stale is past its $($recoveryWindow.TotalHours)h recovery window; not publishing it late."
}

if ($dueSlots.Count -eq 0) {
    if ($staleSlots.Count -gt 0) {
        $unposted = @()
        $postedPath = Join-Path $root "data\posted-log\$date.json"
        $postedSlots = @()
        if (Test-Path $postedPath) {
            $postedParsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json
            # Matches hasRecordedPost in src/logging.ts, which accepts either
            # status string; checking only "success" here reported a "posted"
            # slot as missed.
            $postedSlots = @(@($postedParsed) | Where-Object { @("success", "posted") -contains $_.status -and -not $_.dry_run } | ForEach-Object { $_.slot })
        }
        $unposted = @($staleSlots | Where-Object { $postedSlots -notcontains $_ })
        if ($unposted.Count -gt 0) {
            Show-Toast ("今天 slot {0} 已超過補發時限,不會補發以免和下一篇擠在一起。" -f ($unposted -join ", "))
        }
    } else {
        Write-Log "No slot is due yet."
    }
    exit 0
}

$failed = @()
foreach ($slot in $dueSlots) {
    # Slot 3 is optional on older 2-slot calendars. Missing ≠ failed: log once
    # and continue so catch-up still publishes slots 1/2 without a toast or
    # non-zero exit. post-current-slot also skips absent slot 3; this check
    # avoids a wasted npm invocation and keeps the log wording explicit.
    if ($slot -eq 3) {
        $calendarPath = Join-Path $root "data\content-calendar\$date.json"
        $hasSlot3 = $false
        if (Test-Path $calendarPath) {
            try {
                $calendarParsed = Get-Content $calendarPath -Raw -Encoding utf8 | ConvertFrom-Json
                $hasSlot3 = @(@($calendarParsed.slots) | Where-Object { $_.slot -eq 3 }).Count -gt 0
            } catch {
                Write-Log ("Could not read content calendar for slot-3 presence: " + $_.Exception.Message)
            }
        }
        if (-not $hasSlot3) {
            Write-Log "Slot 3 absent on calendar for $date; skipping (not a failure)."
            continue
        }
    }

    Write-Log "Running post-current-slot --slot $slot"
    Push-Location $root
    # Explicit --date: PowerShell resolves Taipei but Node falls back to its
    # own TIMEZONE env; around midnight the two can disagree and publish
    # yesterday's slot into today's logs (luna, high).
    $output = cmd /c "npm.cmd run post-current-slot -- --slot $slot --date $date 2>&1"
    $exitCode = $LASTEXITCODE
    Pop-Location
    $output | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($exitCode -ne 0) {
        # The exit code alone is not evidence: on 2026-08-08 the process was
        # terminated (-1) after both platforms had already recorded success,
        # the slot was misjudged as failed, and first comments were skipped.
        # The posted-log is the ground truth, so consult it before declaring
        # failure.
        $postedOk = $false
        try {
            $postedRaw = [IO.File]::ReadAllText((Join-Path $root "data\posted-log\$date.json"), [Text.UTF8Encoding]::new($false))
            $entries = @(ConvertFrom-Json $postedRaw)
            $igOk = @($entries | Where-Object { $_.slot -eq $slot -and $_.platform -eq "instagram" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
            $fbOk = @($entries | Where-Object { $_.slot -eq $slot -and $_.platform -eq "facebook" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
            $postedOk = $igOk -and $fbOk
        } catch {}
        if ($postedOk) {
            Write-Log "Slot $slot exited $exitCode but the posted-log records success on both platforms; treating as published."
        } else {
            Write-Log "Slot $slot failed with exit code $exitCode."
            $failed += $slot
        }
    } else {
        Write-Log "Slot $slot finished (published or already recorded)."
    }
}

# The shop opens the comment thread on its own post right after publishing:
# a zero-comment thread rarely starts itself, and the first reply is the
# cheapest distribution push a post gets. Idempotent per slot, and it runs
# before the failure exit so slots that DID publish still get their comment
# when a sibling slot failed (one slot's failure used to skip all comments).
Push-Location $root
cmd /c "npm.cmd run first-comment -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
# Story re-share: a second surface with its own ranking, reaching followers who
# never see the feed post. Idempotent per slot, only for posts confirmed live,
# and a failure here is logged rather than treated as a publishing failure.
cmd /c "npm.cmd run share-story -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
Pop-Location

if ($failed.Count -gt 0) {
    Show-Toast ("今天 slot {0} 補發失敗,請看 output\catch-up-logs\{1}.log" -f ($failed -join ", "), $date)
    exit 1
}

# Nothing else reads the repair queue, so a deferred video would otherwise sit
# there unseen. An "unexpected" defer means the video check itself failed and is
# a defect to fix, not a job waiting on review.
$queuePath = Join-Path $root "data\video-repair-queue\queue.json"
if (Test-Path $queuePath) {
    try {
        # Assign before wrapping: in PowerShell 5.1 ConvertFrom-Json emits a
        # whole array as one pipeline object, so @(... | ConvertFrom-Json) would
        # yield a single element and every filter below would match nothing.
        $parsed = Get-Content $queuePath -Raw -Encoding utf8 | ConvertFrom-Json
        $queue = @($parsed)
        $open = @($queue | Where-Object { $_.status -eq "VIDEO_DEFERRED" -and -not $_.dry_run })
        $faults = @($open | Where-Object { $_.defer_kind -eq "unexpected" })

        if ($faults.Count -gt 0) {
            $first = $faults[0]
            Write-Log ("UNEXPECTED video failure: {0} slot {1} - {2}" -f $first.source_date, $first.source_slot, $first.failure_reason)
            Show-Toast ("影片檢查本身出錯({0} 筆),不是等待複審。{1} slot {2}:{3}" -f $faults.Count, $first.source_date, $first.source_slot, $first.failure_reason)
        } elseif ($open.Count -gt 0 -and $now.TimeOfDay -ge [TimeSpan]"20:30") {
            Write-Log ("{0} video repair(s) still open." -f $open.Count)
            Show-Toast ("有 {0} 支影片待修復,今天已改發圖片。修好後放進下一篇題材相符的貼文。" -f $open.Count)
        }
    } catch {
        Write-Log ("Could not read repair queue: " + $_.Exception.Message)
    }
}

# End-of-day snapshot of the numbers that precede a booking. Reach as a share of
# followers is not one of them: this shop only serves Taichung, so what matters
# is how many local strangers it reached and how many of them did anything.
if ($now.TimeOfDay -ge [TimeSpan]"20:30") {
    Push-Location $root
    $reachOut = cmd /c "npm.cmd run local-reach 2>&1"
    Pop-Location
    $reachOut | Out-File -FilePath $logFile -Append -Encoding utf8

    $reachPath = Join-Path $root "output\operations\local-reach.json"
    if (Test-Path $reachPath) {
        try {
            $reach = Get-Content $reachPath -Raw -Encoding utf8 | ConvertFrom-Json
            Write-Log ("28d: non-follower reach {0}, accounts engaged {1}, followers gained {2}" -f `
                $reach.reach_non_follower, $reach.accounts_engaged, $reach.followers_gained)
        } catch {
            Write-Log ("Could not read local-reach report: " + $_.Exception.Message)
        }
    }
}

Write-Log "Catch-up run finished."
