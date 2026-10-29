# Register AtLogOn + 5-minute watchdog scheduled task Laundry-LINE-Bot. ASCII only.
# Do not run from the implementer.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Run = Join-Path $Root "run_line_bot.ps1"
$taskName = "Laundry-LINE-Bot"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"" + $Run + "`"")
# F7: AtLogOn plus 5-minute repeat; no RestartCount (action script exits 0)
# G2: 3650 days not TimeSpan.MaxValue (P99999999D is rejected as 0x80041318)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $logon,$watch -Settings $settings -User $env:USERNAME -Force | Out-Null
Write-Output ("registered " + $taskName)
