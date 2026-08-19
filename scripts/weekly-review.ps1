# Runs the programme's decision points on their own, so none of them depends on
# someone remembering the date.
#
# Two things are due on a calendar rather than daily:
#   - the Reel batch review, once the first Reels are 72 hours old
#   - the day-30 and day-60 checkpoints of the 90-day programme
#
# Both write their verdict to output\reviews and notify. Neither changes what
# publishes: they produce the judgement a person then acts on. A stop verdict
# from a checkpoint is surfaced loudly rather than filed in a log.
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

$outDir = Join-Path $root "output\reviews"
$logFile = Join-Path $outDir "$date.log"
. (Join-Path $PSScriptRoot "_production-contract.ps1")
$productionContract = Test-CleanProductionContract -Root $root
if (-not $productionContract.ok) {
    [Console]::Error.WriteLine("BLOCKED production contract before weekly review: $($productionContract.reason). No task re-arm, insights sync, or indexing action was run.")
    exit 1
}
$ProductionContractVerified = $true
if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "weekly review output directory preparation")) { exit 1 }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Write-Log([string]$m) {
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "weekly review log write")) {
        [Console]::Error.WriteLine("BLOCKED production contract before weekly review log write.")
        return
    }
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $n = $t.GetElementsByTagName("text")
        $n.Item(0).AppendChild($t.CreateTextNode("私享家成效檢討")) | Out-Null
        $n.Item(1).AppendChild($t.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryWeeklyReview").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($t)))
    } catch { Write-Log ("Toast failed: " + $_.Exception.Message) }
}

# --- fresh insights ----------------------------------------------------------
# The batch review judges each Reel against its 72-hour Instagram numbers, and
# nothing else fetches those on a schedule: the review would otherwise keep
# reading whatever window was last synced by hand. A failed fetch is logged and
# the review still runs -- stale data with a warning beats no verdict.
Write-Log "Syncing Meta insights."
Push-Location $root
$sync = Invoke-TrustedProductionNpm -Root $root run sync-meta-insights 2>&1
if ($LASTEXITCODE -ne 0) { Write-Log "Insights sync failed; review will use the last synced window." }
Pop-Location

# --- Reel batch review -------------------------------------------------------
Write-Log "Running Reel batch review."
Push-Location $root
$batch = Invoke-TrustedProductionNpm -Root $root run reel-batch-review 2>&1
Pop-Location
$batchJson = [regex]::Match(($batch -join "`n"), '(?s)\{.*\}')
if ($batchJson.Success) {
    $reviewFile = Join-Path $outDir "batch-review-$date.json"
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "batch review report write")) { exit 1 }
    $batchJson.Value | Set-Content $reviewFile -Encoding utf8
    $parsed = $batchJson.Value | ConvertFrom-Json
    Write-Log "Batch review: $($parsed.pass_count)/$($parsed.mature_count) cleared the bar."
    Write-Log "Recommendation: $($parsed.recommendation)"
    if ($parsed.mature_count -gt 0) {
        Show-Toast "影片檢討:$($parsed.pass_count)/$($parsed.mature_count) 達標。看 output\reviews\batch-review-$date.json"
    }
} else {
    Write-Log "Batch review produced no JSON."
}

# --- 90-day programme checkpoints -------------------------------------------
# The programme started 2026-07-11. Only run a checkpoint on or after its day,
# and only once: the verdict of record is the one taken on the day.
$programStart = [DateTime]::ParseExact("2026-07-11", "yyyy-MM-dd", $null)
$dayNumber = ($now.Date - $programStart).Days + 1
Write-Log "Programme day $dayNumber."

