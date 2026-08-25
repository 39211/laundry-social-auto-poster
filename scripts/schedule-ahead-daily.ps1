# Rolling 3-day Facebook pre-scheduling. Owner directive 2026-08-24: content
# must be queued on Meta's side days ahead so a dead machine cannot stop the
# Page from publishing ("這個才叫穩定發布"). For each of D+1..D+3 this runs the
# same approve chain daily-approve runs for today, then schedule-ahead, which
# re-runs the publish gates itself and skips anything already queued or posted.
# Per-date failures are logged and skipped, never fatal to the other dates:
# the at-slot-time live path (primary tasks + sentinel) still owns anything
# this could not queue, so a red day here degrades to yesterday's behaviour,
# not to silence.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$logDir = Join-Path $root "output\schedule-ahead-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ($now.ToString("yyyy-MM-dd") + ".log")
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Write-Log([string]$message) {
    ("[{0}] {1}" -f [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz).ToString("yyyy-MM-dd HH:mm:ss"), $message) |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家預排程")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryScheduleAhead").Show((New-Object Windows.UI.Notifications.ToastNotification($template)))
    } catch {}
}

Push-Location $root
$queued = @()
$problems = @()
foreach ($offset in 1..3) {
    $date = $now.AddDays($offset).ToString("yyyy-MM-dd")
    Write-Log "=== D+$offset ($date) ==="

    $calendar = Join-Path $root "data\content-calendar\$date.json"
    if (-not (Test-Path -LiteralPath $calendar)) {
        Write-Log "no calendar yet for $date - generating"
        cmd /c "npm.cmd run generate -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
        cmd /c "npm.cmd run generate-image-manifest -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    }
    if (-not (Test-Path -LiteralPath $calendar)) {
        Write-Log "SKIP ${date}: calendar still missing after generate"
        $problems += "$date calendar"
        continue
    }

    # Same order daily-approve uses for today; each idempotent for a date that
    # already carries locks/approvals.
    cmd /c "npm.cmd run day-lock -- --date $date --heal 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    cmd /c "npm.cmd run heal-reel-slot -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8

    # Images must exist, be stamped, and be LIVE on Pages before auto-approve
    # and schedule-ahead run, or the whole date silently degrades to the live
    # path (the 08-24..28 queue only had slot 1/2 because a hand-run batch
    # filled them; this is that batch made formal). The manifest regenerates
    # unconditionally: it is deterministic from the calendar, and playbook
    # calendars written days ahead never got one from the missing-calendar
    # branch above (2026-08-29 was the first such gap).
    cmd /c "npm.cmd run generate-image-manifest -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    $planFile = Join-Path $root "output\d3-imggen\plan-$date.json"
    $resultFile = Join-Path $root "output\d3-imggen\result-$date.json"
    cmd /c "npm.cmd run slot-image-plan -- --date $date --out `"$planFile`" 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    $planItems = @()
    if (Test-Path -LiteralPath $planFile) {
        try {
            $plan = [IO.File]::ReadAllText($planFile, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
            $planItems = @($plan.items)
            foreach ($blocker in @($plan.blockers)) { Write-Log "IMAGE-PLAN BLOCKER ${date}: $blocker" }
            if (@($plan.blockers).Count -gt 0) { $problems += "$date image-plan" }
        } catch {
            Write-Log "IMAGE-PLAN ${date}: unreadable plan file"
            $problems += "$date image-plan"
        }
    } else {
        Write-Log "IMAGE-PLAN ${date}: plan file was not written"
        $problems += "$date image-plan"
    }
    if ($planItems.Count -gt 0) {
        Write-Log "IMAGE-GEN ${date}: generating $($planItems.Count) image(s) via hermes-Grok"
        $hermesPython = "C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
        & $hermesPython (Join-Path $PSScriptRoot "hermes-image-gen.py") --plan $planFile --out $resultFile --root $root 2>&1 |
            Out-File -FilePath $logFile -Append -Encoding utf8
        $genExit = $LASTEXITCODE
        $generatedRows = @()
        if (Test-Path -LiteralPath $resultFile) {
            try {
                $genResult = [IO.File]::ReadAllText($resultFile, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
                $generatedRows = @($genResult.generated)
                foreach ($fail in @($genResult.failed)) { Write-Log "IMAGE-GEN FAIL ${date} slot $($fail.slot): $($fail.reason)" }
            } catch { Write-Log "IMAGE-GEN ${date}: unreadable result file" }
        }
        if ($genExit -ne 0) { $problems += "$date image-gen" }
        foreach ($row in $generatedRows) {
            cmd /c "npm.cmd run mark-image-source -- --date $date --slot $($row.slot) --path $($row.path) --source grok-imagine-image 2>&1" |
                Out-File -FilePath $logFile -Append -Encoding utf8
            if ($LASTEXITCODE -ne 0) {
                Write-Log "IMAGE-STAMP FAIL ${date} slot $($row.slot) $($row.path)"
                $problems += "$date image-stamp"
            }
        }
        if ($generatedRows.Count -gt 0) {
            # Meta fetches every image URL at schedule time, so the bytes must be
            # live before schedule-ahead hands the URL over (the 08-24 Reel 422:
            # Pages deploy still in_progress). publish-pages commits and pushes;
            # the poll below waits out the deploy. If it never confirms, keep
            # going -- schedule-ahead re-verifies URLs itself and refuses cleanly,
            # and tomorrow's run retries.
            cmd /c "npm.cmd run publish-pages -- --date $date --skip-audit 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
            if ($LASTEXITCODE -ne 0) {
                Write-Log "PAGES PUBLISH FAIL ${date}"
                $problems += "$date pages-publish"
            }
            $deployOk = $false
            $firstUrl = [string]$generatedRows[0].public_image_url
            for ($poll = 1; $poll -le 12; $poll++) {
                try {
                    $resp = Invoke-WebRequest -Uri $firstUrl -Method Head -UseBasicParsing -TimeoutSec 20
                    if ($resp.StatusCode -eq 200) { $deployOk = $true; break }
                } catch {}
                Start-Sleep -Seconds 30
            }
            if ($deployOk) {
                foreach ($row in @($generatedRows | Select-Object -Skip 1)) {
                    $rowOk = $false
                    foreach ($poll in 1..3) {
                        try {
                            $resp = Invoke-WebRequest -Uri ([string]$row.public_image_url) -Method Head -UseBasicParsing -TimeoutSec 20
                            if ($resp.StatusCode -eq 200) { $rowOk = $true; break }
                        } catch { Start-Sleep -Seconds 10 }
                    }
                    if (-not $rowOk) {
                        $deployOk = $false
                        Write-Log "PAGES URL still unreachable: $($row.public_image_url)"
                    }
                }
            }
            if ($deployOk) {
                Write-Log "IMAGE-GEN ${date}: $($generatedRows.Count) image(s) live on Pages"
            } else {
                Write-Log "PAGES DEPLOY unconfirmed for ${date}; schedule-ahead's own URL gate stays authoritative"
                $problems += "$date pages-deploy"
            }
        }
    } elseif (Test-Path -LiteralPath $planFile) {
        Write-Log "IMAGE-PLAN ${date}: nothing to generate"
    }

    cmd /c "npm.cmd run auto-approve -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8

    $approved = Join-Path $root "data\approved-log\$date.json"
    if (-not (Test-Path -LiteralPath $approved)) {
        Write-Log "SKIP ${date}: auto-approve produced no approval log; live path keeps ownership"
        $problems += "$date approval"
        continue
    }

    $out = cmd /c "npm.cmd run schedule-ahead -- --date $date --live 2>&1"
    $out | Out-File -FilePath $logFile -Append -Encoding utf8
    $scheduledLog = Join-Path $root "data\scheduled-log\$date.json"
    if (Test-Path -LiteralPath $scheduledLog) {
        try {
            $rows = [IO.File]::ReadAllText($scheduledLog, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
            $queued += "{0}x{1}" -f $date, @($rows).Count
        } catch {
            $queued += "$date(?)"
        }
    } else {
        Write-Log "NOTE ${date}: nothing queued (all slots skipped)"
        $problems += "$date queued-nothing"
    }

    # R7: YouTube Shorts platform-side publishAt after this date's FB queue.
    # Slot 2 (evening) and slot 3 (noon Reel). A red slot is logged and skipped;
    # it must not abort D+2/D+3. Live youtube-upload.ps1 stays the fallback.
    foreach ($ytSlot in 2, 3) {
        $ytOut = cmd /c "npm.cmd run schedule-youtube -- --date $date --slot $ytSlot 2>&1"
        $ytOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) {
            Write-Log "YOUTUBE SCHEDULE FAIL ${date} slot ${ytSlot}"
            $problems += "$date youtube-slot-$ytSlot"
        }
    }
}
Pop-Location

$summary = "queued: " + ($(if ($queued.Count) { $queued -join ", " } else { "none" }))
if ($problems.Count) { $summary += " / problems: " + ($problems -join ", ") }
Write-Log $summary
if ($problems.Count) { Show-Toast $summary }
