# Registers the daily automation scheduled tasks. Re-running replaces them.
#
#   06:30  Laundry-Daily-Generate  content, images, manifests, public site
#   10:20  Laundry-Daily-Approve   unattended approval when every gate passes
#   10:50  Laundry-CatchUp-Publish publish due slots, plus 12:05 and 20:05
#   12:05
#   20:05
#
# Every task uses StartWhenAvailable so a machine that was asleep still runs the
# stage after it wakes, which is what a fixed daily time alone does not give.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$common = @{
    StartWhenAvailable      = $true
    AllowStartIfOnBatteries = $true
    DontStopIfGoingOnBatteries = $true
}

function Register-LaundryTask {
    param(
        [string]$Name,
        [string]$Script,
        [System.Object[]]$Triggers,
        [TimeSpan]$TimeLimit,
        [string]$Description
    )

    try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop } catch {}

    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\$Script`"" `
        -WorkingDirectory $root
    $settings = New-ScheduledTaskSettingsSet @common -ExecutionTimeLimit $TimeLimit

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers `
        -Settings $settings -Description $Description | Out-Null
    Write-Host "$Name registered."
}

Register-LaundryTask -Name "Laundry-Daily-Generate" -Script "daily-generate.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "06:30")) `
    -TimeLimit (New-TimeSpan -Hours 2) `
    -Description "私享家每日 06:30 生成:內容、圖片、影片候選與公開站,不核准也不發佈。"

Register-LaundryTask -Name "Laundry-Daily-Approve" -Script "daily-approve.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "10:20")) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家每日 10:20 自動審核:所有客觀閘門通過才核准,否則停下並通知。"

Register-LaundryTask -Name "Laundry-CatchUp-Publish" -Script "catchup-publish.ps1" `
    -Triggers @(
        (New-ScheduledTaskTrigger -Daily -At "10:50"),
        (New-ScheduledTaskTrigger -Daily -At "12:05"),
        (New-ScheduledTaskTrigger -Daily -At "20:05")
    ) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家每日發佈補跑:已審核未發佈的當日時段自動補發,超過補發時限則改為通知。"

Get-ScheduledTask | Where-Object { $_.TaskName -like "Laundry-*" } |
    Select-Object TaskName, State | Format-Table -AutoSize
