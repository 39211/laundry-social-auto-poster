# 06:30 daily generation. The package needs AI image generation, so this drives
# Codex non-interactively rather than calling npm scripts directly.
# Generation only: approval and publishing are separate stages with their own gates.
#
# -Date generates a day other than today, which is how a date whose calendar was
# written early (by scheduling a Reel into it) gets its images before the
# morning it is due.
[CmdletBinding()]
param(
    [string]$Date = "",
    [string]$RootOverride = ""
)

$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
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
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = if ($Date) { $Date } else { $now.ToString("yyyy-MM-dd") }

$logDir = Join-Path $root "output\daily-generate-logs"
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

. (Join-Path $PSScriptRoot "_production-contract.ps1")
$initialContract = Test-CleanProductionContract -Root $root
if (-not $initialContract.ok) {
    [Console]::Error.WriteLine("BLOCKED production contract before daily generation: $($initialContract.reason). No lock, task re-arm, generation, Pages publish, or IndexNow was run.")
    exit 1
}
$ProductionContractVerified = $true

# A blocked contract creates neither a run lock nor an output directory. Later
# checks are mandatory after generation and immediately before every mutation.
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Assert-CleanProductionContract([string]$stage) {
    if (Assert-CleanProductionContractBeforeAction -Root $root -Stage $stage) { return $true }
    $contract = Test-CleanProductionContract -Root $root
    $line = "BLOCKED production contract ${stage}: $($contract.reason). No lock, task re-arm, Pages publish, or IndexNow was run."
    # A child may have altered protected source while it ran. Do not turn its
    # stdout or a derived decision into a new local evidence record after that
    # re-check fails; the console is the only safe failure surface here.
    [Console]::Error.WriteLine($line)
    return $false
}

# A calendar on its own does not mean the day is generated. Scheduling a Reel
# into a future date writes that date's calendar months before its images exist,
# and treating the calendar as proof of completion silently skipped image
# generation for every such day, leaving slot 1 unpublishable on the morning it
# was due. Completion is decided by the assets the calendar actually references.
# A disabled scheduled task is an operator kill switch, not a fault that a
# sibling job may silently reverse.  Scheduler state is read-only here: a
# human must explicitly review and run the guarded registration script before
# any task can be changed.  The legacy inline sentinel is equally unsafe; its
# presence blocks this automatic worker rather than being revived or replaced.
try {
    $scheduledLaundryTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like "Laundry-*" })
} catch {
    $line = "BLOCKED scheduler state: Laundry task inventory is unverifiable. No task was enabled, unregistered, or registered. $($_.Exception.Message)"
    [Console]::Error.WriteLine($line)
    Write-Log $line
    exit 1
}
$legacySentinel = @($scheduledLaundryTasks | Where-Object { $_.TaskName -ceq "Laundry-Publish-Sentinel" })
if ($legacySentinel.Count -gt 0) {
    $line = "BLOCKED scheduler state: legacy Laundry-Publish-Sentinel is present. Manual review/removal is required; no task was enabled, unregistered, or registered."
    [Console]::Error.WriteLine($line)
    Write-Log $line
    exit 1
}
$disabledLaundryTasks = @($scheduledLaundryTasks | Where-Object { $_.State -eq "Disabled" })
if ($disabledLaundryTasks.Count -gt 0) {
    $names = ($disabledLaundryTasks | ForEach-Object { $_.TaskName }) -join ", "
    $line = "BLOCKED scheduler kill switch: disabled Laundry task(s): $names. Manual review is required; no task was enabled, unregistered, or registered."
    [Console]::Error.WriteLine($line)
    Write-Log $line
    exit 1
}

