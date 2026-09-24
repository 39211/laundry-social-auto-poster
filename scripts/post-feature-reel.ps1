# Publish the day's off-calendar feature Reel to Instagram at 14:00.
#
# Facebook and YouTube are NOT here on purpose. Both accept a publish time and
# release the post themselves, so they are queued hours ahead by
#   npx tsx src/postFeatureReel.ts --date <d> --schedule --at 14:00 --live
# and cannot be hurt by local trouble. Instagram's Graph API has no scheduling
# at all, so it is the only platform that has to be posted at the moment itself.
#
# 14:00 is already busy: Laundry-Publish-1400 (catchup-publish) and
# Laundry-Reel-Produce both fire then and both touch git. This script makes only
# HTTPS calls to Meta and writes one small JSON file, so it does not contend for
# the repo.
#
# The trigger is DAILY, never -Once. A spent -Once task sits at State=Ready with
# an empty NextRunTime, and watchdog-patrol.ps1:98-107 reads that as a dead
# trigger and re-registers EVERY Laundry-* task. A daily trigger that exits 0
# when there is nothing to do avoids setting that off, and leaves a reusable lane
# for the next feature reel.
#
# Safe to run more than once: src/postFeatureReel.ts keeps a per-platform log at
# data\feature-posted-log\<date>.json and skips anything already posted.
#
# ASCII only; the file carries a UTF-8 BOM so cp950 cannot eat it.
# -Date lets this be rehearsed against a day with no feature reel, which exercises
# the lock, the logging and the nothing-to-do exit without posting anything.
param([string]$Date)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = if ($Date) { $Date } else { $now.ToString("yyyy-MM-dd") }

$logDir = Join-Path $root "output\feature-reel-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ($date + ".log")
function Write-Log([string]$m) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f ([TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)), $m
    Write-Host $line
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
}

# Single-flight: the scheduler retry and a manual run must not overlap.
$lock = Join-Path $root ("data\run-locks\" + $MyInvocation.MyCommand.Name + ".lock")
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lock) | Out-Null
try {
    $fs = [IO.File]::Open($lock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $fs.Close()
} catch {
    $age = (Get-Date) - (Get-Item $lock).LastWriteTime
    if ($age.TotalMinutes -lt 45) { Write-Log "another run holds the lock; exiting"; exit 0 }
    Write-Log ("reclaiming a stale lock ({0:N0} min old)" -f $age.TotalMinutes)
}

try {
    $definition = Join-Path $root ("data\feature-reels\" + $date + ".json")
    if (-not (Test-Path $definition)) {
        Write-Log "no feature reel defined for $date; nothing to do"
        exit 0
    }

    Write-Log "posting the Instagram feature Reel for $date"
    Push-Location $root
    $out = & cmd /c "npx tsx src/postFeatureReel.ts --date $date --publish-ig --live 2>&1"
    $code = $LASTEXITCODE
    Pop-Location
    $out | ForEach-Object { Write-Log ([string]$_) }
    Write-Log "exit=$code"

    # The publisher's own exit code is not the evidence; the log file is.
    $logPath = Join-Path $root ("data\feature-posted-log\" + $date + ".json")
    if (Test-Path $logPath) {
        $rows = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $ig = @($rows | Where-Object { $_.platform -eq "instagram" -and $_.status -eq "success" })
        if ($ig.Count -gt 0) {
            Write-Log ("VERIFIED: instagram media_id=" + $ig[0].post_id)
            exit 0
        }
    }
    Write-Log "NOT PUBLISHED: no successful instagram row in the feature log"
    exit 1
} finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
