#requires -Version 5.1
<# Creates one current-user task. Run manually only after deployment approval.
   Daily 10:30-19:45 at 30-minute intervals: 10:30, 11:00, ..., 19:30.
   -WhatIf only previews; does not query or register a scheduled task. #>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$TaskName = 'LineBot-PullShopMdb',
    [string]$PullScript = ''  # resolved below: $PSScriptRoot can be empty inside param defaults on PS 5.1
)

$ErrorActionPreference = 'Stop'
if (-not $PullScript) { $PullScript = Join-Path $PSScriptRoot 'pull_shop_mdb.ps1' }
if (-not $PSCmdlet.ShouldProcess($TaskName, 'Register daily 10:30-19:30 MDB pull, every 30 minutes')) { return }
if (-not (Test-Path -LiteralPath $PullScript -PathType Leaf)) { throw 'Pull script not found' }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    throw 'Task already exists; review it manually before replacing it.'
}
$PullScript = (Resolve-Path -LiteralPath $PullScript).Path
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $PullScript + '"') -WorkingDirectory (Split-Path -Parent $PullScript)
$triggers = @(for ($minute = 630; $minute -le 1185; $minute += 30) {
    New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddMinutes($minute))
})
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal `
    -Settings $settings -Description 'Pull shop-pc MDB every 30 minutes during 10:30-19:45; preserve source mtime.'