$calendar = Join-Path $root "data\content-calendar\$date.json"
$hasCalendar = Test-Path $calendar
$imagesReady = $false
if ($hasCalendar) {
    Push-Location $root
    $inspectOut = @(Invoke-TrustedProductionTsx -Root $root src/logging.ts --inspect-calendar --date $date 2>&1)
    $inspectCode = $LASTEXITCODE
    Pop-Location
    if (-not (Assert-CleanProductionContract "after calendar inspection")) { exit 1 }
    $inspectOut | Out-File -FilePath $logFile -Append -Encoding utf8
    $shouldRebuild = ($inspectCode -eq 2)
    $inspectLine = @($inspectOut | Where-Object { "$_" -match '"shouldRebuild"' } | Select-Object -Last 1)
    if ($inspectLine) {
        try {
            if (([string]$inspectLine | ConvertFrom-Json).shouldRebuild) { $shouldRebuild = $true }
        } catch {}
    }
    if ($shouldRebuild) {
        Write-Log "Calendar tamper detected for $date; rebuilding from plan before the images-ready exit."
        Show-Toast ("今天 ($date) 的行事曆被外部寫手竄改,已從 plan 強制重建。證據: output\operations\calendar-tamper-$date.json")
        $rebuildOut = @(Invoke-TrustedProductionNpm -Root $root run generate -- --date $date --force 2>&1)
        $rebuildExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContract "after calendar rebuild")) { exit 1 }
        $rebuildOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($rebuildExit -ne 0) {
            Write-Log "Calendar rebuild failed (exit $rebuildExit); refusing image validation, lock, Pages, and IndexNow."
            exit 1
        }
        $manifestOut = @(Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --date $date 2>&1)
        $manifestExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContract "after image manifest rebuild")) { exit 1 }
        $manifestOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($manifestExit -ne 0) {
            Write-Log "Image manifest rebuild failed (exit $manifestExit); refusing image validation, lock, Pages, and IndexNow."
            exit 1
        }
    }
    $validateOut = @(Invoke-TrustedProductionNpm -Root $root run validate-publishable-images -- --date $date 2>&1)
    $validateExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after initial image validation")) { exit 1 }
    $validateOut | Out-File -FilePath $logFile -Append -Encoding utf8
    $imagesReady = ($validateExit -eq 0)
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
$script:dayLockVerified = $false
function Test-VerifiedDailyLockProof([object[]]$Output, [string]$ExpectedDate) {
    $text = (@($Output | ForEach-Object { [string]$_ }) -join "`n")
    $escapedDate = [regex]::Escape($ExpectedDate)
    $pattern = "(?m)^DAY_LOCK_VERIFIED date=$escapedDate action=(?:locked|already-locked) calendar_checksum=[a-f0-9]{16} lock_checksum=[a-f0-9]{64}\s*$"
    return ([regex]::Matches($text, $pattern)).Count -eq 1
}

function Lock-Day {
    if (-not (Assert-CleanProductionContract "before day lock")) { return $false }
    $lockOut = @(Invoke-TrustedProductionNpm -Root $root run day-lock -- --date $date 2>&1)
    $lockExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after day lock")) { return $false }
    $lockOut | Out-File -FilePath $logFile -Append -Encoding utf8
    $lockSucceeded = Test-VerifiedDailyLockProof -Output @($lockOut) -ExpectedDate $date
    if ($lockExit -ne 0 -or -not $lockSucceeded) {
        Write-Log "day-lock did not establish a verified lock (exit $lockExit); refusing Pages publish and IndexNow."
        Show-Toast "$date 的 day-lock 失敗；已停止 Pages 發布與 IndexNow，請看 log。"
        return $false
    }
    $script:dayLockVerified = $true
    return $true
}

function Assert-PublicPublicationApproval([string]$stage) {
    $approval = Test-PublicPublicationApproval -Root $root -Date $date
    if (-not (Assert-CleanProductionContract "after public publication approval $stage")) { return $false }
    if ($approval.ok) { return $true }
    $line = "BLOCKED public publication ${stage}: $($approval.reason)."
    Write-Log $line
    $approval.gaps | ForEach-Object { Write-Log ("BLOCKED public-approval gap: " + [string]$_) }
    [Console]::Error.WriteLine($line)
    return $false
}

