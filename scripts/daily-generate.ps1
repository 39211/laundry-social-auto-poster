# 06:30 daily generation. The package needs AI image generation, so this drives
# Codex non-interactively rather than calling npm scripts directly.
# Generation only: approval and publishing are separate stages with their own gates.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

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

$calendar = Join-Path $root "data\content-calendar\$date.json"
if (Test-Path $calendar) {
    Write-Log "Content calendar for $date already exists; nothing to generate."
    exit 0
}

$codex = Join-Path $env:APPDATA "npm\codex.cmd"
if (-not (Test-Path $codex)) {
    Write-Log "codex.cmd not found at $codex."
    Show-Toast "找不到 codex.cmd,今天的內容沒有生成。"
    exit 1
}

$prompt = @"
Run the 06:30 daily generation for $date (Asia/Taipei) exactly as defined in .agents/skills/daily-automation/SKILL.md.

Generate the daily context, the content calendar, the image prompt manifest, the final images through the built-in image model, the image source records, and the video candidate manifest, then refresh the public site.

Stop and report if any required step cannot complete. Do not approve posts, do not write approved-log or posted-log entries, and do not publish to Facebook or Instagram: approval and publishing are separate stages.
"@

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

if (Test-Path $calendar) {
    Write-Log "Generation finished; content calendar written."
} else {
    Write-Log "Codex finished but no content calendar was written."
    Show-Toast "生成流程跑完但沒有產生內容檔,請檢查 log。"
    exit 1
}
