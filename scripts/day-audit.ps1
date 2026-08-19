# 22:50 end-of-day audit. Session-independent: every earlier rescue layer can
# die with a session or a disabled task, so the day's final verdict and the
# last-chance rescue live in Task Scheduler itself. Evidence-based only -- it
# reads posted-log / first-comments / youtube-log / tomorrow's assets, never
# exit codes or claims.
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
$tomorrow = $now.AddDays(1).ToString("yyyy-MM-dd")

$reportDir = Join-Path $root "output\day-reports"
$logFile = if ($ObserveOnly) { $null } else { Join-Path $reportDir "$date.log" }
. (Join-Path $PSScriptRoot "_production-contract.ps1")
if (-not $ObserveOnly) {
    $productionContract = Test-CleanProductionContract -Root $root
    if (-not $productionContract.ok) {
        [Console]::Error.WriteLine("BLOCKED production contract before day audit: $($productionContract.reason). No task re-arm, task start, network, or post action was run.")
        exit 1
    }
    $ProductionContractVerified = $true
    New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
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
    # calendar. Keep the release path fail-closed, but do not forge a tamper
    # verdict from a runtime/inspection failure.
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
# A tampered, missing, or unverifiable current calendar is not authority to
# re-arm a task. Still finish the read-only report below, but suppress every
# rescue and preserve the actual reason for the owner.
$calendarIntegrityBlockReason = switch ($calendarIntegrityState) {
    "tampered" { "blocked all rescues because the current calendar integrity is tampered" }
    "unverifiable" { "blocked all rescues because current calendar integrity inspection is unverifiable" }
    "missing" { "blocked all rescues because the current calendar is missing" }
    default { "blocked all rescues because current calendar integrity is not verified" }
}
$WatchdogObserveOnly = $ObserveOnly -or -not $calendarIntegrityOk
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Read-Json([string]$path) {
    # ConvertFrom-Json must be called in argument form, never piped: in PS 5.1
    # the pipeline emits a JSON array as ONE object, downstream Where-Object
    # then filters the array itself (property enumeration made every slot look
    # unposted in the first live test of this script).
    # One retry after a beat: writers use temp-file-then-rename, and the 22:50
    # run on 2026-08-10 hit exactly that rename window on youtube-log, counting
    # two live uploads as zero.
    foreach ($attempt in 1, 2) {
        try {
            $raw = [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
            $parsed = ConvertFrom-Json $raw
            return $parsed
        } catch {
            if ($attempt -eq 1 -and (Test-Path $path)) { Start-Sleep -Seconds 2 } else { return $null }
        }
    }
    return $null
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家每日結算")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryDayAudit").Show((New-Object Windows.UI.Notifications.ToastNotification($template)))
    } catch {}
}

function Test-ValidVideoSha([object]$value) {
    if ($null -eq $value) { return $false }
    return ([string]$value).Trim() -match '^[0-9A-Fa-f]{64}$'
}

# Normal post completion needs the same immutable transport identity that the
# publisher requires before it treats a row as done.  A success-looking row
# with missing evidence is an observation/data gap, not a recovery authority.
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

function Test-TrimmedNonEmptyString([object]$Value) {
    return $Value -is [string] -and $Value.Length -gt 0 -and $Value -ceq $Value.Trim()
}