function Publish-Site {
    if (-not $script:dayLockVerified) {
        Write-Log "No verified day lock exists for $date; refusing Pages publish and IndexNow."
        return $false
    }
    if (-not (Assert-CleanProductionContract "before public-site generation")) { return $false }
    if (-not (Assert-PublicPublicationApproval "before public-site generation")) { return $false }
    $siteOut = @(Invoke-TrustedProductionNpm -Root $root run generate-public-site 2>&1)
    $siteExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after public-site generation")) { return $false }
    $siteOut | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($siteExit -ne 0) {
        # Publishing yesterday's docs/ over a failed regeneration silently
        # drifts the public site from the local package (luna, high).
        Write-Log "generate-public-site failed; refusing to publish stale output."
        return $false
    }
    if (-not (Assert-CleanProductionContract "before Pages publish")) {
        return $false
    }
    if (-not (Assert-PublicPublicationApproval "before Pages publish")) { return $false }
    # --skip-audit: the audit fetches ~50 live URLs and one transient non-2xx
    # would mark a successful push as failed, skipping IndexNow for the day and
    # crying wolf on the same toast channel real faults use. The weekly review
    # is where a genuine broken-URL sweep belongs.
    $pagesOut = @(Invoke-TrustedProductionNpm -Root $root run publish-pages -- --date $date --skip-audit 2>&1)
    $pagesExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after Pages publish")) { return $false }
    $pagesOut | Out-File -FilePath $logFile -Append -Encoding utf8
    $ok = ($pagesExit -eq 0)
    if ($ok) {
        if (-not (Assert-CleanProductionContract "before IndexNow")) {
            return $false
        }
        if (-not (Assert-PublicPublicationApproval "before IndexNow")) { return $false }
        $indexNowOut = @(Invoke-TrustedProductionNpm -Root $root run submit-indexnow -- --live 2>&1)
        $indexNowExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContract "after IndexNow")) { return $false }
        $indexNowOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($indexNowExit -ne 0) {
            Write-Log "IndexNow submission failed (exit $indexNowExit); skipping indexing audit."
            return $false
        }
        # Daily indexing push and audit: resubmits today's changed URLs plus the
        # landing pages, then verifies each is reachable and above the thin-page
        # floor. Thin pages are what Google reports as "crawled, currently not
        # indexed", so they get flagged the day they appear instead of silently
        # sitting in the sitemap. Never blocks the publish result.
        if (-not (Assert-CleanProductionContract "before indexing audit")) {
            return $false
        }
        if (-not (Assert-PublicPublicationApproval "before indexing audit")) { return $false }
        $indexAuditOut = @(Invoke-TrustedProductionNpm -Root $root run indexing-push -- --date $date 2>&1)
        $indexAuditExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContract "after indexing audit")) { return $false }
        $indexAuditOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($indexAuditExit -ne 0) {
            Write-Log "Indexing audit flagged thin or unreachable pages; see output\operations\indexing-push-$date.json"
            Show-Toast "$date 索引稽核有頁面過薄或連不到,請看 output\operations\indexing-push-$date.json"
        }
        Write-Log "Public site pushed, IndexNow submitted, indexing audit run."
    } else {
        Write-Log "publish-pages failed; assets exist locally but are not online."
        Show-Toast "$date 的公開站沒推上去,發文會被公開資產檢查擋下,請看 log。"
    }
    return $ok
}

function Invoke-DayCarouselVisualQa {
    if (-not (Assert-CleanProductionContract "before carousel visual QA")) { return $false }
    $qaOut = @(& (Join-Path $PSScriptRoot "generate-missing-images.ps1") -Date $date -QaOnly -RootOverride $root 2>&1)
    $qaExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after carousel visual QA")) { return $false }
    $qaOut | Out-File -FilePath $logFile -Append -Encoding utf8
    return ($qaExit -eq 0)
}

if ($hasCalendar -and $imagesReady) {
    Write-Log "Content calendar and images for $date are both ready; publishing the site refresh."
    if (-not (Invoke-DayCarouselVisualQa)) { exit 1 }
    if ((Lock-Day) -and (Publish-Site)) { exit 0 } else { exit 1 }
}

