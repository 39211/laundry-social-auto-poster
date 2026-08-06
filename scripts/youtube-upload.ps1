# Uploads today's published Reel to YouTube as a Short, after the Meta chain.
#
# Runs on its own schedule so a YouTube fault can never block the FB/IG
# publishing the 90-day programme is measured on. Upload only happens after
# slot 2 actually live-published on Instagram; a day whose Reel deferred to
# images uploads nothing. Missing credentials skip quietly with a reminder, so
# the task can be registered before the one-time OAuth is done.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\youtube-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m | Add-Content -Path $logFile -Encoding UTF8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $n = $t.GetElementsByTagName("text")
        $n.Item(0).AppendChild($t.CreateTextNode("私享家 YouTube 上傳")) | Out-Null
        $n.Item(1).AppendChild($t.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryYouTube").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($t)))
    } catch { Write-Log ("Toast failed: " + $_.Exception.Message) }
}

# Only upload what actually went live on the primary platform. Slot 2 (evening)
# and slot 3 (noon A/B) are each checked and uploaded independently; a day with
# only one live Reel still uploads that one.
$postedPath = Join-Path $root "data\posted-log\$date.json"
if (-not (Test-Path $postedPath)) { Write-Log "No posted-log yet; nothing to upload."; exit 0 }
# Assign before wrapping: PS 5.1's ConvertFrom-Json emits a JSON array as one
# pipeline object, so @(pipeline) yields a single element and every filter
# below matches nothing — which is exactly how tonight's live Reel was
# misjudged as "no live Reel today". Same pitfall documented in
# catchup-publish.ps1; same fix.
$postedParsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json
$posted = @($postedParsed)

$failed = $false
$anyUpload = $false
$anySkip = $false
$needAuth = $false

foreach ($slotNumber in @(2, 3)) {
    $reelLive = @($posted | Where-Object {
        $_.slot -eq $slotNumber -and $_.platform -eq "instagram" -and -not $_.dry_run -and
        (@("success", "posted") -contains $_.status) -and $_.published_media_type -eq "reel"
    })
    if ($reelLive.Count -eq 0) {
        Write-Log "Slot $slotNumber has no live Reel today; skip."
        continue
    }

    Push-Location $root
    $out = cmd /c "npm.cmd run post-youtube -- --date $date --slot $slotNumber 2>&1"
    $code = $LASTEXITCODE
    Pop-Location
    $out | Add-Content -Path $logFile -Encoding UTF8

    $joined = $out -join "`n"
    if ($code -ne 0) {
        Write-Log "Slot $slotNumber upload failed (exit $code)."
        $failed = $true
        continue
    }
    if ($joined -match "credentials not configured") {
        Write-Log "Credentials not configured; skipped slot $slotNumber."
        $needAuth = $true
        continue
    }
    if ($joined -match '"video_id"') {
        Write-Log "Slot $slotNumber uploaded to YouTube."
        $anyUpload = $true
    } else {
        Write-Log "Slot $slotNumber skipped (already uploaded or no video)."
        $anySkip = $true
    }
}

if ($needAuth) {
    Show-Toast "Reel 已發布，但 YouTube 還沒授權。跑一次 npm run youtube-auth 完成設定。"
    exit 0
}
if ($failed) {
    Show-Toast "今天的 Reel 上傳 YouTube 失敗，請看 output\youtube-logs\$date.log"
    exit 1
}
if (-not $anyUpload -and -not $anySkip) {
    Write-Log "No live Reel on slot 2 or 3 today; nothing to upload."
}
