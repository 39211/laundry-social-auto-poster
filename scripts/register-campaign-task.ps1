# Registers the campaign poster task (re-running replaces it).
#   17:05  Laundry-Campaign-Poster   today's planned poster to FB + IG
#   18:40  retry (idempotent: platforms already logged as success are skipped)
# Both triggers sit inside the script's own 17:00-21:00 window.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot "post-campaign-poster.ps1"
$name = "Laundry-Campaign-Poster"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`"" -f $script) `
    -WorkingDirectory $root
$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At 17:05),
    (New-ScheduledTaskTrigger -Daily -At 18:40)
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
}
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings `
    -Description "Campaign poster: one planned poster per day to FB + IG (data/campaign-posts.json)" | Out-Null
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
