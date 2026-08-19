# Catch-up publisher for the daily 私享家 FB/IG slots.
# Safe to run repeatedly: post-current-slot enforces canonical public approval
# and skips slots already recorded in posted-log. Same-day catch-up is
# authorized by data/publishing-policy.json (same_day_catch_up: true).
[CmdletBinding()]
param(
    [string]$RootOverride,
    [string]$NowOverride
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

$logDir = Join-Path $root "output\catch-up-logs"
$logFile = Join-Path $logDir "$date.log"

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

. (Join-Path $PSScriptRoot "_production-contract.ps1")
$productionContract = Test-CleanProductionContract -Root $root
if (-not $productionContract.ok) {
    [Console]::Error.WriteLine("BLOCKED production contract before catch-up: $($productionContract.reason). No lock, task re-arm, network, or post action was run.")
    exit 1
}

# The initial inspection is only an admission check.  This job can run for
# minutes and executes checked-out code, so every state-changing or remote
# boundary below must prove the same contract again immediately before it runs.
function Assert-CleanProductionContractBeforeAction([string]$stage, [string]$Root = $root) {
    $check = Test-CleanProductionContract -Root $Root
    if ($check.ok) { return $true }
    $message = "BLOCKED production contract before ${stage}: $($check.reason). No action at this boundary or any later boundary was run."
    Write-Log $message
    [Console]::Error.WriteLine($message)
    return $false
}

$ProductionContractVerified = $true
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$WatchdogObserveOnly = $false
if (-not (Assert-CleanProductionContractBeforeAction "watchdog task re-arm")) { exit 1 }
. (Join-Path $PSScriptRoot "_watchdog.ps1")
. (Join-Path $PSScriptRoot "_publishing-reconciliation.ps1")

# All decisions that suppress a stale-slot alert or authorize a follow-up use
# the shared canonical transport qualification.  A success-looking row is not
# evidence by itself: the bridge rejects cross-date rows, duplicate tuples,
# non-boolean dry_run, and non-trimmed/missing remote IDs.
function Get-StrictDualPlatformTransportQualification(
    [object[]]$Entries,
    [string]$ExpectedDate,
    [int]$ExpectedSlot
) {
    $qualified = $true
    $claimsLive = $false
    $reasons = @()
    foreach ($platform in @("facebook", "instagram")) {
        $qualification = Get-StrictTransportCompletionQualification -Entries $Entries -ExpectedDate $ExpectedDate -ExpectedSlot $ExpectedSlot -ExpectedPlatform $platform
        if ($qualification.claims_live) { $claimsLive = $true }
        if (-not $qualification.qualified) {
            $qualified = $false
            foreach ($reason in @($qualification.reasons)) {
                $reasons += ("{0}: {1}" -f $platform, $reason)
            }
        }
    }
    return [pscustomobject]@{
        qualified   = $qualified
        claims_live = $claimsLive
        reasons     = @($reasons)
    }
}

function Get-StrictDualPlatformTransportFromDisk(
    [string]$ExpectedDate,
    [int]$ExpectedSlot
) {
    $postedPath = Join-Path $root "data\posted-log\$ExpectedDate.json"
    if (-not (Test-Path $postedPath)) {
        return [pscustomobject]@{
            qualified   = $false
            claims_live = $false
            reasons     = @("posted-log is missing")
        }
    }
    try {
        $raw = [IO.File]::ReadAllText($postedPath, [Text.UTF8Encoding]::new($false))
        # Keep the parsed root array as an array of rows.  In Windows
        # PowerShell, wrapping ConvertFrom-Json directly can turn an array
        # into one Object[] candidate and falsely report every tuple missing.
        $parsed = ConvertFrom-Json $raw
        $entries = @($parsed)
        return Get-StrictDualPlatformTransportQualification -Entries $entries -ExpectedDate $ExpectedDate -ExpectedSlot $ExpectedSlot
    } catch {
        return [pscustomobject]@{
            qualified   = $false
            claims_live = $false
            reasons     = @("posted-log cannot be parsed: $($_.Exception.Message)")
        }
    }
}

function Get-StrictDualPlatformTransportSlots([string]$ExpectedDate) {
    $eligible = @()
    foreach ($candidateSlot in 1, 2, 3) {
        $qualification = Get-StrictDualPlatformTransportFromDisk -ExpectedDate $ExpectedDate -ExpectedSlot $candidateSlot
        if ($qualification.qualified) {
            $eligible += $candidateSlot
        }
    }
    return @($eligible)
}

# `src/dayLock.ts` emits these exact, single-line proofs only after it has
# validated the signed lock and (for lock creation/idempotency) the current
# canonical calendar binding. An exit code or a human-looking result such as
# "no lock" is not authorization for Pages, IndexNow, approval, or posting.
function Test-VerifiedDayLockProof(
    [object[]]$Output,
    [string]$ExpectedDate,
    [ValidateSet("lock", "heal")][string]$Kind
) {
    $prefix = if ($Kind -eq "lock") { "DAY_LOCK_VERIFIED" } else { "DAY_LOCK_HEAL_VERIFIED" }
    $actions = if ($Kind -eq "lock") { "(?:locked|already-locked)" } else { "(?:intact|restored)" }
    $text = (@($Output | ForEach-Object { [string]$_ }) -join "`n")
    $escapedDate = [regex]::Escape($ExpectedDate)
    $pattern = "(?m)^$prefix date=$escapedDate action=$actions calendar_checksum=[a-f0-9]{16} lock_checksum=[a-f0-9]{64}\s*$"
    return ([regex]::Matches($text, $pattern)).Count -eq 1
}

Write-Log "Catch-up run started (Taipei time $($now.ToString('HH:mm')))."

# Restore today's scheduled Reel before publishing anything: a morning rewrite
# of the calendar (it has happened three times) must cost nothing more than
# this heal step. No-op when the slot is already correct.
# Slot 1 heals from the day lock too: on 2026-08-07 a morning rewrite swapped
# slot 1's topic after the images were made, and the mismatch published.
# Create-if-absent first: on 2026-08-10 the images arrived hours after 06:30,
# no generate branch ever locked the day, and a midday rewrite went unhealed.
# Locking at first publish attempt freezes whatever is about to be published.
if (-not (Assert-CleanProductionContractBeforeAction "day-lock")) { exit 1 }
$lockOut = @(Invoke-TrustedProductionNpm -Root $root run day-lock -- --date $date 2>&1)
$lockExit = $LASTEXITCODE
$lockOut | Out-File -FilePath $logFile -Append -Encoding utf8
$lockVerified = Test-VerifiedDayLockProof -Output $lockOut -ExpectedDate $date -Kind "lock"
if (-not (Assert-CleanProductionContractBeforeAction "day-lock heal")) { exit 1 }
$healOut = @(Invoke-TrustedProductionNpm -Root $root run day-lock -- --date $date --heal 2>&1)
$healExit = $LASTEXITCODE
$healOut | Out-File -FilePath $logFile -Append -Encoding utf8
$healVerified = Test-VerifiedDayLockProof -Output $healOut -ExpectedDate $date -Kind "heal"
if (-not (Assert-CleanProductionContractBeforeAction "Reel-slot heal")) { exit 1 }
Invoke-TrustedProductionNpm -Root $root run heal-reel-slot -- --date $date 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
$reelHealExit = $LASTEXITCODE
# A failed heal means the calendar may still be clobbered; publishing an
# unrepaired package is worse than publishing late (luna, high).
if ($lockExit -ne 0 -or -not $lockVerified -or $healExit -ne 0 -or -not $healVerified -or $reelHealExit -ne 0) {
    Write-Log "Lock/heal step failed or lacked verified proof (lock=$lockExit lockProof=$lockVerified heal=$healExit healProof=$healVerified reel=$reelHealExit); refusing to publish."
    Show-Toast "$date 自癒步驟失敗,補發已停止,請看 output\catch-up-logs\$date.log"
    exit 1
}

function Assert-PublicPublicationApproval([string]$stage) {
    # Do not reconstruct a weaker PowerShell approval reader here. The public
    # publisher owns the full contract (including video source/review binding),
    # so catch-up invokes that exact assertion through the checked immutable
    # TSX runtime. A failed or unparsable verdict is a data gap, never a
    # fallback to the raw approved-log.
    $inline = @'
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const [date, root] = process.argv.slice(2);
try {
  const approval = await import(pathToFileURL(join(root, "src", "publicPublicationApproval.ts")).href);
  await approval.assertCanonicalPublicPublicationApproval(date, root);
  console.log(JSON.stringify({ ok: true, date, gaps: [] }));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    date,
    gaps: [error instanceof Error ? error.message : String(error)]
  }));
}
'@
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inline))
    $bootstrap = '(async()=>{await import(`data:text/javascript;base64,${process.argv[1]}`)})()'
    try {
        $output = @(Invoke-TrustedProductionTsx -Root $root --eval $bootstrap -- $payload $date $root 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "canonical public-approval assertion runner failed (exit $LASTEXITCODE)." }
        $lines = @($output | Where-Object { ([string]$_).TrimStart().StartsWith("{") })
        if ($lines.Count -ne 1) { throw "canonical public-approval assertion returned an ambiguous JSON verdict." }
        $approval = $lines[0] | ConvertFrom-Json
        if ($null -eq $approval -or $approval.PSObject.Properties.Name -notcontains "ok" -or $approval.ok -isnot [bool]) {
            throw "canonical public-approval assertion returned an invalid verdict."
        }
        if ($approval.ok) { return $true }
        $gaps = if ($null -eq $approval.gaps) { @("canonical public approval was rejected") } else { @($approval.gaps | ForEach-Object { [string]$_ }) }
        Write-Log "BLOCKED public publication ${stage}: canonical approval assertion rejected the package."
        $gaps | ForEach-Object { Write-Log ("BLOCKED public-approval gap: " + $_) }
        return $false
    } catch {
        Write-Log "BLOCKED public publication ${stage}: canonical approval assertion could not be verified."
        Write-Log ("BLOCKED public-approval gap: " + $_.Exception.Message)
        return $false
    }
}
# The scheduled catch-up worker cannot create or infer its own release
# authority. A canonical verdict is required before auto-approval, any public
# site/indexing path, post-current-slot, or later remote follow-ups. In
# particular, a present approved-log is not authority: duplicate, cross-date,
# forced, missing-sidecar, tampered, or unbound-video evidence stops here.
if (-not (Assert-PublicPublicationApproval "before catch-up publication, auto-approval, and public/external actions")) {
    Show-Toast "今天 ($date) 正式核准證據不完整，補發與所有對外動作已停止。"
    exit 1
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
if (-not (Test-Path $indexingRecord) -and (Assert-PublicPublicationApproval "before IndexNow")) {
    if (-not (Assert-CleanProductionContractBeforeAction "IndexNow submission")) { exit 1 }
    Write-Log "No indexing record for $date; submitting IndexNow and running the indexing audit now."
    Invoke-TrustedProductionNpm -Root $root run submit-indexnow -- --live 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    if (-not (Assert-CleanProductionContractBeforeAction "IndexNow audit")) { exit 1 }
    Invoke-TrustedProductionNpm -Root $root run indexing-push -- --date $date 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
}

# Local images exist but the public copies are not live. Publishing verifies the
# public URL, so this 404s every attempt and the day stalls with nothing to fix
# it -- 2026-08-15: the site was pushed at 06:30:02 and the images landed at
# 06:50, so every publish from 11:30 onward failed on an asset that was sitting
# right there on disk. The push and the images had simply happened in the wrong
# order, and nothing downstream re-pushed.
#
# Checked against the hero image of the first approved slot: if the file is here
# and the web says 404, the site is stale, so push it again.
$heroLocal = Join-Path $root "docs\assets\$date\slot-01.png"
if ((Test-Path $heroLocal) -and (Assert-PublicPublicationApproval "before public-site regeneration")) {
    $heroUrl = "https://39211.github.io/assets/$date/slot-01.png"
    # curl.exe, not Invoke-WebRequest. Under Task Scheduler PowerShell runs
    # NonInteractive, where Invoke-WebRequest throws "Read and Prompt
    # functionality is not available" before it ever reaches the network --
    # every check would fail, every run would decide the site was stale, and it
    # would re-push six times a day forever. Verified on this box: curl returns
    # 200 on the same URL that makes Invoke-WebRequest throw.
    if (-not (Assert-CleanProductionContractBeforeAction "hero public URL probe")) { exit 1 }
    $trustedCurl = Resolve-TrustedProductionCurlExecutable -Root $root
    if (-not $trustedCurl) {
        Write-Log "BLOCKED hero public URL probe: trusted system curl.exe could not be established."
        exit 1
    }
    $heroOutput = & $trustedCurl -s -S -o NUL -w "%{http_code}" --max-time 20 $heroUrl 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "curl hero check failed (exit $LASTEXITCODE): $heroOutput"
        $heroLive = $true
    } else {
        $heroCode = [string]$heroOutput
        $heroLive = ($heroCode -eq "200")
    }
    if (-not $heroLive) {
        if (-not (Assert-CleanProductionContractBeforeAction "public-site generation")) { exit 1 }
        Write-Log "Local images exist for $date but $heroUrl is not live; re-publishing the site."
        Invoke-TrustedProductionNpm -Root $root run generate-public-site 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
        if (-not (Assert-CleanProductionContractBeforeAction "Pages publication")) { exit 1 }
        Invoke-TrustedProductionNpm -Root $root run publish-pages -- --date $date --skip-audit 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    }
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
        foreach ($staleSlot in $staleSlots) {
            $qualification = Get-StrictDualPlatformTransportFromDisk -ExpectedDate $date -ExpectedSlot $staleSlot
            if ($qualification.qualified) { continue }
            $unposted += $staleSlot
            $reasonText = (@($qualification.reasons) -join "; ")
            Write-Log ("Slot $staleSlot stale transport evidence gap; treating it as unverified/unposted: $reasonText")
        }
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

    Push-Location $root
    # Explicit --date: PowerShell resolves Taipei but Node falls back to its
    # own TIMEZONE env; around midnight the two can disagree and publish
    # yesterday's slot into today's logs (luna, high).
    if (-not (Assert-PublicPublicationApproval "before post-current-slot for slot $slot")) {
        Pop-Location
        exit 1
    }
    if (-not (Assert-CleanProductionContractBeforeAction "post-current-slot for slot $slot")) {
        Pop-Location
        exit 1
    }
    Write-Log "Running post-current-slot --slot $slot"
    $output = Invoke-TrustedProductionNpm -Root $root run post-current-slot -- --slot $slot --date $date 2>&1
    $exitCode = $LASTEXITCODE
    Pop-Location
    $output | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($exitCode -ne 0) {
        # The exit code alone is not evidence, but neither is a success-looking
        # ledger row. A non-zero result is safe-published only when this exact
        # tuple has one strict live transport record on both platforms.
        $qualification = Get-StrictDualPlatformTransportFromDisk -ExpectedDate $date -ExpectedSlot $slot
        if ($qualification.qualified) {
            Write-Log "Slot $slot exited $exitCode but strict transport evidence confirms both platforms; treating as published."
        } else {
            Write-Log ("Slot $slot failed with exit code $exitCode or incomplete/ambiguous transport evidence: " + (@($qualification.reasons) -join "; "))
            $failed += $slot
        }
    } else {
        Write-Log "Slot $slot finished (published or already recorded)."
    }
}

