# Registers the three-day optimisation loop. Run from the MAIN checkout after
# PR #36 is merged (a worktree path would break the moment the worktree is
# removed). Re-running replaces the task.
#
#   23:30 every 3 days  Laundry-Optimize-72h  scripts\optimize-72h.ps1
#
# It runs after the 23:10/23:15 GA4 and GSC collectors so the window it reads
# is the freshest one available. StartWhenAvailable covers a sleeping machine.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$name = "Laundry-Optimize-72h"
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\optimize-72h.ps1`"" `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -DaysInterval 3 -At "23:30"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description "Every 3 days: sync insights, 72h review, GA4/GSC reads, one-knob decision sheet in output\optimize-72h" | Out-Null
Write-Host "$name registered (every 3 days at 23:30, root=$root)."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
