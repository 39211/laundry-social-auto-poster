# Campaign poster daily publish (owner directive 2026-09-07: three template
# posters, one per day). Reads data/campaign-posts.json; posts FB + IG photo
# for today's planned poster inside the 17:00-21:00 window. Idempotent per
# platform via data/campaign-posted-log, so the retry trigger cannot double-post.
# Log: output/campaign-logs/<date>.log
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$logDir = Join-Path $root "output\campaign-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ($now.ToString("yyyy-MM-dd") + ".log")

function Write-Log([string]$message) {
    ("[{0}] {1}" -f [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz).ToString("yyyy-MM-dd HH:mm:ss"), $message) |
        Out-File -FilePath $logFile -Append -Encoding utf8
}

Set-Location $root
Write-Log "campaign poster run start (args: $args)"
$env:DRY_RUN = "false"
$output = & npx tsx src/postCampaignPoster.ts --live @args 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Log $_ }
Write-Log "campaign poster run end exit=$code"
exit $code
