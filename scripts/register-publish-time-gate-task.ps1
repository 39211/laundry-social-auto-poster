[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$RootPath = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($RootPath)
$gatePath = Join-Path $root "scripts\publish-time-gate.ps1"
$sentinelPath = Join-Path $root "scripts\publish-sentinel.ps1"
$common = @{
    StartWhenAvailable         = $true
    AllowStartIfOnBatteries     = $true
    DontStopIfGoingOnBatteries  = $true
    WakeToRun                  = $true
}
$plan = @(
    [pscustomobject]@{ Name = "Laundry-Publish-Time-Gate"; Start = "14:00"; RepetitionInterval = 5; RepetitionMinutes = 150; Script = $gatePath; ActionArguments = ""; Repetition = "" },
    [pscustomobject]@{ Name = "Laundry-Publish-Sentinel-Afternoon"; Start = "16:40"; RepetitionInterval = 0; RepetitionMinutes = 0; Script = $sentinelPath; ActionArguments = ""; Repetition = "" }
)

foreach ($task in $plan) {
    $task.ActionArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`" -RootPath `"{1}`"" -f $task.Script, $root
    $task.Repetition = if ($task.RepetitionInterval -gt 0) {
        if ($task.RepetitionMinutes -eq 150) { "PT{0}M for PT2H30M" -f $task.RepetitionInterval }
        else { "PT{0}M for PT{1}M" -f $task.RepetitionInterval, $task.RepetitionMinutes }
    } else {
        "none"
    }
}

if ($WhatIfPreference) {
    foreach ($task in $plan) {
        Write-Output ("WHATIF_TASK| {0} | action=Execute:powershell.exe;Argument:`"{1}`";WorkingDirectory:`"{2}`" | trigger=daily at {3} | repetition={4} | settings=StartWhenAvailable:{5},AllowStartIfOnBatteries:{6},DontStopIfGoingOnBatteries:{7},WakeToRun:{8},MultipleInstances:IgnoreNew,ExecutionTimeLimit:PT2H" -f `
            $task.Name, $task.ActionArguments, $root, $task.Start, $task.Repetition,
            $common.StartWhenAvailable, $common.AllowStartIfOnBatteries, $common.DontStopIfGoingOnBatteries, $common.WakeToRun)
    }
    return
}

foreach ($task in $plan) {
    if (-not $PSCmdlet.ShouldProcess($task.Name, "Replace publish-time scheduled task")) { continue }

    # Replace only the two tasks owned here. Other Laundry tasks are untouched.
    try { Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction Stop } catch {}

    $start = [DateTime]::Today.Add([TimeSpan]::ParseExact($task.Start, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture))
    $trigger = New-ScheduledTaskTrigger -Daily -At $start
    if ($task.RepetitionInterval -gt 0) {
        $once = New-ScheduledTaskTrigger -Once -At $start `
            -RepetitionInterval (New-TimeSpan -Minutes $task.RepetitionInterval) `
            -RepetitionDuration (New-TimeSpan -Minutes $task.RepetitionMinutes)
        $trigger.Repetition = $once.Repetition
    }
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $task.ActionArguments -WorkingDirectory $root
    $settings = New-ScheduledTaskSettingsSet @common -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
    Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Description "Publish-time experiment rescue and afternoon sentinel" | Out-Null
    Write-Output ("REGISTERED| {0}" -f $task.Name)
}
