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
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$outDir = Join-Path $root "output\reviews"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m) | Tee-Object -FilePath $logFile -Append
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

# --- Reel batch review -------------------------------------------------------
Write-Log "Running Reel batch review."
Push-Location $root
$batch = cmd /c "npm.cmd run reel-batch-review 2>&1"
Pop-Location
$batchJson = [regex]::Match(($batch -join "`n"), '(?s)\{.*\}')
if ($batchJson.Success) {
    $reviewFile = Join-Path $outDir "batch-review-$date.json"
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
    $result = cmd /c "npm.cmd run checkpoint -- --checkpoint $checkpoint 2>&1"
    Pop-Location
    $json = [regex]::Match(($result -join "`n"), '(?s)\{.*\}')
    if (-not $json.Success) { Write-Log "Checkpoint $checkpoint produced no JSON."; continue }

    $json.Value | Set-Content $verdictFile -Encoding utf8
    $verdict = ($json.Value | ConvertFrom-Json).verdict
    Write-Log "Day-$checkpoint verdict: $verdict"
    switch ($verdict) {
        "stop"   { Show-Toast "第 $checkpoint 天檢查點:建議停下重新設計。請看 output\reviews\checkpoint-$checkpoint.json" }
        "adjust" { Show-Toast "第 $checkpoint 天檢查點:需要調整。請看 output\reviews\checkpoint-$checkpoint.json" }
        default  { Show-Toast "第 $checkpoint 天檢查點:可以放大。請看 output\reviews\checkpoint-$checkpoint.json" }
    }
}

Write-Log "Review run finished."
