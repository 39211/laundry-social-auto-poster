# Daily GA4 AI-referral read. Skip-closed when credentials are missing so a
# machine that has not finished ga4-authorize never fails the day. Never prints
# .env values. Does not call the Data API from CI; this wrapper is the Windows
# scheduled-task hook only.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$outDir = Join-Path $root "output\ga4-ai-traffic-logs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

function Test-Ga4AiTrafficConfigured {
    $envFile = Join-Path $root ".env"
    if (-not (Test-Path $envFile)) { return $false }
    $text = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
    if (-not $text) { return $false }
    foreach ($name in @("YT_CLIENT_ID", "YT_CLIENT_SECRET", "GA4_REFRESH_TOKEN", "GA4_PROPERTY_ID")) {
        if ($text -notmatch "(?m)^$name=.+") { return $false }
    }
    return $true
}

if (-not (Test-Ga4AiTrafficConfigured)) {
    Write-Log "GA4 AI traffic skipped: credentials not configured."
    exit 0
}

Write-Log "Collecting GA4 AI traffic for $date."
Push-Location $root
$out = cmd /c "npm.cmd run ga4-ai-traffic -- --date $date --no-fail 2>&1"
$exit = $LASTEXITCODE
Pop-Location
$out | ForEach-Object { Write-Log $_ }

if ($exit -ne 0) {
    Write-Log "ga4-ai-traffic exited $exit."
    exit 0
}
Write-Log "Done."
exit 0
