#requires -Version 5.1
<# Creates one current-user task. Run manually only after deployment approval.
   Weekly on Monday at 11:10 and 15:10 (the shop PC is on 10:00-20:00).
   -DryRun / -WhatIf only preview; they do not query or register a scheduled task. #>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DryRun,
    [string]$TaskName = 'LineBot-PullShopConversions',
    [string]$PullScript = ''  # resolved below: $PSScriptRoot can be empty inside param defaults on PS 5.1
)

$ErrorActionPreference = 'Stop'
if (-not $PullScript) { $PullScript = Join-Path $PSScriptRoot 'pull_shop_conversions.ps1' }
$minutes = @(670, 910)  # 11:10, 15:10
$powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

if ($DryRun) {
    Write-Output ('Task name          : ' + $TaskName)
    Write-Output ('Triggers           : weekly Monday ' + (($minutes | ForEach-Object { [datetime]::Today.AddMinutes($_).ToString('HH:mm') }) -join ', '))
    Write-Output ('User               : ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
    Write-Output 'LogonType/RunLevel : Interactive / Limited'
    Write-Output ('Execute            : ' + $powershell)
    Write-Output ('Arguments          : -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PullScript + '"')
    Write-Output 'Settings           : MultipleInstances IgnoreNew, ExecutionTimeLimit 10 minutes'
    Write-Output ('Script present     : ' + [IO.File]::Exists($PullScript))
    Write-Output 'DryRun: nothing was changed.'
    return
}
if (-not $PSCmdlet.ShouldProcess($TaskName, 'Register weekly Monday 11:10 and 15:10 conversions pull')) { return }
if (-not (Test-Path -LiteralPath $PullScript -PathType Leaf)) { throw 'Pull script not found' }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    throw 'Task already exists; review it manually before replacing it.'
}
$PullScript = (Resolve-Path -LiteralPath $PullScript).Path
$action = New-ScheduledTaskAction -Execute $powershell `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PullScript + '"') -WorkingDirectory (Split-Path -Parent $PullScript)
$triggers = @(foreach ($minute in $minutes) {
    New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At ([datetime]::Today.AddMinutes($minute))
})
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal `
    -Settings $settings -Description 'Pull shop weekly attribution summaries (source-to-order JSON only), Monday 11:10 and 15:10.'
