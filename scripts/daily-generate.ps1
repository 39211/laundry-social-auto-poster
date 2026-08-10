# 06:30 daily generation. The package needs AI image generation, so this drives
# Codex non-interactively rather than calling npm scripts directly.
# Generation only: approval and publishing are separate stages with their own gates.
#
# -Date generates a day other than today, which is how a date whose calendar was
# written early (by scheduling a Reel into it) gets its images before the
# morning it is due.
param([string]$Date = "")

$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = if ($Date) { $Date } else { $now.ToString("yyyy-MM-dd") }

$logDir = Join-Path $root "output\daily-generate-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

function Write-Log([string]$message) {
    ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $now, $message) | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家每日生成")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryDailyGenerate").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

# A calendar on its own does not mean the day is generated. Scheduling a Reel
# into a future date writes that date's calendar months before its images exist,
# and treating the calendar as proof of completion silently skipped image
# generation for every such day, leaving slot 1 unpublishable on the morning it
# was due. Completion is decided by the assets the calendar actually references.
# Watchdog: on 2026-08-04 something disabled Laundry-CatchUp-Publish and the
# next day and a half published nothing on schedule. This run is the one task
# guaranteed to fire every morning, so it re-arms any sibling that was turned
# off. Disabling a task on purpose now requires also silencing this watchdog,
# which is exactly the friction an accidental or unauthorized disable should hit.
foreach ($t in Get-ScheduledTask | Where-Object { $_.TaskName -like "Laundry-*" -and $_.State -eq "Disabled" }) {
    Enable-ScheduledTask -TaskName $t.TaskName | Out-Null
    Write-Log "Watchdog re-enabled disabled task: $($t.TaskName)"
    Show-Toast "$($t.TaskName) 被停用了,已自動重新啟用。若是刻意停用請告訴我。"
}

# The pipeline runs tsx from the working tree, so uncommitted edits to src/ or
# scripts/ are live in production the moment they land -- one such edit (an
# unreviewed manual-QA gate) silently blocked a night's Reel. Overnight edits
# are stashed, not deleted: the work stays recoverable under a named stash,
# and today's schedule runs the committed, tested code.
Push-Location $root
$dirty = @(cmd /c "git status --short src scripts 2>&1" | Where-Object { $_ -match "^\s*[MADR]" })
if ($dirty.Count -gt 0) {
    cmd /c "git stash push -m ""watchdog: uncommitted production-code edits found $date"" -- src scripts 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Write-Log "Watchdog stashed $($dirty.Count) uncommitted production-code change(s); schedule runs committed code."
    Show-Toast "發現 $($dirty.Count) 個未提交的程式修改,已暫存(git stash)。排程改跑已提交版本,請告訴我要不要採用那些修改。"
}
Pop-Location

$calendar = Join-Path $root "data\content-calendar\$date.json"
$hasCalendar = Test-Path $calendar
$imagesReady = $false
if ($hasCalendar) {
    Push-Location $root
    cmd /c "npm.cmd run validate-publishable-images -- --date $date 2>&1" | Out-Null
    $imagesReady = ($LASTEXITCODE -eq 0)
    Pop-Location
}

# Every path out of this script must end with the site publish chain: the
# public site is what SEO, AI crawlers and the publish-time asset checks all
# read, and it only updates when this pushes it. The publish steps used to sit
# at the end of the full-generation path only -- but once content began being
# generated ahead of time, every morning took the "already ready" early exit,
# and the site silently stopped updating from the schedule at all.
# Lock slot 1 whenever the day is verifiably complete. Both completion paths
# must lock: on 2026-08-10 only the "generation finished" branch locked, the
# images-arrived-later day never got a lock, and a midday rewrite went
# unhealed. Idempotent -- an existing lock is kept, never replaced.
function Lock-Day {
    Push-Location $root
    cmd /c "npm.cmd run day-lock -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}

function Publish-Site {
    Push-Location $root
    cmd /c "npm.cmd run generate-public-site 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        # Publishing yesterday's docs/ over a failed regeneration silently
        # drifts the public site from the local package (luna, high).
        Write-Log "generate-public-site failed; refusing to publish stale output."
        Pop-Location
        return $false
    }
    # --skip-audit: the audit fetches ~50 live URLs and one transient non-2xx
    # would mark a successful push as failed, skipping IndexNow for the day and
    # crying wolf on the same toast channel real faults use. The weekly review
    # is where a genuine broken-URL sweep belongs.
    cmd /c "npm.cmd run publish-pages -- --date $date --skip-audit 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    $ok = ($LASTEXITCODE -eq 0)
    if ($ok) {
        cmd /c "npm.cmd run submit-indexnow -- --live 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
        # Daily indexing push and audit: resubmits today's changed URLs plus the
        # landing pages, then verifies each is reachable and above the thin-page
        # floor. Thin pages are what Google reports as "crawled, currently not
        # indexed", so they get flagged the day they appear instead of silently
        # sitting in the sitemap. Never blocks the publish result.
        cmd /c "npm.cmd run indexing-push -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) {
            Write-Log "Indexing audit flagged thin or unreachable pages; see output\operations\indexing-push-$date.json"
            Show-Toast "$date 索引稽核有頁面過薄或連不到,請看 output\operations\indexing-push-$date.json"
        }
        Write-Log "Public site pushed, IndexNow submitted, indexing audit run."
    } else {
        Write-Log "publish-pages failed; assets exist locally but are not online."
        Show-Toast "$date 的公開站沒推上去,發文會被公開資產檢查擋下,請看 log。"
    }
    Pop-Location
    return $ok
}