# Follow-up side effects are per slot. Do not let a malformed tuple turn the
# broad --date command into permission to comment or share; meanwhile a clean
# slot remains independent of another slot's failed claim or ledger row.
$followUpSlots = @(Get-StrictDualPlatformTransportSlots -ExpectedDate $date)
if ($followUpSlots.Count -eq 0) {
    Write-Log "No slot has strict dual-platform transport evidence; first comments and Stories are blocked."
} else {
    Push-Location $root
    foreach ($followUpSlot in $followUpSlots) {
        # Re-read the ledger immediately before each remote side effect. The
        # broad selection above is only a snapshot; a concurrent write must
        # turn into a data gap rather than permission to comment or share.
        $beforeComment = Get-StrictDualPlatformTransportFromDisk -ExpectedDate $date -ExpectedSlot $followUpSlot
        if (-not $beforeComment.qualified) {
            Write-Log ("Slot $followUpSlot transport evidence changed before first-comment; blocking follow-up: " + (@($beforeComment.reasons) -join "; "))
            continue
        }
        if (-not (Assert-CleanProductionContractBeforeAction "first-comment for slot $followUpSlot")) {
            Pop-Location
            exit 1
        }
        if (-not (Assert-PublicPublicationApproval "before first-comment for slot $followUpSlot")) {
            Pop-Location
            exit 1
        }
        Invoke-TrustedProductionNpm -Root $root run first-comment -- --date $date --slot $followUpSlot 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
        # postStory accepts --slot so an unqualified sibling can never be
        # swept up merely because this eligible slot is being re-shared.
        $beforeStory = Get-StrictDualPlatformTransportFromDisk -ExpectedDate $date -ExpectedSlot $followUpSlot
        if (-not $beforeStory.qualified) {
            Write-Log ("Slot $followUpSlot transport evidence changed before share-story; blocking follow-up: " + (@($beforeStory.reasons) -join "; "))
            continue
        }
        if (-not (Assert-CleanProductionContractBeforeAction "share-story for slot $followUpSlot")) {
            Pop-Location
            exit 1
        }
        if (-not (Assert-PublicPublicationApproval "before share-story for slot $followUpSlot")) {
            Pop-Location
            exit 1
        }
        Invoke-TrustedProductionNpm -Root $root run share-story -- --date $date --slot $followUpSlot 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    }
    Pop-Location
}

