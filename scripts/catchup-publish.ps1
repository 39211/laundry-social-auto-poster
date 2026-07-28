# Catch-up publisher for the daily 私享家 FB/IG slots.
# Safe to run repeatedly: post-current-slot enforces the approved-log gate and
# skips slots already recorded in posted-log. Same-day catch-up is authorized
# by data/publishing-policy.json (same_day_catch_up: true).
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\catch-up-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

function Write-Log([string]$message) {
    $line = "[{0}] {1}" -f $now.ToString("yyyy-MM-dd HH:mm:ss"), $message
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家發文補跑")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryCatchUp").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

Write-Log "Catch-up run started (Taipei time $($now.ToString('HH:mm')))."

$approvedPath = Join-Path $root "data\approved-log\$date.json"
if (-not (Test-Path $approvedPath)) {
    Write-Log "No approved-log for $date. Nothing can be published yet."
    Show-Toast "今天 ($date) 還沒有審核紀錄,請執行 Codex 審核流程,否則今天不會發文。"
    exit 0
}

$dueSlots = @()
if ($now.TimeOfDay -ge [TimeSpan]"11:30") { $dueSlots += 1 }
if ($now.TimeOfDay -ge [TimeSpan]"19:30") { $dueSlots += 2 }

if ($dueSlots.Count -eq 0) {
    Write-Log "No slot is due yet."
    exit 0
}

$failed = @()
foreach ($slot in $dueSlots) {
    Write-Log "Running post-current-slot --slot $slot"
    Push-Location $root
    $output = cmd /c "npm.cmd run post-current-slot -- --slot $slot 2>&1"
    $exitCode = $LASTEXITCODE
    Pop-Location
    $output | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($exitCode -ne 0) {
        Write-Log "Slot $slot failed with exit code $exitCode."
        $failed += $slot
    } else {
        Write-Log "Slot $slot finished (published or already recorded)."
    }
}

if ($failed.Count -gt 0) {
    Show-Toast ("今天 slot {0} 補發失敗,請看 output\catch-up-logs\{1}.log" -f ($failed -join ", "), $date)
    exit 1
}

Write-Log "Catch-up run finished."