function Get-VerifiedFirstCommentEvidenceState(
    [object[]]$Comments,
    [object[]]$Posted,
    [int[]]$LiveInstagramSlots,
    [string]$ExpectedDate
) {
    $verifiedSlots = @()
    $missingSlots = @()
    $gaps = @()
    foreach ($slot in $LiveInstagramSlots) {
        $records = @($Comments | Where-Object { $null -ne $_ -and ([string]$_.slot) -ceq ([string]$slot) })
        $reasons = @()
        if ($records.Count -ne 1) {
            $reasons += "expected exactly one first-comment record, found $($records.Count)"
        } else {
            $record = $records[0]
            if ($record.date -cne $ExpectedDate) { $reasons += "wrong date" }
            if ($record.slot -ne $slot) { $reasons += "wrong slot" }
            if (-not (Test-TrimmedNonEmptyString $record.comment_id)) { $reasons += "comment_id is missing or not trimmed" }
            if (-not (Test-TrimmedNonEmptyString $record.media_id)) { $reasons += "media_id is missing or not trimmed" }
            $transport = @($Posted | Where-Object {
                $null -ne $_ -and $_.date -ceq $ExpectedDate -and $_.slot -eq $slot -and $_.platform -ceq "instagram"
            })
            if ($transport.Count -ne 1 -or -not (Test-TrimmedNonEmptyString $transport[0].post_id)) {
                $reasons += "matching Instagram transport is missing or ambiguous"
            } elseif ($record.media_id -cne $transport[0].post_id) {
                $reasons += "media_id does not bind to the live Instagram transport"
            }
        }
        if ($reasons.Count -eq 0) {
            $verifiedSlots += $slot
        } else {
            $missingSlots += $slot
            $gaps += [pscustomobject]@{ slot = $slot; reasons = @($reasons) }
        }
    }
    return [pscustomobject]@{
        verified_slots = @($verifiedSlots | Sort-Object -Unique)
        missing_slots = @($missingSlots | Sort-Object -Unique)
        gaps = @($gaps)
    }
}

function Test-ExpectedMetaPermalink([object]$value, [string]$platform) {
    if ($null -eq $value) { return $false }
    try {
        $uri = [Uri]([string]$value)
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https") { return $false }
        $permalinkHost = $uri.Host.ToLowerInvariant()
        if ($platform -eq "instagram") {
            return ($permalinkHost -eq "instagram.com" -or $permalinkHost.EndsWith(".instagram.com"))
        }
        return ($permalinkHost -eq "facebook.com" -or $permalinkHost.EndsWith(".facebook.com") -or $permalinkHost -eq "fb.watch" -or $permalinkHost.EndsWith(".fb.watch"))
    } catch {
        return $false
    }
}

function Test-VerifiedRemoteReelEvidence([object]$entry, [string]$platform) {
    $evidence = $entry.remote_reel_evidence
    if ($null -eq $evidence) { return $false }
    $postId = ([string]$entry.post_id).Trim()
    $remoteId = ([string]$evidence.remote_id).Trim()
    if (-not $postId -or $remoteId -ne $postId) { return $false }
    if ($evidence.remote_media_type -cne "REELS" -or $evidence.caption_exact_match -ne $true) { return $false }
    if (-not (Test-ExpectedMetaPermalink -value $evidence.permalink -platform $platform)) { return $false }
    [DateTimeOffset]$verifiedAt = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse([string]$evidence.verified_at, [ref]$verifiedAt)
}

function Get-ReelDeliveryQualification(
    [object]$entry,
    [string]$platform,
    [string]$expectedDate,
    [int]$expectedSlot
) {
    $reasons = @()
    if ($entry.date -cne $expectedDate) { $reasons += "wrong date" }
    if ($entry.slot -ne $expectedSlot) { $reasons += "wrong slot" }
    if ($entry.platform -cne $platform) { $reasons += "wrong platform" }
    if ($entry.dry_run -isnot [bool] -or $entry.dry_run) { $reasons += "dry_run is not false" }
    if ($entry.status -cnotin @("success", "posted")) { $reasons += "status is not live success" }
    if ($entry.published_media_type -cne "reel") { $reasons += "published media is not reel" }
    if ($entry.video_status -cne "published") { $reasons += "video is not published" }
    if (-not (Test-ValidVideoSha -value $entry.video_sha256)) { $reasons += "video_sha256 is missing or invalid" }
    if (-not (Test-VerifiedRemoteReelEvidence -entry $entry -platform $platform)) { $reasons += "remote Reel evidence is missing or invalid" }
    $sha = if ((Test-ValidVideoSha -value $entry.video_sha256)) { ([string]$entry.video_sha256).Trim().ToLowerInvariant() } else { $null }
    return [pscustomobject]@{ qualified = $reasons.Count -eq 0; sha = $sha; reasons = @($reasons) }
}

