# Dot-sourced by every scheduled script. Tasks watch each other: on 2026-08-06
# the publish task was killed mid-run and disabled at midday, and the once-a-day
# 06:30 watchdog meant nothing could revive it until the next morning — the
# evening Reel survived only because a human noticed at 22:35. With every task
# re-arming its siblings, a disable now holds only until whichever sibling
# fires next, at most a few hours.
# Expects $logFile to be defined by the caller; falls back to silent enable.
#
# Maintenance suppression (luna, high): a human who disables a task to STOP a
# bad publish used to be overruled within 30 minutes by whichever sibling
# fired next. An explicit, expiring token now pauses the watchdog:
#   data\maintenance-suppress.json  ->  { "until": "2026-08-11T15:00:00+08:00", "reason": "..." }
# Expired or malformed tokens are ignored, so the pause can never become
# permanent by accident.
$watchdogSuppressPath = Join-Path (Split-Path -Parent $PSScriptRoot) "data\maintenance-suppress.json"
if (Test-Path $watchdogSuppressPath) {
    try {
        $watchdogSuppress = ConvertFrom-Json ([IO.File]::ReadAllText($watchdogSuppressPath, [Text.UTF8Encoding]::new($false)))
        if ([DateTime]::Parse($watchdogSuppress.until) -gt (Get-Date)) {
            if ($logFile) {
                "[{0:yyyy-MM-dd HH:mm:ss}] Watchdog suppressed until {1}: {2}" -f (Get-Date), $watchdogSuppress.until, $watchdogSuppress.reason |
                    Add-Content -Path $logFile -Encoding UTF8
            }
            return
        }
    } catch {}
}
foreach ($watchdogTask in Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -like "Laundry-*" -and $_.State -eq "Disabled" }) {
    Enable-ScheduledTask -TaskName $watchdogTask.TaskName -ErrorAction SilentlyContinue | Out-Null
    $watchdogLine = "[{0:yyyy-MM-dd HH:mm:ss}] Watchdog re-enabled disabled task: {1}" -f (Get-Date), $watchdogTask.TaskName
    if ($logFile) { $watchdogLine | Add-Content -Path $logFile -Encoding UTF8 }
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $watchdogTemplate = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $watchdogNodes = $watchdogTemplate.GetElementsByTagName("text")
        $watchdogNodes.Item(0).AppendChild($watchdogTemplate.CreateTextNode("私享家排程看門狗")) | Out-Null
        $watchdogNodes.Item(1).AppendChild($watchdogTemplate.CreateTextNode("$($watchdogTask.TaskName) 被停用了,已自動重新啟用。")) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryWatchdog").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($watchdogTemplate)))
    } catch {}
}
