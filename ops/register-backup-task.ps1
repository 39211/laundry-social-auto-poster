[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$BackupScript = (Join-Path $PSScriptRoot 'backup-sxj-live.ps1'),
    [string]$Root = 'C:\Users\cyc39\laundry-repo',
    [string]$LocalStateRoot = (Join-Path $env:LOCALAPPDATA 'line-bot'),
    [string]$MdbPath = 'C:\FXwash\eHank.mdb',
    [string]$BackupRoot = 'D:\AI-Lanes-work\_backups\sxj-live',
    [ValidateSet('SYSTEM','CurrentUser')][string]$RunAs = 'SYSTEM',
    [string]$TaskName = 'SXJ-Live-Daily-Backup',
    [string]$TaskPath = '\'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
Assert-RecoveryTaskIdentity $TaskName $TaskPath
$BackupScript = Get-RecoveryFullPath $BackupScript
$Root = Get-RecoveryFullPath $Root
$LocalStateRoot = Get-RecoveryFullPath $LocalStateRoot
$MdbPath = Get-RecoveryFullPath $MdbPath
$BackupRoot = Get-RecoveryFullPath $BackupRoot
if (-not (Test-Path -LiteralPath $BackupScript -PathType Leaf)) { throw "Backup script does not exist: $BackupScript" }
foreach ($value in @($BackupScript,$Root,$LocalStateRoot,$MdbPath,$BackupRoot)) {
    if ($value -match '["\r\n]') { throw 'Double quotes/newlines are not supported in task argument paths.' }
}
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $BackupScript + '" -Root "' + $Root + '" -LocalStateRoot "' + $LocalStateRoot + '" -MdbPath "' + $MdbPath + '" -BackupRoot "' + $BackupRoot + '"'
if (-not $PSCmdlet.ShouldProcess(($TaskPath + $TaskName), ('Register daily 03:30 backup: ' + $arguments))) { return }
# No password collection/storage. SYSTEM allows unattended backups; explicit source
# paths above still refer to the owner, not SYSTEM's LOCALAPPDATA at task runtime.
$engine = Join-Path $PSHOME 'powershell.exe'
$workingDirectory = Split-Path -Parent $BackupScript
$action = New-ScheduledTaskAction -Execute $engine -Argument $arguments -WorkingDirectory $workingDirectory
$trigger = New-ScheduledTaskTrigger -Daily -At '03:30'
if ($RunAs -eq 'SYSTEM') { $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest }
else { $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$expectedLogon = [int]$principal.LogonType
$expectedRunLevel = [int]$principal.RunLevel
$expectedInstances = [int]$settings.MultipleInstances
if (@(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq $TaskName -and $_.TaskPath -eq $TaskPath }).Count -gt 0) {
    throw 'Task already exists. Preserve/review its XML before explicitly replacing it.'
}
Ensure-RecoveryTaskFolder $TaskPath
Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'SXJ live private files + state + mdb + task XML; retain 14 verified backups.' -ErrorAction Stop | Out-Null
$registered = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction Stop
if (@($registered.Actions).Count -ne 1 -or $registered.Actions[0].Arguments -cne $arguments -or
    $registered.Actions[0].Execute -ine $engine -or $registered.Actions[0].WorkingDirectory -ine $workingDirectory) {
    throw 'Registered task action readback did not match the requested executable/arguments/working directory.'
}
if (@($registered.Triggers).Count -ne 1 -or $registered.Triggers[0].StartBoundary -notmatch 'T03:30:00' -or
    $registered.Triggers[0].DaysInterval -ne 1 -or -not $registered.Triggers[0].Enabled) {
    throw 'Registered task trigger readback is not enabled daily at 03:30.'
}
$principalMatches = $false
if ($RunAs -eq 'SYSTEM') { $principalMatches = $registered.Principal.UserId -in @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') }
else {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principalMatches = $registered.Principal.UserId -in @($identity.Name, $identity.User.Value)
}
if (-not $principalMatches -or [int]$registered.Principal.LogonType -ne $expectedLogon -or [int]$registered.Principal.RunLevel -ne $expectedRunLevel) {
    throw 'Registered task principal readback did not match the requested account/logon type/run level.'
}
if (-not $registered.Settings.Enabled -or -not $registered.Settings.StartWhenAvailable -or
    [int]$registered.Settings.MultipleInstances -ne $expectedInstances -or [Xml.XmlConvert]::ToTimeSpan($registered.Settings.ExecutionTimeLimit) -ne (New-TimeSpan -Hours 2)) {
    throw 'Registered task settings readback did not match the requested enabled/availability/concurrency/time limit.'
}
[pscustomobject]@{ TaskName=$TaskName; TaskPath=$TaskPath; DailyAt='03:30'; RunAs=$RunAs; Verified=$true }
