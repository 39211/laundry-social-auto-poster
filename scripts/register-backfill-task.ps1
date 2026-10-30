[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([string]$RootPath = '')

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RootPath)) { $RootPath = Split-Path -Parent $PSScriptRoot }
$root = (Resolve-Path -LiteralPath $RootPath -ErrorAction Stop).ProviderPath
$name = 'Laundry-Backfill-1600'
$scriptPath = Join-Path $root 'scripts\backfill-publish.ps1'
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw 'backfill-publish.ps1 is missing.' }
$existing = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq $name })
if ($existing.Count -gt 0) { throw "$name already exists; refusing to replace it." }
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$first = [DateTime]::ParseExact('2026-10-31 16:00', 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$end = [DateTime]::ParseExact('2026-11-07 00:00', 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
if ((Get-Date) -ge $end) { throw 'The approved seven-day backfill window has ended.' }
if ((Get-Date) -gt $first) { Write-Warning 'Registered after first slot; fewer than 7 runs remain.' }
$description = 'Daily 16:00 backfill, 2026-10-31 through 2026-11-06. At most one attempt per day; owner may stop the queue.'
$preview = "$name; daily=16:00; first=2026-10-31; last=2026-11-06; user=$user; Interactive; Limited; limit=15m; IgnoreNew; root=$root"
if ($PSCmdlet.ShouldProcess($preview, 'Register scheduled task')) {
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') `
        -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '"') `
        -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -Daily -At $first
    $trigger.EndBoundary = $end.ToString('yyyy-MM-ddTHH:mm:ss')
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $name -TaskPath '\' -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings -Description $description -ErrorAction Stop | Out-Null
    Write-Output ("Registered: " + $preview)
}