# --- posts ------------------------------------------------------------------
$posted = @(Read-Json (Join-Path $root "data\posted-log\$date.json"))
$slotState = @{}
$transportEvidenceGaps = @()
foreach ($slot in 1, 2, 3) {
    $ig = Get-StrictTransportCompletionQualification -Entries $posted -ExpectedDate $date -ExpectedSlot $slot -ExpectedPlatform "instagram"
    $fb = Get-StrictTransportCompletionQualification -Entries $posted -ExpectedDate $date -ExpectedSlot $slot -ExpectedPlatform "facebook"
    $slotState["$slot"] = @{ instagram = $ig.qualified; facebook = $fb.qualified }
    if (-not $ig.qualified -and $ig.claims_live) {
        $transportEvidenceGaps += [pscustomobject]@{ slot = $slot; platform = "instagram"; reasons = @($ig.reasons) }
    }
    if (-not $fb.qualified -and $fb.claims_live) {
        $transportEvidenceGaps += [pscustomobject]@{ slot = $slot; platform = "facebook"; reasons = @($fb.reasons) }
    }
}
# Slot 3 may legitimately be absent on 2-slot calendars.
$calendar = Read-Json (Join-Path $root "data\content-calendar\$date.json")
$calendarReadOk = $calendarIntegrityOk -and $null -ne $calendar -and $calendar.PSObject.Properties.Name -contains "slots"
$calendarSlots = @($calendar.slots)
$hasSlot3 = @($calendarSlots | Where-Object { $_.slot -eq 3 }).Count -gt 0
$expectedSlots = if ($hasSlot3) { @(1, 2, 3) } else { @(1, 2) }
$missingPosts = @($expectedSlots | Where-Object { -not ($slotState["$_"].instagram -and $slotState["$_"].facebook) })
$transportEvidenceGaps = @($transportEvidenceGaps | Where-Object { $_.slot -in $expectedSlots })
$transportEvidenceGapSlots = @(
    $transportEvidenceGaps |
        ForEach-Object { [int]$_.slot } |
        Sort-Object -Unique
)

# A calendar-declared Reel is a delivery obligation in its own right.  It may
# not be inferred from the YouTube bridge because an image fallback produces no
# IG Reel candidate there; treating that empty reconciliation as green hid the
# exact failure this audit exists to surface.
$plannedReelSlots = @(
    $calendarSlots |
        Where-Object { $_.media_type -ceq "reel" -and ([string]$_.slot) -match '^[1-9][0-9]*$' } |
        ForEach-Object { [int]$_.slot } |
        Sort-Object -Unique
)
$deliveredPlannedReels = @()
$missingPlannedReels = @()
$plannedReelEvidenceGaps = @()
foreach ($plannedSlot in $plannedReelSlots) {
    $facebook = Get-StrictTransportCompletionQualification -Entries $posted -ExpectedDate $date -ExpectedSlot $plannedSlot -ExpectedPlatform "facebook" -RequireReel
    $instagram = Get-StrictTransportCompletionQualification -Entries $posted -ExpectedDate $date -ExpectedSlot $plannedSlot -ExpectedPlatform "instagram" -RequireReel
    if ($facebook.qualified -and $instagram.qualified -and $facebook.sha -ceq $instagram.sha) {
        $deliveredPlannedReels += $plannedSlot
        continue
    }

    $reasons = @()
    if (-not $facebook.qualified) { $reasons += "facebook: " + ($facebook.reasons -join ", ") }
    if (-not $instagram.qualified) { $reasons += "instagram: " + ($instagram.reasons -join ", ") }
    if ($facebook.qualified -and $instagram.qualified -and $facebook.sha -cne $instagram.sha) {
        $reasons += "facebook and instagram video_sha256 do not match"
    }
    $missingPlannedReels += $plannedSlot
    $plannedReelEvidenceGaps += [pscustomobject]@{ slot = $plannedSlot; reasons = @($reasons) }
}

