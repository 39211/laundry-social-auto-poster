#requires -Version 5.1
<#
Register or update the shop task FXwash-Attribution-Weekly (task card B2-7).
Weekly, Monday 10:40 local, current user (AN), LogonType Interactive, RunLevel Limited,
StartWhenAvailable, execution time limit 30 minutes, no repetition, no overlapping instances.
Idempotent: an existing task with the same name is replaced by the same definition.
-DryRun prints the definition and changes nothing.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$TaskName = 'FXwash-Attribution-Weekly',
    [string]$ScriptPath = 'C:\LaundryStores\fxwash\runtime\attribution_weekly.ps1',
    [switch]$AllowOtherUser
)

$ErrorActionPreference = 'Stop'

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$fileArgument = $ScriptPath
if ($ScriptPath -match '\s') { $fileArgument = '"' + $ScriptPath + '"' }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + $fileArgument
$workDir = Split-Path -Parent (Split-Path -Parent $ScriptPath)
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$userName = $userId.Split('\')[-1]
$at = [datetime]::Today.AddHours(10).AddMinutes(40)
$limit = New-TimeSpan -Minutes 30
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$description = 'B2-7: weekly attribution export, then retention (Monday 10:40). Log: logs\attribution_weekly.log'

Write-Output ('Task name          : ' + $TaskName)
Write-Output ('Exists now         : ' + $(if ($existing) { 'yes (will be updated)' } else { 'no (will be created)' }))
Write-Output ('Trigger            : weekly, Monday ' + $at.ToString('HH:mm') + ' local, no repetition')
Write-Output ('User               : ' + $userId)
Write-Output 'LogonType/RunLevel : Interactive / Limited'
Write-Output ('Execute            : ' + $powershell)
Write-Output ('Arguments          : ' + $arguments)
Write-Output ('Working directory  : ' + $workDir)
Write-Output 'StartWhenAvailable : True'
Write-Output 'ExecutionTimeLimit : 30 minutes'
Write-Output 'MultipleInstances  : IgnoreNew'
Write-Output ('Script present     : ' + [IO.File]::Exists($ScriptPath))
if ($userName -ine 'AN') {
    Write-Output ('WARNING: current user is not AN (' + $userId + ').')
}

if ($DryRun) {
    Write-Output 'DryRun: nothing was changed.'
    return
}

if ($userName -ine 'AN' -and -not $AllowOtherUser) {
    throw 'Refusing to register for a user other than AN; pass -AllowOtherUser if this is intended.'
}
if (-not [IO.File]::Exists($ScriptPath)) { throw 'Weekly script not found: copy attribution_weekly.ps1 first.' }

$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At $at
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit $limit
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description $description -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
$firstTrigger = @($task.Triggers)[0]
Write-Output ('Registered (' + $(if ($existing) { 'updated' } else { 'created' }) + '): ' + $TaskName)
Write-Output ('  Trigger start   : ' + $firstTrigger.StartBoundary)
Write-Output ('  Principal       : ' + $task.Principal.UserId + ' / ' + $task.Principal.LogonType + ' / ' + $task.Principal.RunLevel)
Write-Output ('  Time limit      : ' + $task.Settings.ExecutionTimeLimit + '  StartWhenAvailable=' + $task.Settings.StartWhenAvailable)
