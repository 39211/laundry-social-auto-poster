# Publish-window sentinel. Runs at 11:50 / 12:20 / 20:50 via Laundry-Publish-Sentinel.
# Checks the posted-log against due slots; on a gap it fires catchup AND raises a
# desktop toast. Lesson F21/F22: an alarm that only appends to a log file is not
# an alarm - both blackout days had the detection fire into an unread file.
#
# Live-post predicate matches catchup-publish.ps1 / nightly has_live_posts (F19):
# status success|posted, and not dry_run. A dry_run success used to silence this
# alarm the same way a fake post silences the nightly checker.
param([string]$RootPath = "C:\Users\cyc39\Documents\New project 5")

$logFile = Join-Path $RootPath "output\publish-sentinel.log"
function Write-Log([string]$line) {
    "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $line | Out-File $logFile -Append -Encoding utf8
}
function Show-Toast([string]$text) {
    if ($env:PUBLISH_SENTINEL_TOAST_FILE) {
        ("TOAST|" + $text) | Out-File -LiteralPath $env:PUBLISH_SENTINEL_TOAST_FILE -Append -Encoding utf8
        return
    }
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家發布哨兵")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryPublishSentinel").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

# Pure helpers so PS-layer smoke can invoke them without firing catchup or toasts.
function Get-DueSlots {
    param(
        [Parameter(Mandatory = $true)][string]$Time,
        [hashtable]$SlotTimes = $null,
        [AllowNull()][AllowEmptyCollection()][object]$CalendarSlots = $null
    )
    $hasCalendar = $PSBoundParameters.ContainsKey("CalendarSlots")
    # Legacy smoke thresholds were `$Time -ge "11:45"`, `$Time -ge "12:15"`, and `$Time -ge "20:45"`.
    if ($null -eq $SlotTimes) {
        $SlotTimes = Get-DefaultSlotTimes
    }
    $nowTime = [TimeSpan]::ParseExact($Time, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture)
    $due = @()
    foreach ($slot in 1, 3, 2) {
        if (-not $SlotTimes.ContainsKey($slot)) { continue }
        if ($nowTime -ge (([TimeSpan]$SlotTimes[$slot]) + [TimeSpan]::FromMinutes(15))) { $due += $slot }
    }
    if ($hasCalendar) {
        if ($null -eq $CalendarSlots) {
            $message = "行事曆讀不到、用預設到期格"
            if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log $message }
            else { Write-Warning $message }
        } else {
            $due = @($due | Where-Object { @($CalendarSlots) -contains $_ })
        }
    }
    return @($due)
}

function Test-LivePostedEntry($Entry) {
    if ($null -eq $Entry) { return $false }
    if ($Entry.dry_run) { return $false }
    $status = [string]$Entry.status
    return @("success", "posted") -contains $status
}

function Get-LivePostedSlots($Entries) {
    $slots = @(@($Entries) | Where-Object { Test-LivePostedEntry $_ } | ForEach-Object { [int]$_.slot })
    if ($slots.Count -eq 0) { return @() }
    return @($slots | Sort-Object -Unique)
}

function Get-MissingDueSlots($Due, $PostedSlots) {
    $posted = @($PostedSlots)
    return @(@($Due) | Where-Object { $posted -notcontains $_ })
}

# R1: Keep the F19 predicate and track each platform independently.
function Get-LivePostedPairs($Entries) {
    $pairs = @(foreach ($entry in @($Entries)) {
        if (-not (Test-LivePostedEntry $entry)) { continue }
        $platform = [string]$entry.platform
        if ([string]::IsNullOrWhiteSpace($platform)) { continue }
        "{0}:{1}" -f [int]$entry.slot, $platform.ToLowerInvariant()
    })
    return @($pairs | Sort-Object -Unique)
}

# R2: A live FB post cannot satisfy the IG obligation for the same slot.
function Get-MissingDuePairs($Due, $PostedPairs) {
    $posted = @($PostedPairs)
    return @(foreach ($slot in @($Due)) {
        foreach ($platform in @("facebook", "instagram")) {
            $pair = "{0}:{1}" -f [int]$slot, $platform
            if ($posted -notcontains $pair) { $pair }
        }
    })
}

