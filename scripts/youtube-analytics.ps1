# Daily YouTube Analytics collection: writes the 28-day Shorts window into
# data\insights\youtube\<date>.json. Unmeasured days stay unmeasured -- never 0.
# The TypeScript collector writes that JSON after each video, merging
# per video_id with any same-day file already on disk (逐支合併; metrics and
# status field-groups separately). Rows only on disk are kept if still in
# today's youtube-log window. A pending skeleton is written first so a Task
# Scheduler kill still leaves a partial file.
# This wrapper always passes --no-fail, so the collector's exit 1 for
# run_failed is invisible to Task Scheduler. Failure signals live only in
# this log's stderr lines and the JSON run_failed / run_failure_reason
# fields. Per-video analytics failures (when videos.list succeeded) leave
# no run-level signal if the existing row wins the merge -- tracked on a
# separate health-check ticket.
#
# youtubeAnalytics.ts defaults --date to Taipei via getZonedDateParts, but this
# wrapper still computes and passes the Taipei date explicitly so the file name
# never depends on what time the scheduler happens to fire (same F16 trap as
# ga4-collect.ps1).
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$outDir = Join-Path $root "output\youtube-analytics-logs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log "Collecting YouTube Analytics for $date."
Push-Location $root
$out = cmd /c "npx.cmd tsx src/youtubeAnalytics.ts --date $date --no-fail 2>&1"
$exit = $LASTEXITCODE
Pop-Location
$out | ForEach-Object { Write-Log $_ }

if ($exit -ne 0) {
    Write-Log "youtube-analytics exited $exit."
} else {
    Write-Log "Done."
}
