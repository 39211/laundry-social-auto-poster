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
# fields.
#
# Which is why the collector is followed by youtubeAnalyticsHealth.ts, an
# independent reader of the same JSON. It catches the case the collector
# cannot report on itself: videos.list succeeds, every per-video Analytics
# call fails (lost yt-analytics.readonly scope), the same-day file already
# holds measured rows, the merge keeps them -- and the file then reads
# status "measured", no reason, run_failed false. The health check flags that
# (merged_existing_rows == videos.length), plus 401/403 row reasons,
# run_failed, and a report older than 26 hours. Unlike the collector this
# step DOES surface its exit code, so a real outage shows up three ways:
# a desktop toast, this log, and Task Scheduler's Last Run Result.
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

# F21/F22: a detection that only appends to a log file nobody opens is not an
# alarm. The health check's verdict has to reach the desktop.
function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家 YouTube 數據")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryYouTubeAnalytics").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
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

# Runs even when the collector died: a missing or stale report is exactly what
# this step is meant to notice.
Write-Log "Checking report health for $date."
Push-Location $root
$healthOut = cmd /c "npx.cmd tsx src/youtubeAnalyticsHealth.ts --date $date 2>&1"
$healthExit = $LASTEXITCODE
Pop-Location
$healthOut | ForEach-Object { Write-Log $_ }

if ($healthExit -ne 0) {
    $toastLine = @($healthOut | Where-Object { $_ -like "TOAST|*" }) | Select-Object -Last 1
    if ($toastLine) {
        Show-Toast ($toastLine -replace '^TOAST\|', '')
    } else {
        Show-Toast "YouTube 數據健康檢查失敗 (exit $healthExit),看 $logFile。"
    }
    Write-Log "youtube-analytics-health exited $healthExit."
    exit 1
}

Write-Log "Report health OK."
