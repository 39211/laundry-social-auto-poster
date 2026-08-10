# Registers the daily automation scheduled tasks. Re-running replaces them.
#
#   06:30  Laundry-Daily-Generate    content, images, manifests, public site
#   09:00  Laundry-Weekly-Review     batch review, and day-30/60 checkpoints
#   10:20  Laundry-Daily-Approve     unattended approval when every gate passes
#   11:35  Laundry-CatchUp-Publish   slot 1 (11:30), retried at 13:30
#   13:30
#   14:00  Laundry-Reel-Production   build the next Reel, one batch ahead
#   12:05  Laundry-CatchUp-Publish   slot 3 noon Reel (12:00), retried at 13:50
#   13:50
#   20:35  Laundry-CatchUp-Publish   slot 2 evening Reel (20:30), retried at 22:15
#   21:00  Laundry-YouTube-Upload    after Meta, retried at 22:30
#   22:15 / 22:30
#
# Publishing runs five minutes after each slot rather than on a generic hourly
# sweep: the old 10:50 trigger fired before slot 1 was even due and the next one
# was not until 12:05, so every post went out 35 minutes late. The retries sit
# inside the script's own 4-hour recovery window, so a failed attempt still
# lands at a sensible hour instead of being posted stale.
#
# Reel production runs every day rather than waiting for the current batch to
# finish publishing: six Reels take six days to make, so starting on the day the
# last batch runs out would leave a gap.
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

    # -WindowStyle Hidden: the visible console window these tasks used to open
    # on the desktop got closed mid-run at 06:30 on 2026-08-03 (task result
    # 0xC000013A, console interrupt), killing the morning site push. Hidden
    # windows cannot be closed by accident.
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\$Script`"" `
        -WorkingDirectory $root
    # IgnoreNew: whether overlapping triggers (retry slots, patrol starts) run
    # concurrently used to depend on the host default; publishing scripts are
    # not re-entrant, so a second instance must simply not start (luna, high).
    $settings = New-ScheduledTaskSettingsSet @common -ExecutionTimeLimit $TimeLimit -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Triggers `
        -Settings $settings -Description $Description | Out-Null
    Write-Host "$Name registered."
}

Register-LaundryTask -Name "Laundry-Daily-Generate" -Script "daily-generate.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "06:30")) `
    -TimeLimit (New-TimeSpan -Hours 2) `
    -Description "私享家每日 06:30 生成:內容、圖片、影片候選與公開站,不核准也不發佈。"

Register-LaundryTask -Name "Laundry-Weekly-Review" -Script "weekly-review.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "09:00")) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家成效檢討:每天判斷是否有滿 72 小時的 Reel 可評,並在第 30/60 天各跑一次檢查點。只在有結果時通知。"

# Approval gets a second attempt because it is the step that silently loses a
# day. On 2026-07-28 generation finished late, so 10:20 had nothing to approve;
# by the time an approval existed, slot 1's 4-hour recovery window had closed
# and the post was correctly refused as stale. A retry at 11:15 still lands
# before the 11:30 slot. Approval is idempotent: an already-approved day is a
# no-op.
Register-LaundryTask -Name "Laundry-Daily-Approve" -Script "daily-approve.ps1" `
    -Triggers @(
        (New-ScheduledTaskTrigger -Daily -At "10:20"),
        (New-ScheduledTaskTrigger -Daily -At "11:15")
    ) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家每日自動審核:10:20 主跑、11:15 補跑(趕在 11:30 檔期前)。所有客觀閘門通過才核准,否則停下並通知。"

Register-LaundryTask -Name "Laundry-CatchUp-Publish" -Script "catchup-publish.ps1" `
    -Triggers @(
        (New-ScheduledTaskTrigger -Daily -At "11:35"),
        (New-ScheduledTaskTrigger -Daily -At "13:30"),
        (New-ScheduledTaskTrigger -Daily -At "12:05"),
        (New-ScheduledTaskTrigger -Daily -At "13:50"),
        (New-ScheduledTaskTrigger -Daily -At "20:35"),
        (New-ScheduledTaskTrigger -Daily -At "22:15")
    ) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家每日發佈:11:35 slot1、12:05 slot3(中午Reel)、20:35 slot2(晚上Reel),各留一次補發。超過 4 小時補發時限則改為通知。"

# After both evening publish windows: uploads the day's live Reel to YouTube.
# Separate task so a YouTube fault never blocks the Meta chain.
Register-LaundryTask -Name "Laundry-YouTube-Upload" -Script "youtube-upload.ps1" `
    -Triggers @(
        (New-ScheduledTaskTrigger -Daily -At "21:00"),
        (New-ScheduledTaskTrigger -Daily -At "22:30")
    ) `
    -TimeLimit (New-TimeSpan -Minutes 30) `
    -Description "私享家每日 YouTube Shorts 上傳:slot 2/3 的 Reel 在 IG 實際發布後各上傳一筆;未授權時提醒不報錯。"

# Thirty-minute patrol: revives disabled siblings and starts catch-up when a
# publish window is open with its slot unpublished. See watchdog-patrol.ps1
# for the incident history that makes this necessary.
# A -Once trigger with a 24-hour repetition duration STOPS FOREVER after that
# day: on 2026-08-08 the patrol's NextRunTime was empty from midnight onward,
# so nothing rescued the noon Reel when its publish triggers did not fire. The
# daily trigger re-arms the 30-minute repetition every day.
$patrolTrigger = New-ScheduledTaskTrigger -Daily -At "00:00"
$patrolTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At "00:00" `
    -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 24)).Repetition
Register-LaundryTask -Name "Laundry-Watchdog-Patrol" -Script "watchdog-patrol.ps1" `
    -Triggers @($patrolTrigger) `
    -TimeLimit (New-TimeSpan -Minutes 10) `
    -Description "私享家看門狗巡邏:每 30 分鐘救活被停用任務;發布窗開著卻沒發文時立刻啟動補發。"

Register-LaundryTask -Name "Laundry-Reel-Production" -Script "produce-next-reel.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "14:00")) `
    -TimeLimit (New-TimeSpan -Hours 2) `
    -Description "私享家每日 14:00 生產下一支 Reel 的素材與影片,永遠領先發佈一批;不剪接、不核准、不發佈。"

# End-of-day settlement: evidence-based verdict on posts, comments, Shorts and
# tomorrow's assets, with last-chance rescues. Session-independent by design --
# every ad-hoc monitor dies with its session; this one lives in the scheduler.
Register-LaundryTask -Name "Laundry-Day-Audit" -Script "day-audit.ps1" `
    -Triggers @((New-ScheduledTaskTrigger -Daily -At "22:50")) `
    -TimeLimit (New-TimeSpan -Minutes 15) `
    -Description "私享家每日 22:50 結算:對帳三檔發文、頭香、Shorts 與明日備料;缺口先自救再通知。"

Get-ScheduledTask | Where-Object { $_.TaskName -like "Laundry-*" } |
    Select-Object TaskName, State | Format-Table -AutoSize
