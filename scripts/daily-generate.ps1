# 06:30 daily generation. The package needs AI image generation, so this drives
# Codex non-interactively rather than calling npm scripts directly.
# Generation only: approval and publishing are separate stages with their own gates.
#
# -Date generates a day other than today, which is how a date whose calendar was
# written early (by scheduling a Reel into it) gets its images before the
# morning it is due.
param([string]$Date = "")

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = if ($Date) { $Date } else { $now.ToString("yyyy-MM-dd") }

$logDir = Join-Path $root "output\daily-generate-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

function Write-Log([string]$message) {
    ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $now, $message) | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家每日生成")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryDailyGenerate").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

# A calendar on its own does not mean the day is generated. Scheduling a Reel
# into a future date writes that date's calendar months before its images exist,
# and treating the calendar as proof of completion silently skipped image
# generation for every such day, leaving slot 1 unpublishable on the morning it
# was due. Completion is decided by the assets the calendar actually references.
$calendar = Join-Path $root "data\content-calendar\$date.json"
$hasCalendar = Test-Path $calendar
$imagesReady = $false
if ($hasCalendar) {
    Push-Location $root
    cmd /c "npm.cmd run validate-publishable-images -- --date $date 2>&1" | Out-Null
    $imagesReady = ($LASTEXITCODE -eq 0)
    Pop-Location
}

if ($hasCalendar -and $imagesReady) {
    Write-Log "Content calendar and images for $date are both ready; nothing to generate."
    exit 0
}

$codex = Join-Path $env:APPDATA "npm\codex.cmd"
if (-not (Test-Path $codex)) {
    Write-Log "codex.cmd not found at $codex."
    Show-Toast "找不到 codex.cmd,今天的內容沒有生成。"
    exit 1
}

# A day whose calendar already exists has usually had a Reel scheduled into
# slot 2 by hand. Regenerating its content would overwrite that reviewed Reel
# with a fresh plan, so those days are told to fill in only what is missing.
if ($hasCalendar) {
    Write-Log "Calendar for $date exists but its images do not; generating images only."
    # The action goes first. An earlier version led with the constraint and
    # Codex treated the constraint as the whole task: it replied that it would
    # not touch the calendar, generated nothing, and stopped.
    $prompt = @"
Generate the missing publishable images for $date (Asia/Taipei), following .agents/skills/daily-automation/SKILL.md.

Do this now, in order:
1. Run npm run validate-publishable-images -- --date $date to list exactly which image files are missing.
2. Run npm run generate-image-manifest -- --date $date.
3. Generate each missing image with the built-in image model (gpt-image-2), once per manifest item, and save it to the exact path the manifest gives.
4. Run npm run mark-image-source -- --date $date --slot X --source gpt-image-2 for each image you saved.
5. Run npm run generate-public-site.
6. Run npm run validate-publishable-images -- --date $date again and report the result.

The task is not complete until step 6 passes.

One constraint while you do it: data/content-calendar/$date.json already exists and its contents must not change. Slot 2 may hold a Reel that has already been reviewed and scheduled, and rewriting the calendar would discard it. Read it, generate the images it asks for, but do not edit it.

Do not approve posts, do not write approved-log or posted-log entries, and do not publish to Facebook or Instagram: approval and publishing are separate stages.
"@
} else {
    $prompt = @"
Run the 06:30 daily generation for $date (Asia/Taipei) exactly as defined in .agents/skills/daily-automation/SKILL.md.

Generate the daily context, the content calendar, the image prompt manifest, the final images through the built-in image model, the image source records, and the video candidate manifest, then refresh the public site.

Stop and report if any required step cannot complete. Do not approve posts, do not write approved-log or posted-log entries, and do not publish to Facebook or Instagram: approval and publishing are separate stages.
"@
}

Write-Log "Starting Codex generation for $date."
Push-Location $root
$output = & $codex exec -C $root -s workspace-write $prompt 2>&1
$exitCode = $LASTEXITCODE
Pop-Location
$output | Out-File -FilePath $logFile -Append -Encoding utf8

if ($exitCode -ne 0) {
    Write-Log "Codex exited with $exitCode."
    Show-Toast "今天 ($date) 的內容生成失敗,請看 output\daily-generate-logs\$date.log"
    exit 1
}

# Codex exiting 0 is not proof the day can publish. The gate that matters is
# whether the images the calendar references are actually on disk.
Push-Location $root
cmd /c "npm.cmd run validate-publishable-images -- --date $date 2>&1" | Out-Null
$imagesReadyNow = ($LASTEXITCODE -eq 0)
Pop-Location

if ((Test-Path $calendar) -and $imagesReadyNow) {
    Write-Log "Generation finished; calendar and images are both ready."
} elseif (Test-Path $calendar) {
    Write-Log "Codex finished but images for $date are still missing."
    Show-Toast "今天 ($date) 的圖片沒有生成完整,slot 1 可能發不出去,請看 log。"
    exit 1
} else {
    Write-Log "Codex finished but no content calendar was written."
    Show-Toast "生成流程跑完但沒有產生內容檔,請檢查 log。"
    exit 1
}
