# Daily GSC Search Analytics collection. src/gscSearchAnalytics.ts already
# defaults to 3 days back (GSC's own data-settling lag) computed off UTC
# epoch millis, so unlike ga4-collect.ps1 this does not need to pass --date
# for the script's default to be Taipei-safe.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$outDir = Join-Path $root "output\gsc-collect-logs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log "Collecting GSC search analytics (default: 3 days back)."
Push-Location $root
$out = cmd /c "npm.cmd run gsc-search-analytics -- --no-fail 2>&1"
$exit = $LASTEXITCODE
Pop-Location
$out | ForEach-Object { Write-Log $_ }
$analyticsText = $out -join [Environment]::NewLine
$analyticsHealthy = $exit -eq 0 -and $analyticsText -notmatch '"status"\s*:\s*"unmeasured"'

if ($exit -ne 0) {
    Write-Log "gsc-search-analytics exited $exit."
} elseif (-not $analyticsHealthy) {
    Write-Log "gsc-search-analytics reported unmeasured; candidate generation is blocked."
} else {
    Write-Log "Done."
}

# 2026-08-21: URL Inspection sweep of the sitemap pages. The sitemap report
# said "submitted 24, indexed 0" as one opaque number; this records each
# page's coverage state daily (data\insights\gsc-index\<date>.json) so the
# daily report can show which pages moved. Read-only; ~24 calls against a
# 2000/day quota.
Write-Log "Inspecting sitemap URL index coverage."
Push-Location $root
$out2 = cmd /c "npm.cmd run gsc-index-inspect -- --no-fail 2>&1"
$exit2 = $LASTEXITCODE
Pop-Location
$out2 | ForEach-Object { Write-Log $_ }
$inspectionText = $out2 -join [Environment]::NewLine
$inspectionHealthy = $exit2 -eq 0 -and $inspectionText -notmatch '"skipped"\s*:\s*true'

if ($exit2 -ne 0) {
    Write-Log "gsc-index-inspect exited $exit2."
} elseif (-not $inspectionHealthy) {
    Write-Log "gsc-index-inspect reported skipped; candidate generation is blocked."
} else {
    Write-Log "Done."
}

# This third step is local-only. It reads the two reports and the sitemap,
# then writes at most one DRAFT_ONLY review candidate. It cannot generate or
# publish website content, request indexing, submit IndexNow, or deploy.
# Keeping it in this same job prevents a second scheduled writer and makes a
# collector failure visible in the existing daily log.
if (-not $analyticsHealthy -or -not $inspectionHealthy) {
    Write-Log "Skipped gsc-seo-candidates because this collection cycle is not fully measured; no public site action was attempted."
} else {
    Write-Log "Creating one evidence-bound SEO review candidate (draft only)."
    Push-Location $root
    $out3 = cmd /c "npm.cmd run gsc-seo-candidates -- --date $date 2>&1"
    $exit3 = $LASTEXITCODE
    Pop-Location
    $out3 | ForEach-Object { Write-Log $_ }

    if ($exit3 -ne 0) {
        Write-Log "gsc-seo-candidates exited $exit3; no public site action was attempted."
    } else {
        Write-Log "Done."
    }

}

# Always write the review, even when either GSC reader failed. The review's
# own freshness checks produce an explicit BLOCKED artifact instead of leaving
# the failed 23:15 collection cycle without a verdict.
Write-Log "Writing SEO exposure verification review."
$reviewCommand = "npm.cmd run seo-exposure-review -- --date $date"
if (-not $analyticsHealthy -or -not $inspectionHealthy) {
    # A same-day retry may find files from an earlier successful run. Carry the
    # current command failure into the local reviewer so those older files can
    # never turn this failed collection cycle into MEASURED.
    $reviewCommand += " --force-block"
}
Push-Location $root
$out4 = cmd /c "$reviewCommand 2>&1"
$exit4 = $LASTEXITCODE
Pop-Location
$out4 | ForEach-Object { Write-Log $_ }
if ($exit4 -ne 0) {
    Write-Log "seo-exposure-review exited $exit4; no SEO change was attempted."
} else {
    Write-Log "Done."
}