if ($hasCalendar -and $imagesReady) {
    Write-Log "Content calendar and images for $date are both ready; publishing the site refresh."
    Lock-Day
    if (Publish-Site) { exit 0 } else { exit 1 }
}

$codex = Join-Path $env:APPDATA "npm\codex.cmd"
if (-not (Test-Path $codex)) {
    Write-Log "codex.cmd not found at $codex."
    Show-Toast "找不到 codex.cmd,今天的內容沒有生成。"
    exit 1
}

# A day whose calendar already exists has usually had a Reel scheduled into
# slot 2 by hand. Regenerating its content would overwrite that reviewed Reel
# with a fresh plan, so those days are told to fill in only what is missing.
if ($hasCalendar) {
    Write-Log "Calendar for $date exists but its images do not; generating images only."
    # Driving Codex through its workspace-write sandbox fails here:
    # `CryptUnprotectData failed: 2148073483` blocks every workspace read and
    # write, so it reports the day as blocked and generates nothing. The
    # images-only path therefore runs Codex read-only and places the files
    # itself. The calendar is never handed to Codex at all, so the reviewed Reel
    # already in slot 2 cannot be overwritten.
    Push-Location $root
    cmd /c "npm.cmd run generate-image-manifest -- --date $date 2>&1" | Out-Null
    Pop-Location

    & (Join-Path $PSScriptRoot "generate-missing-images.ps1") -Date $date -LogFile $logFile
    if ($LASTEXITCODE -eq 0) {
        Write-Log "Images for $date are ready."
        # Third completion path. Both review families flagged that this branch
        # published without locking, which is exactly the 08-10 unlocked-day
        # hole surviving under a different entrance.
        Lock-Day
        if (Publish-Site) { exit 0 } else { exit 1 }
    }
    Write-Log "Image backfill for $date did not complete."
    Show-Toast "$date 的圖片沒有補齊,slot 1 可能發不出去,請看 log。"
    # The day failed, but the site must not stay frozen on yesterday: whatever
    # is already valid still gets pushed so SEO freshness survives a bad morning.
    Publish-Site | Out-Null
    exit 1
} else {
    # Slot 1's object comes from the committed 90-day plan, not from free
    # invention: left to choose, the generator recycled the makeup-bag package
    # four times in five days and then looped 帆布鞋/襯衫領 reruns on 08-10.
    # The repeat/mismatch gates still verify afterwards; this just makes the
    # first attempt the right one.
    $plannedObject = ""
    try {
        $planRaw = [IO.File]::ReadAllText((Join-Path $root "data\slot1-plan.json"), [Text.UTF8Encoding]::new($false))
        $plan = ConvertFrom-Json $planRaw
        $plannedObject = $plan.$date
    } catch {}
    $planLine = ""
    if ($plannedObject) {
        $planLine = "`nToday's slot 1 MUST be about this object (from the committed 90-day plan): $plannedObject. Write a fresh hook and captions for it; do not substitute another object. Slot 1 topics from the last 7 days are off-limits.`n"
        Write-Log "Slot 1 planned object for ${date}: $plannedObject"
    }
    $prompt = @"
Run the 06:30 daily generation for $date (Asia/Taipei) exactly as defined in .agents/skills/daily-automation/SKILL.md.
$planLine
Generate the daily context, the content calendar, the image prompt manifest, the final images through the built-in image model, the image source records, and the video candidate manifest, then refresh the public site.

Stop and report if any required step cannot complete. Do not approve posts, do not write approved-log or posted-log entries, and do not publish to Facebook or Instagram: approval and publishing are separate stages.
"@
}

Write-Log "Starting Codex generation for $date."
Push-Location $root
$output = & $codex exec -C $root -s workspace-write $prompt 2>&1
$exitCode = $LASTEXITCODE
Pop-Location
$output | Out-File -FilePath $logFile -Append -Encoding utf8

if ($exitCode -ne 0) {
    Write-Log "Codex exited with $exitCode."
    Show-Toast "今天 ($date) 的內容生成失敗,請看 output\daily-generate-logs\$date.log"
    Publish-Site | Out-Null
    exit 1
}

# Codex exiting 0 is not proof the day can publish. The gate that matters is
# whether the images the calendar references are actually on disk.
Push-Location $root
cmd /c "npm.cmd run validate-publishable-images -- --date $date 2>&1" | Out-Null
$imagesReadyNow = ($LASTEXITCODE -eq 0)
Pop-Location

if ((Test-Path $calendar) -and $imagesReadyNow) {
    Write-Log "Generation finished; calendar and images are both ready."
    # Lock slot 1 the moment its images verifiably exist. Anything that rewrites
    # the calendar after this point gets healed back before approval/publish.
    # A deliberate slot-1 redo must delete data\day-locks\<date>.json first.
    Push-Location $root
    cmd /c "npm.cmd run day-lock -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
} elseif (Test-Path $calendar) {
    Write-Log "Codex finished but images for $date are still missing."
    Show-Toast "今天 ($date) 的圖片沒有生成完整,slot 1 可能發不出去,請看 log。"
    Publish-Site | Out-Null
    exit 1
} else {
    Write-Log "Codex finished but no content calendar was written."
    Show-Toast "生成流程跑完但沒有產生內容檔,請檢查 log。"
    Publish-Site | Out-Null
    exit 1
}

if (Publish-Site) { exit 0 } else { exit 1 }
