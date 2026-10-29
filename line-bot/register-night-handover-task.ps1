#Requires -Version 5.1
# Prepare only in A4-3. The commander runs this from the approved deployment.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Python = 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe',
    [string]$TaskName = 'Laundry-LINE-Night-Handover'
)

$ErrorActionPreference = 'Stop'
$botRoot = $PSScriptRoot
$scriptPath = Join-Path $botRoot 'night_handover.py'
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Python not found: $Python"
}
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
    throw "Night handover script not found: $scriptPath"
}

# Use the same stdlib validation as the manager; this probe does no HTTP or I/O writes.
$probe = @'
import json, sys
sys.path.insert(0, sys.argv[1])
from tunnel_manager import load_handover_config
config = load_handover_config()
hour, minute = map(int, config['day_end'].split(':'))
total = (hour * 60 + minute + config['night_takeover_delay_min']) % 1440
print(json.dumps({'time': f'{total // 60:02d}:{total % 60:02d}', 'tz': config['tz']}))
'@
$scheduleJson = & $Python -B -X utf8 -c $probe $botRoot
if ($LASTEXITCODE -ne 0) {
    throw 'Invalid handover configuration; no task was registered.'
}
$schedule = $scheduleJson | ConvertFrom-Json

# Daily Task Scheduler triggers use the Windows local timezone. Refuse an
# accidental offset instead of registering the shop's takeover at the wrong hour.
if ($schedule.tz -ne 'Asia/Taipei' -or (Get-TimeZone).Id -ne 'Taipei Standard Time') {
    throw 'This task requires Asia/Taipei and Windows Taipei Standard Time.'
}

if ($PSCmdlet.ShouldProcess($TaskName, "Register daily night takeover at $($schedule.time)")) {
    # Match the existing scheduled-task wrappers: hidden console, exact Python,
    # and a propagated exit code. Quoting protects spaces and apostrophes in paths.
    $quotedPython = $Python.Replace("'", "''")
    $quotedScript = $scriptPath.Replace("'", "''")
    $command = "`$ErrorActionPreference = 'Stop'; & '$quotedPython' -B -X utf8 '$quotedScript'; exit `$LASTEXITCODE"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand $encodedCommand" `
        -WorkingDirectory $botRoot
    $trigger = New-ScheduledTaskTrigger -Daily -At $schedule.time
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'LINE night backup; shop remains primary in daytime.' `
        -Force | Out-Null
    Write-Host "$TaskName registered daily at $($schedule.time) ($($schedule.tz))."
}