$codex = Resolve-TrustedProductionCodexExecutable -Root $root
if (-not $codex) {
    Write-Log "trusted Codex executable could not be established."
    Show-Toast "找不到 codex.cmd,今天的內容沒有生成。"
    Write-Log "No Codex generator is available; refusing site publish without a verified day lock."
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
    $imageManifestOut = @(Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --date $date 2>&1)
    $imageManifestExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after image manifest generation")) { exit 1 }
    $imageManifestOut | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($imageManifestExit -ne 0) {
        Write-Log "Image manifest generation failed (exit $imageManifestExit); refusing image backfill, lock, Pages, and IndexNow."
        exit 1
    }

    if (-not (Assert-CleanProductionContract "before image backfill")) { exit 1 }
    $backfillOut = @(& (Join-Path $PSScriptRoot "generate-missing-images.ps1") -Date $date -SkipPublicSite -RootOverride $root 2>&1)
    $backfillExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContract "after image backfill")) { exit 1 }
    $backfillOut | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($backfillExit -eq 0) {
        Write-Log "Images for $date are ready."
        # Third completion path. Both review families flagged that this branch
        # published without locking, which is exactly the 08-10 unlocked-day
        # hole surviving under a different entrance.
        if ((Lock-Day) -and (Publish-Site)) { exit 0 } else { exit 1 }
    }
    Write-Log "Image backfill for $date did not complete."
    Show-Toast "$date 的圖片沒有補齊,slot 1 可能發不出去,請看 log。"
    Write-Log "Image backfill is incomplete; refusing site publish without a verified day lock."
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
            $hookLine = ""
    try {
        $hooksRaw = [IO.File]::ReadAllText((Join-Path $root "data\hooks-bank.json"), [Text.UTF8Encoding]::new($false))
        $hooks = (ConvertFrom-Json $hooksRaw).hooks
        if ($hooks.Count -gt 0) {
            $pick = $hooks[(Get-Date).DayOfYear % $hooks.Count]
            $hookLine = "`nHook style reference for today (rewrite for the object, do not copy verbatim): $pick`n"
        }
    } catch {}
    $planLine = $hookLine + "`nToday's slot 1 MUST be about this object (from the committed 90-day plan): $plannedObject. Write a fresh hook and captions for it; do not substitute another object. Slot 1 topics from the last 7 days are off-limits.`n"
        Write-Log "Slot 1 planned object for ${date}: $plannedObject"
    }
    $prompt = @"
Run the 06:30 daily generation for $date (Asia/Taipei) exactly as defined in .agents/skills/daily-automation/SKILL.md.
$planLine
Generate the daily context, the content calendar, the image prompt manifest, the final images through the built-in image model, the image source records, and the video candidate manifest. Do not generate public SEO output or publish it: a separate post-generation approval gate owns that stage.

Stop and report if any required step cannot complete. Do not approve posts, do not write approved-log or posted-log entries, and do not publish to Facebook or Instagram: approval and publishing are separate stages.
"@
}

Write-Log "Starting Codex generation for $date."
Push-Location $root
$output = @(Invoke-TrustedProductionCodex -Root $root exec -C $root -s workspace-write $prompt 2>&1)
$exitCode = $LASTEXITCODE
Pop-Location

if (-not (Assert-CleanProductionContract "after Codex generation before writing output evidence")) { exit 1 }
$output | Out-File -FilePath $logFile -Append -Encoding utf8

if (-not (Assert-CleanProductionContract "after Codex generation")) { exit 1 }

if ($exitCode -ne 0) {
    Write-Log "Codex exited with $exitCode."
    Show-Toast "今天 ($date) 的內容生成失敗,請看 output\daily-generate-logs\$date.log"
    Write-Log "Codex generation failed; refusing site publish without a verified day lock."
    exit 1
}

# Codex exiting 0 is not proof the day can publish. The gate that matters is
# whether the images the calendar references are actually on disk.
$generatedValidateOut = @(Invoke-TrustedProductionNpm -Root $root run validate-publishable-images -- --date $date 2>&1)
$generatedValidateExit = $LASTEXITCODE
if (-not (Assert-CleanProductionContract "after generated image validation")) { exit 1 }
$generatedValidateOut | Out-File -FilePath $logFile -Append -Encoding utf8
$imagesReadyNow = ($generatedValidateExit -eq 0)

if ((Test-Path $calendar) -and $imagesReadyNow) {
    Write-Log "Generation finished; calendar and images are both ready."
    if (-not (Invoke-DayCarouselVisualQa)) { exit 1 }
    # Lock slot 1 the moment its images verifiably exist. Anything that rewrites
    # the calendar after this point gets healed back before approval/publish.
    # A deliberate slot-1 redo must delete data\day-locks\<date>.json first.
    if (-not (Lock-Day)) { exit 1 }
} elseif (Test-Path $calendar) {
    Write-Log "Codex finished but images for $date are still missing."
    Show-Toast "今天 ($date) 的圖片沒有生成完整,slot 1 可能發不出去,請看 log。"
    Write-Log "Images are incomplete; refusing site publish without a verified day lock."
    exit 1
} else {
    Write-Log "Codex finished but no content calendar was written."
    Show-Toast "生成流程跑完但沒有產生內容檔,請檢查 log。"
    Write-Log "Calendar is missing; refusing site publish without a verified day lock."
    exit 1
}

if (Publish-Site) { exit 0 } else { exit 1 }