# --- first comments ----------------------------------------------------------
# first-comments is a completion record, not a CLI success flag. Bind its
# immutable media id to today's exact live Instagram transport before it can
# suppress a recovery attempt or turn the audit green.
$comments = @(Read-Json (Join-Path $root "data\first-comments\$date.json"))
$liveIgSlots = @($expectedSlots | Where-Object { $slotState["$_"].instagram })
$commentEvidence = Get-VerifiedFirstCommentEvidenceState -Comments $comments -Posted $posted -LiveInstagramSlots $liveIgSlots -ExpectedDate $date
$missingComments = @($commentEvidence.missing_slots)

# --- YouTube ------------------------------------------------------------------
$reconciliationOk = $true
$reconciliationError = $null
$expectedReelSlots = @()
$uploadedReelSlots = @()
$missingReelSlots = @()
$unexpectedYouTubeSlots = @()
try {
    $reconciliation = Get-PublishingReconciliation -Root $root -Date $date
    $expectedReelSlots = @($reconciliation.expected_reel_slots)
    $uploadedReelSlots = @($reconciliation.uploaded_reel_slots)
    $missingReelSlots = @($reconciliation.missing_reel_slots)
    $unexpectedYouTubeSlots = @($reconciliation.unexpected_youtube_slots)
} catch {
    # A broken observation path must not look like a day with zero Reels.
    # It also must not start a blind upload retry.
    $reconciliationOk = $false
    $reconciliationError = $_.Exception.Message
}
$liveReels = $expectedReelSlots.Count
$ytCount = $uploadedReelSlots.Count
$ytGap = $missingReelSlots.Count

# --- tomorrow readiness --------------------------------------------------------
$tomorrowCalendar = Test-Path (Join-Path $root "data\content-calendar\$tomorrow.json")
$tomorrowReels = if ($tomorrowCalendar) { "inspection-pending" } else { "calendar-missing" }
$tomorrowReelReadiness = $null
if ($tomorrowCalendar) {
    try {
        $tomorrowReelReadiness = Get-PlannedReelReadiness -Root $root -Date $tomorrow
        $tomorrowReels = switch ($tomorrowReelReadiness.status) {
            "ready" { "ready" }
            "not_planned" { "not-planned" }
            "blocked" { "blocked" }
            default { "inspection-failed" }
        }
    } catch {
        $tomorrowReels = "inspection-failed"
        $tomorrowReelReadiness = @{ status = "inspection-failed"; error = $_.Exception.Message }
    }
}