# R3: An uncertain live submission needs confirmation, never automatic retry.
function Get-UncertainPairs($Entries) {
    $pairs = @(foreach ($entry in @($Entries)) {
        if ($null -eq $entry -or $entry.dry_run -or $entry.status -ne "uncertain") { continue }
        $platform = [string]$entry.platform
        if ([string]::IsNullOrWhiteSpace($platform)) { continue }
        "{0}:{1}" -f [int]$entry.slot, $platform.ToLowerInvariant()
    })
    return @($pairs | Sort-Object -Unique)
}

# R4: Queue markers identify which missing IG pairs must sync before judgment.
function Get-CloudOwnedIgPairs($Pairs, [string]$Date, [string]$RootPath) {
    return @(foreach ($pair in @($Pairs)) {
        $parts = $pair -split ":", 2
        if ($parts[1] -eq "instagram") {
            $queuePath = Join-Path $RootPath ("data\ig-cloud\queue\{0}-slot{1}.json" -f $Date, $parts[0])
            if (Test-Path -LiteralPath $queuePath) { $pair }
        }
    })
}

function Test-IgCloudSyncAvailable([string]$Root) {
    return (Test-Path -LiteralPath (Join-Path $Root "src\igCloud.ts"))
}

# R4: Owner-facing notices name both the slot and the platform.
function Format-PublishPairs($Pairs) {
    $labels = @(foreach ($pair in @($Pairs)) {
        $parts = $pair -split ":", 2
        $platform = if ($parts[1] -eq "instagram") { "IG" } else { "FB" }
        "slot {0} 的 {1}" -f $parts[0], $platform
    })
    return ($labels -join "、")
}

# R3: Share the same manual-confirmation instructions on every readback.
function Write-UncertainNotice($Pairs, [string]$Date) {
    if (@($Pairs).Count -eq 0) { return }
    Write-Log ("UNCERTAIN: " + (@($Pairs) -join ","))
    $list = Format-PublishPairs $Pairs
    $guidance = @(foreach ($pair in @($Pairs)) {
        $parts = $pair -split ":", 2
        $slot = $parts[0]
        $label = Format-PublishPairs @($pair)
        $scheduledUncertain = $false
        $cloudOwned = $false
        if ($parts[1] -eq "facebook") {
            # Read only for recovery advice; scheduled rows never count as live posts.
            try {
                $scheduledPath = Join-Path $RootPath "data\scheduled-log\$Date.json"
                $scheduledRows = Get-Content -LiteralPath $scheduledPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                $scheduledUncertain = @(@($scheduledRows) | Where-Object {
                    $null -ne $_ -and [string]$_.slot -eq $slot -and $_.platform -eq "facebook" -and
                    ($_.status -eq "uncertain" -or [string]::IsNullOrWhiteSpace([string]$_.scheduled_post_id))
                }).Count -gt 0
            } catch {
                # Missing/unreadable schedule data falls back to local commit-point advice.
                $scheduledUncertain = $false
            }
        } elseif ($parts[1] -eq "instagram") {
            $queuePath = Join-Path $RootPath ("data\ig-cloud\queue\{0}-slot{1}.json" -f $Date, $slot)
            $cloudOwned = Test-Path -LiteralPath $queuePath
            if (-not $cloudOwned) {
                try {
                    # Read fresh data for notices after either sync or catchup, too.
                    $postedPath = Join-Path $RootPath "data\posted-log\$Date.json"
                    $noticeRows = Get-Content -LiteralPath $postedPath -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                    $cloudOwned = @(@($noticeRows) | Where-Object {
                        $null -ne $_ -and -not $_.dry_run -and $_.status -eq "uncertain" -and
                        [string]$_.slot -eq $slot -and $_.platform -eq "instagram" -and
                        ([string]$_.error).StartsWith("cloud:", [StringComparison]::Ordinal)
                    }).Count -gt 0
                } catch {
                    $cloudOwned = $false
                }
            }
        }
        if ($scheduledUncertain) {
            "$label 是 FB 排程結果不明：把 data\scheduled-log\$Date.json 裡這格 facebook 那一列，以及 data\posted-log\$Date.json 裡這格 facebook 那一列都刪掉，再跑補發。"
        } elseif ($cloudOwned) {
            $resultPath = "results/{0}-slot{1}.json" -f $Date, $slot
            "$label 是雲端 IG：不要刪本機 data\posted-log\$Date.json 那一列；去雲端 repo 的 $resultPath 看結果，確認雲端沒發，就照 PR 132 README 把開關切 off 讓電腦收回，或等下一輪自動收回。"
        } else {
            "$label 是本機送出後未確認：把 data\posted-log\$Date.json 裡那一列刪掉再跑補發。"
        }
    })
    Show-Toast "發布結果不明:$list。先去粉專/IG 看貼文有沒有上;有就不用管。沒有的話，請依來源處理：$($guidance -join ' ')"
}