foreach ($checkpoint in 30, 60) {
    if ($dayNumber -lt $checkpoint) { continue }
    $verdictFile = Join-Path $outDir "checkpoint-$checkpoint.json"
    if (Test-Path $verdictFile) { continue }

    Write-Log "Running day-$checkpoint checkpoint."
    Push-Location $root
    $result = Invoke-TrustedProductionNpm -Root $root run checkpoint -- --checkpoint $checkpoint 2>&1
    Pop-Location
    $json = [regex]::Match(($result -join "`n"), '(?s)\{.*\}')
    if (-not $json.Success) { Write-Log "Checkpoint $checkpoint produced no JSON."; continue }

    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "checkpoint report write")) { exit 1 }
    $json.Value | Set-Content $verdictFile -Encoding utf8
    $verdict = ($json.Value | ConvertFrom-Json).verdict
    Write-Log "Day-$checkpoint verdict: $verdict"
    switch ($verdict) {
        "stop"   { Show-Toast "第 $checkpoint 天檢查點:建議停下重新設計。請看 output\reviews\checkpoint-$checkpoint.json" }
        "adjust" { Show-Toast "第 $checkpoint 天檢查點:需要調整。請看 output\reviews\checkpoint-$checkpoint.json" }
        default  { Show-Toast "第 $checkpoint 天檢查點:可以放大。請看 output\reviews\checkpoint-$checkpoint.json" }
    }
}

# --- weekly SEO iteration (Wednesdays, from 2026-08-15) ----------------------
# The site's own numbers decide what to strengthen: Search Console shows which
# queries already have impressions, and a page with impressions but no clicks
# is a title/description problem, not a content-volume problem. Running it
# inside the existing 09:00 review means no new scheduled task to keep alive.
if ($now.DayOfWeek -eq "Wednesday" -and $now -ge [DateTime]"2026-08-15") {
    Write-Log "Weekly SEO iteration: running indexing audit and writing the review queue."
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "indexing audit")) {
        Write-Log "Production contract changed before indexing audit."
        exit 1
    }
    $indexingApproval = Test-PublicPublicationApproval -Root $root -Date $date
    if (-not $indexingApproval.ok) {
        Write-Log "BLOCKED public indexing audit: $($indexingApproval.reason)."
        $indexingApproval.gaps | ForEach-Object { Write-Log ("BLOCKED public-approval gap: " + [string]$_) }
        $indexingExit = 1
    } else {
        $indexingOut = Invoke-TrustedProductionNpm -Root $root run indexing-push -- --date $date 2>&1
        $indexingExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "indexing audit output log write")) { exit 1 }
        $indexingOut | Out-File -FilePath $logFile -Append -Encoding utf8
    }

    $seoQueue = Join-Path $outDir "seo-weekly-$date.json"
    $gscReport = Join-Path $root "output\operations\gsc-performance-optimization.json"
    $gscAge = if (Test-Path $gscReport) { [int]((Get-Date) - (Get-Item $gscReport).LastWriteTime).TotalDays } else { -1 }
    $payload = [ordered]@{
        date              = $date
        indexing_audit_ok = ($indexingExit -eq 0)
        gsc_report_age_days = $gscAge
        needs_fresh_gsc_export = ($gscAge -lt 0 -or $gscAge -gt 7)
        next_actions      = @(
            "Export Search Console 查詢/網頁/查詢與網頁 CSV (last 28 days)",
            "Rank pages by impressions with CTR below 1%: those are title/description work",
            "Rank queries at position 4-15 with zero clicks: those are the winnable ones",
            "Apply at most one change per page, then hold it for 7 days"
        )
    }
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "weekly SEO queue write")) { exit 1 }
    $payload | ConvertTo-Json -Depth 4 | Out-File -FilePath $seoQueue -Encoding utf8
    if ($payload.needs_fresh_gsc_export) {
        Show-Toast "每週 SEO 迭代:需要新的 Search Console 匯出資料才能判讀。清單:output\reviews\seo-weekly-$date.json"
    } else {
        Show-Toast "每週 SEO 迭代清單已產生:output\reviews\seo-weekly-$date.json"
    }
}

Write-Log "Review run finished."