if ($failed.Count -gt 0) {
    Show-Toast ("今天 slot {0} 補發失敗,請看 output\catch-up-logs\{1}.log" -f ($failed -join ", "), $date)
    exit 1
}

# Nothing else reads the repair queue, so a deferred video would otherwise sit
# there unseen. An "unexpected" defer means the video check itself failed and is
# a defect to fix, not a job waiting on review. A frozen_at stamp (R-FREEZE
# ruling, docs-internal/OPTIMIZE-LOOP-20260817.md) is a fault already ruled on
# and parked until its unfreeze condition; alarming nightly on a parked fault
# only trains people to ignore the toast.
$queuePath = Join-Path $root "data\video-repair-queue\queue.json"
if (Test-Path $queuePath) {
    try {
        # Assign before wrapping: in PowerShell 5.1 ConvertFrom-Json emits a
        # whole array as one pipeline object, so @(... | ConvertFrom-Json) would
        # yield a single element and every filter below would match nothing.
        $parsed = Get-Content $queuePath -Raw -Encoding utf8 | ConvertFrom-Json
        $queue = @($parsed)
        $open = @($queue | Where-Object { $_.status -eq "VIDEO_DEFERRED" -and -not $_.dry_run })
        $faults = @($open | Where-Object { $_.defer_kind -eq "unexpected" -and -not $_.frozen_at })

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
    if (-not (Assert-PublicPublicationApproval "before local-reach snapshot")) {
        Pop-Location
        exit 1
    }
    if (-not (Assert-CleanProductionContractBeforeAction "local-reach snapshot")) {
        Pop-Location
        exit 1
    }
    $reachOut = Invoke-TrustedProductionNpm -Root $root run local-reach 2>&1
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
