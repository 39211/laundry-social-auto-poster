# Uploads today's published Reel to YouTube as a Short, after the Meta chain.
#
# Runs on its own schedule so a YouTube fault can never block the FB/IG
# publishing the 90-day programme is measured on. It only uploads slots whose
# same-date Instagram record is a qualified live Reel; a deferred image never
# opens the gate. Missing credentials remain a visible task failure, not a
# quiet green result.
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
. (Join-Path $PSScriptRoot "_production-contract.ps1")
if (-not $ObserveOnly) {
    $productionContract = Test-CleanProductionContract -Root $root
    if (-not $productionContract.ok) {
        [Console]::Error.WriteLine("BLOCKED production contract before YouTube upload: $($productionContract.reason). No run lock, task re-arm, network, or upload was run.")
        exit 1
    }
    $ProductionContractVerified = $true
}
# Single-flight (luna, high): the scheduler retry, the patrol rescue and a
# manual run can overlap; this script is not re-entrant. The kernel retains an
# exclusive handle for the whole worker and removes it on close, so cleanup has
# no user-space read/move/delete ABA window. The Node durable upload intent is
# the separate, terminal guard for the irreversible remote POST after a crash.
$singleFlight = Join-Path $root ("data\run-locks\" + $MyInvocation.MyCommand.Name + ".lock")
$singleFlightOwner = $null
$singleFlightOwned = $false
$singleFlightStream = $null
if (-not $ObserveOnly) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $singleFlight) | Out-Null
    $singleFlightOwner = "youtube-upload:${PID}:$([Guid]::NewGuid().ToString('N'))"
    try {
        $singleFlightStream = [IO.FileStream]::new(
            $singleFlight,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::DeleteOnClose
        )
        $ownerBytes = [Text.UTF8Encoding]::new($false).GetBytes($singleFlightOwner)
        $singleFlightStream.Write($ownerBytes, 0, $ownerBytes.Length)
        $singleFlightStream.Flush()
        $singleFlightOwned = $true
    } catch {
        if ($null -ne $singleFlightStream) {
            $singleFlightStream.Dispose()
            $singleFlightStream = $null
        }
        if (Test-Path -LiteralPath $singleFlight) {
            [Console]::Error.WriteLine("YouTube upload single-flight lock already exists; refusing automatic reclaim: $singleFlight")
        } else {
            [Console]::Error.WriteLine("Unable to acquire YouTube upload single-flight lock: $($_.Exception.Message)")
        }
        exit 1
    }
}
try {


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

$logDir = Join-Path $root "output\youtube-logs"
$logFile = if ($ObserveOnly) { $null } else { Join-Path $logDir "$date.log" }
if (-not $ObserveOnly) {
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube log directory preparation")) { exit 1 }
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$WatchdogObserveOnly = $ObserveOnly
. (Join-Path $PSScriptRoot "_watchdog.ps1")
. (Join-Path $PSScriptRoot "_publishing-reconciliation.ps1")

function Write-Log([string]$m) {
    if ($ObserveOnly) {
        Write-Output $m
    } else {
        if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube log write")) {
            [Console]::Error.WriteLine("BLOCKED production contract before YouTube log write.")
            return
        }
        $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
        "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m | Add-Content -Path $logFile -Encoding UTF8
    }
}

function Show-Toast([string]$text) {
    if ($ObserveOnly) { return }
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $n = $t.GetElementsByTagName("text")
        $n.Item(0).AppendChild($t.CreateTextNode("私享家 YouTube 上傳")) | Out-Null
        $n.Item(1).AppendChild($t.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryYouTube").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($t)))
    } catch { Write-Log ("Toast failed: " + $_.Exception.Message) }
}

# A post-youtube stdout object, including one that happens to contain a
# video_id, is only transport output.  This invokes the uploader's *read-only*
# verifier, which rereads the stamped/approved package plus the immutable
# claim, channel-bound read-back evidence and source binding.  It never refreshes
# OAuth, creates a claim, or uploads.
function Invoke-CanonicalYouTubeCompletionVerification([int]$SlotNumber) {
    $verificationOut = @()
    $verificationCode = 1
    $pushed = $false
    try {
        Push-Location -LiteralPath $root
        $pushed = $true
        $verificationOut = @(Invoke-TrustedProductionNpm -Root $root run post-youtube -- --date $date --slot $SlotNumber --verify-completion 2>&1)
        $verificationCode = $LASTEXITCODE
    } finally {
        if ($pushed) { Pop-Location }
    }
    return [pscustomobject]@{ ExitCode = $verificationCode; Output = @($verificationOut) }
}

# Only upload the exact source slots the canonical reconciliation says remain
# missing. This keeps the uploader, patrol and day audit on one date+slot
# contract, including a future calendar that legitimately puts a Reel in slot 1.
try {
    $reconciliation = Get-PublishingReconciliation -Root $root -Date $date
} catch {
    Write-Log "Publishing reconciliation failed; refusing YouTube upload. $($_.Exception.Message)"
    Show-Toast "YouTube 對帳失敗，未啟動上傳；請看 output\youtube-logs\$date.log"
    exit 1
}
$missingReelSlots = @($reconciliation.missing_reel_slots)
$unexpectedYouTubeSlots = @($reconciliation.unexpected_youtube_slots)
if ($missingReelSlots.Count -eq 0) {
    if ($unexpectedYouTubeSlots.Count -gt 0) {
        Write-Log "YouTube log has mismatched date or source slot(s) $($unexpectedYouTubeSlots -join ','); no completion is accepted."
        Show-Toast "YouTube 紀錄與當日 Reel 不一致，請看 output\youtube-logs\$date.log"
        exit 1
    }
    if (@($reconciliation.expected_reel_slots).Count -eq 0) {
        Write-Log "No qualified live Instagram Reel today; nothing to upload."
    } else {
        Write-Log "Every qualified Reel already has a matching YouTube Short."
    }
    exit 0
}
if ($unexpectedYouTubeSlots.Count -gt 0) {
    # The bad record remains a red reconciliation result, but must not block
    # a different, legitimate Reel slot from being mirrored to YouTube.
    Write-Log "YouTube log has mismatched date or source slot(s) $($unexpectedYouTubeSlots -join ','); will upload only missing qualified slot(s) and keep the day red."
}
if ($ObserveOnly) {
    foreach ($slotNumber in $missingReelSlots) {
        Write-Log "would upload YouTube Short for qualified Reel slot $slotNumber"
    }
    exit 1
}

$failed = $false
$anyVerified = $false
$needAuth = $false

foreach ($slotNumber in $missingReelSlots) {
    Push-Location $root
    $out = Invoke-TrustedProductionNpm -Root $root run post-youtube -- --date $date --slot $slotNumber 2>&1
    $code = $LASTEXITCODE
    Pop-Location
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube upload output log write")) { exit 1 }
    $out | Add-Content -Path $logFile -Encoding UTF8

    $joined = $out -join "`n"
    if ($code -ne 0) {
        Write-Log "Slot $slotNumber upload failed (exit $code)."
        $failed = $true
        continue
    }
    if ($joined -match "credentials not configured") {
        Write-Log "Credentials not configured; skipped slot $slotNumber."
        $needAuth = $true
        continue
    }

    try {
        $verification = Invoke-CanonicalYouTubeCompletionVerification -SlotNumber ([int]$slotNumber)
    } catch {
        Write-Log "Slot $slotNumber completion output is not accepted: canonical read-only verification could not run. $($_.Exception.Message)"
        $failed = $true
        continue
    }
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "YouTube completion verification output log write")) { exit 1 }
    @($verification.Output) | Add-Content -Path $logFile -Encoding UTF8
    $verificationJoined = @($verification.Output) -join "`n"
    if ($verification.ExitCode -ne 0 -or $verificationJoined -notmatch "verified completed YouTube Short") {
        Write-Log "Slot $slotNumber completion output is not accepted: canonical read-only verification failed (exit $($verification.ExitCode))."
        $failed = $true
        continue
    }
    try {
        # The verifier proves the target tuple; reconciliation independently
        # proves that the same tuple fulfils the current IG Reel obligation.
        $slotReconciliation = Get-PublishingReconciliation -Root $root -Date $date
        if (@($slotReconciliation.uploaded_reel_slots) -notcontains [int]$slotNumber) {
            throw "canonical reconciliation does not list slot $slotNumber as an uploaded Reel Short"
        }
    } catch {
        Write-Log "Slot $slotNumber completion output is not accepted: canonical reconciliation failed. $($_.Exception.Message)"
        $failed = $true
        continue
    }
    Write-Log "Slot $slotNumber YouTube completion verified by canonical approval, immutable evidence, and reconciliation."
    $anyVerified = $true
}

