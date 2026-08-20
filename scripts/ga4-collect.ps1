# Daily GA4 collection: writes today's LINE-click numbers into the leads
# ledger so the daily report always has a same-day-to-yesterday comparison.
# Runs late (23:10, after Day-Audit) so the day's traffic is as complete as
# GA4's near-real-time processing allows.
#
# ga4Report.ts defaults --date to `new Date().toISOString()`, which is UTC,
# not Taipei -- between Taipei 00:00 and 08:00 that silently resolves to the
# wrong calendar day (the F16 clock-drift trap in a new shape). This wrapper
# always computes and passes the Taipei date explicitly so the ledger entry
# never depends on what time the scheduler happens to fire.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$outDir = Join-Path $root "output\ga4-collect-logs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log "Collecting GA4 for $date."
Push-Location $root
$out = cmd /c "npm.cmd run ga4-report -- --date $date 2>&1"
$exit = $LASTEXITCODE
Pop-Location
$out | ForEach-Object { Write-Log $_ }

if ($exit -ne 0) {
    Write-Log "ga4-report exited $exit."
} else {
    Write-Log "Done."
}