# --- last-chance rescues ---------------------------------------------------------
$actions = @()
if (-not $calendarIntegrityOk) {
    $actions += $calendarIntegrityBlockReason
} elseif ($reconciliationOk -and $missingReelSlots.Count -gt 0 -and $missingPlannedReels.Count -eq 0) {
    if ($ObserveOnly) {
        $actions += "would start YouTube upload for Reel slot(s) $($missingReelSlots -join ',') ($ytCount/$liveReels)"
    } else {
        if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube task start")) {
            $actions += "blocked YouTube task start because the production contract drifted"
            exit 1
        } else {
        Start-ScheduledTask -TaskName "Laundry-YouTube-Upload" -ErrorAction SilentlyContinue
        # Task Scheduler accepting a request does not prove an upload ran.
        # Keep the day red until a later reconciliation sees the matching log.
        $actions += "requested YouTube upload for Reel slot(s) $($missingReelSlots -join ',') ($ytCount/$liveReels); completion unverified"
        }
    }
} elseif ($reconciliationOk -and $missingReelSlots.Count -gt 0 -and $missingPlannedReels.Count -gt 0) {
    $actions += "blocked YouTube rescue because planned Reel delivery is incomplete for slot(s) $($missingPlannedReels -join ',')"
}
if ($calendarIntegrityOk -and $missingComments.Count -gt 0) {
    if ($ObserveOnly) {
        $actions += "would post first comments for slot $($missingComments -join ',')"
    } else {
        Push-Location $root
        $fcOut = Invoke-TrustedProductionNpm -Root $root run first-comment -- --date $date 2>&1
        $fcExit = $LASTEXITCODE
        Pop-Location
        $fcOut | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($fcExit -eq 0) {
            # An exit 0 can mean dry-run/already-skipped. Re-read the durable,
            # media-bound evidence before calling a comment posted.
            $comments = @(Read-Json (Join-Path $root "data\first-comments\$date.json"))
            $commentEvidence = Get-VerifiedFirstCommentEvidenceState -Comments $comments -Posted $posted -LiveInstagramSlots $liveIgSlots -ExpectedDate $date
            $missingComments = @($commentEvidence.missing_slots)
            if ($missingComments.Count -eq 0) {
                $actions += "verified first-comment evidence for slot $($liveIgSlots -join ',')"
            } else {
                $actions += "first-comment exited 0 but verified evidence is still missing for slot $($missingComments -join ','); not counted as posted"
            }
        } else {
            $actions += "first-comment failed (exit $fcExit) for slot $($missingComments -join ',')"
            Write-Host "first-comment failed (exit $fcExit): $fcOut"
        }
    }
}

# --- GA4 line_click into the leads ledger ------------------------------------
# Reporting only, never a gate: an unconfigured or failing read side writes
# source_clicks_status="unmeasured" and the settlement carries on. What it must
# never do is write a zero -- the whole reason this exists is that a zero
# nobody fetched was being read as evidence that nobody clicked.
#
# Moved ahead of the report so the number can appear in it. It used to run as
# the last line of the script, writing into data/leads/<month>.json and nothing
# else. On 08-14 that file recorded 14 clicks -- the first non-zero this
# programme has ever measured, after thirty days of nothing -- and not one
# thing surfaced it. A number nobody sees is worth the same as no number.
if (-not $ObserveOnly -and $calendarIntegrityOk) {
    Push-Location $root
    Invoke-TrustedProductionNpm -Root $root run ga4-report -- --date $date 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}

$clicks = $null
$clickSources = ""
$ledger = Read-Json (Join-Path $root "data\leads\$($now.ToString('yyyy-MM')).json")
if ($ledger -and $ledger.days -and $ledger.days.$date) {
    $today = $ledger.days.$date
    $clicks = $today.line_clicks_total
    if ($today.source_clicks) {
        $clickSources = (
            $today.source_clicks.PSObject.Properties |
                Sort-Object { -[int]$_.Value } |
                ForEach-Object { "$($_.Name) $($_.Value)" }
        ) -join "、"
    }
}
$clickLine = if ($null -eq $clicks) { "LINE 點擊:查不到" }
             elseif ($clickSources) { "LINE 點擊 $clicks($clickSources)" }
             else { "LINE 點擊 $clicks" }

