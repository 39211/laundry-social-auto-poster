# Registers nightly YouTube Analytics collection. Re-running replaces the task.
# Run from the MAIN checkout (a worktree path would break the moment the
# worktree is removed).
#
#   23:05 every day  Laundry-YouTube-Analytics  scripts\youtube-analytics.ps1
#
# 23:05 avoids the 23:10 GA4, 23:15 GSC, and 23:30 optimize-72h tasks.
# Nothing currently reads data\insights\youtube; a future 72h-loop consumer
# is separate work. Do not execute this file from the analytics collector
# task itself.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$name = "Laundry-YouTube-Analytics"
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\youtube-analytics.ps1`"" `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At "23:05"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description "Nightly YouTube Analytics collection at 23:05; writes data\insights\youtube. Unmeasured stays unmeasured, never 0. No current consumer of that directory." | Out-Null
Write-Host "$name registered (daily at 23:05, ExecutionTimeLimit PT20M, root=$root)."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
