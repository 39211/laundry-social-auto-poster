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

if ($exit -ne 0) {
    Write-Log "gsc-search-analytics exited $exit."
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

if ($exit2 -ne 0) {
    Write-Log "gsc-index-inspect exited $exit2."
} else {
    Write-Log "Done."
}