Set-Location $RootPath
$slotTimesLibrary = Join-Path $PSScriptRoot "publish-slot-times.ps1"
. $slotTimesLibrary
$taipei = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$taipeiNow = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $taipei)
$d = if ($env:PUBLISH_SENTINEL_DATE) { $env:PUBLISH_SENTINEL_DATE } else { $taipeiNow.ToString("yyyy-MM-dd") }
$t = if ($env:PUBLISH_SENTINEL_TIME) { $env:PUBLISH_SENTINEL_TIME } else { $taipeiNow.ToString("HH:mm") }
$calendarSlots = Get-CalendarSlots -Root $RootPath -Date $d
if ($null -eq $calendarSlots) { Write-Log "行事曆讀不到、用預設到期格" }
$slotTimeWarning = $null
$slotTimes = Get-SlotTimes -Root $RootPath -Date $d -WarningMessage ([ref]$slotTimeWarning)
if ($slotTimeWarning) { Write-Log ([string]$slotTimeWarning) }
$dueCalendarSlots = @(Get-EffectivePublishSlots -CalendarSlots $calendarSlots)
$due = @(Get-DueSlots -Time $t -SlotTimes $slotTimes -CalendarSlots $dueCalendarSlots)

# R1-R3: Every read separates live pairs from uncertain submissions.
$posted = @()
$uncertain = @()
$logPath = Join-Path $RootPath "data\posted-log\$d.json"
if (Test-Path -LiteralPath $logPath) {
    try {
        $parsed = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $posted = @(Get-LivePostedPairs $parsed)
        $uncertain = @(Get-UncertainPairs $parsed)
    } catch {
        Write-Log ("posted-log unreadable: " + $_.Exception.Message)
        Show-Toast "posted-log 讀不了,發布狀態不明,快看 log。"
    }
}

$missing = @(Get-MissingDuePairs $due $posted | Where-Object { $uncertain -notcontains $_ })
$missingRequiredCalendarSlots = @(Get-MissingRequiredCalendarSlots -CalendarSlots $calendarSlots)
if ($missingRequiredCalendarSlots.Count -gt 0) {
    Write-Log ("Calendar missing required slot(s): {0}; refusing automatic recovery." -f ($missingRequiredCalendarSlots -join ","))
    if ($missing.Count -gt 0) {
        Write-Log ("MISSING pairs: " + ($missing -join ","))
        $missingSlotNumbers = @($missing | ForEach-Object { ($_ -split ":", 2)[0] } | Sort-Object -Unique)
        foreach ($missingSlotNumber in $missingSlotNumbers) {
            $slotPairs = @($missing | Where-Object { $_.StartsWith("${missingSlotNumber}:", [StringComparison]::Ordinal) })
            Write-Log ("MISSING pairs: " + ($slotPairs -join ","))
        }
    }
    Show-Toast ("今天行事曆缺少必備 slot {0},自動補發已停止,請先修復行事曆。" -f ($missingRequiredCalendarSlots -join ","))
    exit 1
}