if ($needAuth) {
    Show-Toast "Reel 已發布，但 YouTube 還沒授權。跑一次 npm run youtube-auth 完成設定。"
    exit 1
}
if ($failed) {
    Show-Toast "今天的 Reel 上傳 YouTube 失敗，請看 output\youtube-logs\$date.log"
    exit 1
}
try {
    $after = Get-PublishingReconciliation -Root $root -Date $date
    $remaining = @($after.missing_reel_slots)
    $unexpected = @($after.unexpected_youtube_slots)
    if ($remaining.Count -gt 0 -or $unexpected.Count -gt 0) {
        Write-Log "YouTube reconciliation remains incomplete: missing slot(s) $($remaining -join ','); unexpected slot(s) $($unexpected -join ',')."
        Show-Toast "YouTube 上傳後對帳未完成，請看 output\youtube-logs\$date.log"
        exit 1
    }
} catch {
    Write-Log "Post-upload reconciliation failed. $($_.Exception.Message)"
    Show-Toast "YouTube 上傳後對帳失敗，請看 output\youtube-logs\$date.log"
    exit 1
}
if (-not $anyVerified) {
    Write-Log "No required Reel slot reached canonical YouTube completion verification."
}
} finally {
    if (-not $ObserveOnly -and $singleFlightOwned) {
        try {
            # DeleteOnClose removes this exact open file as part of the kernel
            # handle close. There is no pathname check followed by a separate
            # delete that could target a later worker's replacement lock.
            $singleFlightStream.Dispose()
            $singleFlightStream = $null
        } catch {
            [Console]::Error.WriteLine("YouTube upload single-flight cleanup failed: $($_.Exception.Message)")
            exit 1
        }
    }
}