# --- report -----------------------------------------------------------------------
$ok = $calendarReadOk -and ($missingPosts.Count -eq 0) -and ($transportEvidenceGaps.Count -eq 0) -and ($missingComments.Count -eq 0) -and ($missingPlannedReels.Count -eq 0) -and $reconciliationOk -and ($missingReelSlots.Count -eq 0) -and ($unexpectedYouTubeSlots.Count -eq 0) -and $tomorrowCalendar -and ($tomorrowReels -eq "ready" -or $tomorrowReels -eq "not-planned")
$report = [ordered]@{
    date              = $date
    generated_at      = $now.ToString("yyyy-MM-ddTHH:mm:ss")
    ok                = $ok
    slots             = $slotState
    missing_posts     = $missingPosts
    calendar_integrity = @{
        present = $calendarIntegrity.present
        tampered = $calendarIntegrity.tampered
        inspection_status = $calendarIntegrityState
        error = $calendarIntegrity.error
    }
    transport_evidence = @{
        data_gap_slots = $transportEvidenceGapSlots
        gaps = $transportEvidenceGaps
    }
    missing_comments  = $missingComments
    first_comment_evidence = @{
        verified_slots = @($commentEvidence.verified_slots)
        gaps = @($commentEvidence.gaps)
    }
    planned_reels     = @{
        calendar_read_ok = $calendarReadOk
        required_slots = $plannedReelSlots
        delivered_slots = $deliveredPlannedReels
        missing_planned_reels = $missingPlannedReels
        evidence_gaps = $plannedReelEvidenceGaps
    }
    youtube           = @{
        reconciliation = if ($reconciliationOk) { "ok" } else { "failed" }
        error = $reconciliationError
        expected_reel_slots = $expectedReelSlots
        uploaded_reel_slots = $uploadedReelSlots
        missing_reel_slots = $missingReelSlots
        unexpected_youtube_slots = $unexpectedYouTubeSlots
        live_reels = $liveReels
        uploaded = $ytCount
    }
    tomorrow          = @{ calendar = $tomorrowCalendar; reels = $tomorrowReels; reel_readiness = $tomorrowReelReadiness }
    rescue_actions    = $actions
    line_clicks       = $clicks
    line_click_sources = $clickSources
}
$reportPath = Join-Path $reportDir "$date.json"
if ($ObserveOnly) {
    $report | ConvertTo-Json -Depth 5
    if ($ok) { exit 0 }
    exit 1
}
if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "day audit report write")) { exit 1 }
$report | ConvertTo-Json -Depth 5 | Out-File -FilePath $reportPath -Encoding utf8

# The clicks number rides on both branches. It is the only number on this line
# that tracks whether any of the work reached a person, so it must not be
# something you see only on a day that also went wrong.
if ($ok) {
    Show-Toast "$date 全部完成:$($expectedSlots.Count) 檔已發、頭香齊、YT $ytCount/$liveReels、明日備料 OK。$clickLine"
} else {
    $gaps = @()
    if ($calendarIntegrityState -ceq "tampered") { $gaps += "今日行事曆完整性遭竄改" }
    elseif ($calendarIntegrityState -ceq "unverifiable") { $gaps += "今日行事曆完整性無法驗證" }
    elseif ($calendarIntegrityState -ceq "missing") { $gaps += "今日行事曆缺失" }
    elseif (-not $calendarReadOk) { $gaps += "今日行事曆無法讀取" }
    if ($missingPosts.Count -gt 0) { $gaps += "缺發文 slot $($missingPosts -join ',')" }
    if ($transportEvidenceGapSlots.Count -gt 0) { $gaps += "發文運輸憑證資料缺口 slot $($transportEvidenceGapSlots -join ',')" }
    if ($missingComments.Count -gt 0) { $gaps += "缺頭香 slot $($missingComments -join ',')" }
    if ($missingPlannedReels.Count -gt 0) { $gaps += "缺已排定 Reel 證據 slot $($missingPlannedReels -join ',')" }
    if (-not $reconciliationOk) { $gaps += "YT 對帳失敗" }
    elseif ($missingReelSlots.Count -gt 0) { $gaps += "YT 缺 Reel slot $($missingReelSlots -join ',')" }
    if ($unexpectedYouTubeSlots.Count -gt 0) { $gaps += "YT 有不對應紀錄 slot $($unexpectedYouTubeSlots -join ',')" }
    if (-not $tomorrowCalendar) { $gaps += "明日行事曆缺" }
    if ($tomorrowReels -eq "blocked") { $gaps += "明日 Reel 未通過發布驗收" }
    elseif ($tomorrowReels -eq "inspection-failed") { $gaps += "明日 Reel 驗收無法執行" }
    Show-Toast ("$date 有缺口:" + ($gaps -join ";") + "。$clickLine。報告:output\day-reports\$date.json")
}

if ($ok) { exit 0 }
exit 1
