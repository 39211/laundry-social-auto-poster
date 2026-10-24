# Registers the 14:00 Instagram lane for off-calendar feature Reels.
# Re-running replaces the task. Run from the MAIN checkout, never a worktree.
#
#   14:00 every day  Laundry-Feature-Reel-1400  scripts\post-feature-reel.ps1
#
# DAILY, not -Once, on purpose: a spent one-shot leaves State=Ready with an empty
# NextRunTime, which watchdog-patrol.ps1 treats as a dead trigger and answers by
# re-registering every Laundry-* task. The script exits 0 on any day that has no
# data\feature-reels\<date>.json, so an idle lane costs nothing.
#
# 14:00 already holds Laundry-Publish-1400 and Laundry-Reel-Produce. This one only
# makes HTTPS calls to Meta and writes one JSON file, so it does not contend for
# git or the repo. ExecutionTimeLimit is 40 minutes: a 56 MB Reel can sit in
# Meta's container queue for several minutes before it is publishable.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$name = "Laundry-Feature-Reel-1400"
try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop } catch {}
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\post-feature-reel.ps1`"" `
    -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At "14:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Description "14:00 Instagram publish for an off-calendar feature Reel defined in data\feature-reels\<date>.json. Facebook and YouTube are scheduled ahead on the platforms themselves and are not handled here. Exits 0 when no feature reel is defined for the day. Never writes data\posted-log, so publish-sentinel and day-audit are unaffected." | Out-Null
Write-Host "$name registered (daily 14:00, ExecutionTimeLimit PT40M, root=$root)."
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $name | Select-Object NextRunTime