# R4: Sync once for any cloud-owned IG gap, then read back before deciding.
$cloudMissing = @(Get-CloudOwnedIgPairs $missing $d $RootPath)
if ($cloudMissing.Count -gt 0) {
    if (Test-IgCloudSyncAvailable $RootPath) {
        Write-Log ("IG cloud sync before gap decision: " + ($cloudMissing -join ","))
        try {
            & npx.cmd tsx src/igCloud.ts --sync --date $d *>> $logFile
            if ($LASTEXITCODE -ne 0) {
                Write-Log ("IG cloud sync failed (exit {0})" -f $LASTEXITCODE)
            }
        } catch {
            Write-Log ("IG cloud sync failed: " + $_.Exception.Message)
        }
    } else {
        Write-Log "IG cloud sync skipped: src\igCloud.ts not present (ig-cloud not installed on this branch)"
    }
    if (Test-Path -LiteralPath $logPath) {
        try {
            $parsed = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $posted = @(Get-LivePostedPairs $parsed)
            $uncertain = @(Get-UncertainPairs $parsed)
        } catch {
            # Preserve the last known uncertain pairs if sync readback fails.
            Write-Log ("posted-log unreadable after IG sync: " + $_.Exception.Message)
        }
    }
    $missing = @(Get-MissingDuePairs $due $posted | Where-Object { $uncertain -notcontains $_ })
}

# R3: Uncertain pairs alert the owner without triggering catchup.
Write-UncertainNotice $uncertain $d
if ($missing.Count -gt 0) {
    $list = Format-PublishPairs $missing
    $cloudNote = ""
    if (@(Get-CloudOwnedIgPairs $missing $d $RootPath).Count -gt 0) {
        $cloudNote = "IG 由雲端發,還沒有結果。"
    }
    Write-Log ("MISSING pairs: " + ($missing -join ",") + " - firing catchup")
    Show-Toast ("今天 $list 該發沒發!" + $cloudNote + "補發已啟動;若這則通知重複出現=補發也失敗,需要人看。")
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RootPath "scripts\catchup-publish.ps1") *>> $logFile
    # R1-R3: Re-check per platform after catchup; uncertain is not STILL MISSING.
    $posted2 = @()
    $uncertain2 = @($uncertain)
    if (Test-Path -LiteralPath $logPath) {
        try {
            $parsed2 = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $posted2 = @(Get-LivePostedPairs $parsed2)
            $uncertain2 = @(Get-UncertainPairs $parsed2)
        } catch {
            Write-Log ("posted-log unreadable after catchup: " + $_.Exception.Message)
        }
    }
    $still = @(Get-MissingDuePairs $due $posted2 | Where-Object { $uncertain2 -notcontains $_ })
    # R3: Notify newly uncertain pairs without repeating the pre-catchup notice.
    $newUncertain = @($uncertain2 | Where-Object { $uncertain -notcontains $_ })
    Write-UncertainNotice $newUncertain $d
    if ($still.Count -gt 0) {
        $s = Format-PublishPairs $still
        $cloudNote = ""
        if (@(Get-CloudOwnedIgPairs $still $d $RootPath).Count -gt 0) {
            $cloudNote = "IG 由雲端發,還沒有結果。"
        }
        Write-Log ("STILL MISSING after catchup: " + ($still -join ","))
        Show-Toast ("補發後 $s 仍未發布——發布鏈卡死,需要人工介入。" + $cloudNote)
    } elseif ($uncertain2.Count -gt 0) {
        Write-Log "catchup finished; uncertain results require manual confirmation"
    } else {
        Write-Log "catchup recovered all due pairs"
        Show-Toast "補發成功,今天該發的都上了。"
    }
} elseif ($uncertain.Count -gt 0) {
    Write-Log "no missing due pairs; uncertain results require manual confirmation"
} else {
    Write-Log "all due pairs posted"
}
