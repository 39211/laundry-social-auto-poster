# B3: registration recipe ONLY. Do not invoke until the owner authorizes it.
# Prefer the permanent checkout, not a disposable worktree. No LINE messages.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Python = 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe',
    [string]$TaskName = 'Laundry-Weekly-Report'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
$script = Join-Path $root 'scripts\weekly-report.py'
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) { throw 'Python executable not found.' }
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'weekly-report.py not found.' }

$data = Join-Path $root 'data'
$reports = Join-Path $root 'reports'
$out = Join-Path $reports 'weekly'
$arguments = '-B -X utf8 "{0}" --data-root "{1}" --reports-root "{2}" --out "{3}"' -f $script, $data, $reports, $out

if ($PSCmdlet.ShouldProcess($TaskName, "Register weekly Monday 08:00 task for $root")) {
    $action = New-ScheduledTaskAction -Execute $Python -Argument $arguments -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At '08:00'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
        -LogonType Interactive -RunLevel Limited
    # Intentionally no -Force: an existing task must not be silently replaced.
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description 'Monday 08:00 local time: offline report for the previous ISO week; no LINE or API calls.'
}
