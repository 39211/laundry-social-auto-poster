# Registers nightly YouTube Analytics collection. Re-running replaces the task.
# Run from the MAIN checkout (a worktree path would break the moment the
# worktree is removed).
#
#   23:20 every day  Laundry-YouTube-Analytics  scripts\youtube-analytics.ps1
#
# It runs after the 23:10/23:15 GA4 and GSC collectors so the 72h loop can
# read the same-day YouTube numbers. StartWhenAvailable covers a sleeping
# machine. Do not execute this file from the analytics collector task itself.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$name = "Laundry-YouTube-Analytics"
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\youtube-analytics.ps1`"" `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At "23:20"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description "Nightly YouTube Analytics collection at 23:20; writes data\insights\youtube. Unmeasured stays unmeasured, never 0." | Out-Null
Write-Host "$name registered (daily at 23:20, ExecutionTimeLimit PT10M, root=$root)."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
