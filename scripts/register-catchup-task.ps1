# Registers the Laundry-CatchUp-Publish scheduled task.
# Re-running replaces the existing task definition.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

try { Unregister-ScheduledTask -TaskName "Laundry-CatchUp-Publish" -Confirm:$false -ErrorAction Stop } catch {}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\catchup-publish.ps1`"" `
    -WorkingDirectory $root

$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At "10:50"),
    (New-ScheduledTaskTrigger -Daily -At "12:05"),
    (New-ScheduledTaskTrigger -Daily -At "20:05")
)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName "Laundry-CatchUp-Publish" -Action $action -Trigger $triggers -Settings $settings `
    -Description "私享家每日 FB/IG 補跑:已審核未發佈的當日 slot 自動補發;未審核則桌面通知。錯過觸發時間會在開機後補跑。" | Out-Null

Write-Host "Laundry-CatchUp-Publish registered."
Get-ScheduledTask -TaskName "Laundry-CatchUp-Publish" | Select-Object TaskName, State
