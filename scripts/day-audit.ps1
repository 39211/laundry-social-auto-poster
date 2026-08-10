# 22:50 end-of-day audit. Session-independent: every earlier rescue layer can
# die with a session or a disabled task, so the day's final verdict and the
# last-chance rescue live in Task Scheduler itself. Evidence-based only -- it
# reads posted-log / first-comments / youtube-log / tomorrow's assets, never
# exit codes or claims.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")
$tomorrow = $now.AddDays(1).ToString("yyyy-MM-dd")

$reportDir = Join-Path $root "output\day-reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Read-Json([string]$path) {
    # ConvertFrom-Json must be called in argument form, never piped: in PS 5.1
    # the pipeline emits a JSON array as ONE object, downstream Where-Object
    # then filters the array itself (property enumeration made every slot look
    # unposted in the first live test of this script).
    try {
        $raw = [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
        $parsed = ConvertFrom-Json $raw
        return $parsed
    } catch { return $null }
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家每日結算")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryDayAudit").Show((New-Object Windows.UI.Notifications.ToastNotification($template)))
    } catch {}
}

# --- posts ------------------------------------------------------------------
$posted = @(Read-Json (Join-Path $root "data\posted-log\$date.json"))
$slotState = @{}
foreach ($slot in 1, 2, 3) {
    $ig = @($posted | Where-Object { $_.slot -eq $slot -and $_.platform -eq "instagram" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
    $fb = @($posted | Where-Object { $_.slot -eq $slot -and $_.platform -eq "facebook" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
    $slotState["$slot"] = @{ instagram = $ig; facebook = $fb }
}
# Slot 3 may legitimately be absent on 2-slot calendars.
$calendar = Read-Json (Join-Path $root "data\content-calendar\$date.json")
$hasSlot3 = @(@($calendar.slots) | Where-Object { $_.slot -eq 3 }).Count -gt 0
$expectedSlots = if ($hasSlot3) { @(1, 2, 3) } else { @(1, 2) }
$missingPosts = @($expectedSlots | Where-Object { -not ($slotState["$_"].instagram -and $slotState["$_"].facebook) })

# --- first comments ----------------------------------------------------------
# first-comments is a list of {slot, comment_id, ...} records.
$comments = @(Read-Json (Join-Path $root "data\first-comments\$date.json"))
$commentSlots = @($comments | Where-Object { $_.comment_id } | ForEach-Object { $_.slot })
$liveIgSlots = @($expectedSlots | Where-Object { $slotState["$_"].instagram })
$missingComments = @($liveIgSlots | Where-Object { $_ -notin $commentSlots })

# --- YouTube ------------------------------------------------------------------
$liveReels = @($liveIgSlots | Where-Object { $_ -in 2, 3 }).Count
$yt = @(Read-Json (Join-Path $root "data\youtube-log\$date.json"))
$ytCount = @($yt | Where-Object { $_.video_id }).Count
$ytGap = $liveReels - $ytCount

# --- tomorrow readiness --------------------------------------------------------
$tomorrowCalendar = Test-Path (Join-Path $root "data\content-calendar\$tomorrow.json")
$tomorrowReels = "unknown"
$abPlan = @(Read-Json (Join-Path $root "data\ab-test-plan.json"))
$planRow = $abPlan | Where-Object { $_.date -eq $tomorrow } | Select-Object -First 1
if ($planRow) {
    $reelDir = Join-Path $root "output\reels-run\2026-07-29\reels"
    $need = @()
    foreach ($half in @($planRow.noon, $planRow.evening)) {
        if ($null -eq $half) { continue }
        $suffix = if ($half.variant -eq "15s") { "-15s" } else { "" }
        $need += "$($half.conceptId)$suffix.mp4"
    }
    $missingReels = @($need | Where-Object { -not (Test-Path (Join-Path $reelDir $_)) })
    $tomorrowReels = if ($missingReels.Count -eq 0) { "ready" } else { "missing: " + ($missingReels -join ", ") }
}

# --- last-chance rescues ---------------------------------------------------------
$actions = @()
if ($ytGap -gt 0) {
    Start-ScheduledTask -TaskName "Laundry-YouTube-Upload" -ErrorAction SilentlyContinue
    $actions += "started YouTube upload ($ytCount/$liveReels)"
}
if ($missingComments.Count -gt 0) {
    Push-Location $root
    cmd /c "npm.cmd run first-comment -- --date $date 2>&1" | Out-Null
    Pop-Location
    $actions += "posted first comments for slot $($missingComments -join ',')"
}

# --- report -----------------------------------------------------------------------
$ok = ($missingPosts.Count -eq 0) -and ($missingComments.Count -eq 0) -and ($ytGap -le 0) -and $tomorrowCalendar -and ($tomorrowReels -eq "ready" -or $tomorrowReels -eq "unknown")
$report = [ordered]@{
    date              = $date
    generated_at      = $now.ToString("yyyy-MM-ddTHH:mm:ss")
    ok                = $ok
    slots             = $slotState
    missing_posts     = $missingPosts
    missing_comments  = $missingComments
    youtube           = @{ live_reels = $liveReels; uploaded = $ytCount }
    tomorrow          = @{ calendar = $tomorrowCalendar; reels = $tomorrowReels }
    rescue_actions    = $actions
}
$reportPath = Join-Path $reportDir "$date.json"
$report | ConvertTo-Json -Depth 5 | Out-File -FilePath $reportPath -Encoding utf8

if ($ok) {
    Show-Toast "$date 全部完成:$($expectedSlots.Count) 檔已發、頭香齊、YT $ytCount/$liveReels、明日備料 OK"
} else {
    $gaps = @()
    if ($missingPosts.Count -gt 0) { $gaps += "缺發文 slot $($missingPosts -join ',')" }
    if ($missingComments.Count -gt 0) { $gaps += "缺頭香 slot $($missingComments -join ',')" }
    if ($ytGap -gt 0) { $gaps += "YT 缺 $ytGap" }
    if (-not $tomorrowCalendar) { $gaps += "明日行事曆缺" }
    if ($tomorrowReels -like "missing*") { $gaps += "明日影片素材缺" }
    Show-Toast ("$date 有缺口:" + ($gaps -join ";") + "。報告:output\day-reports\$date.json")
}
exit 0
