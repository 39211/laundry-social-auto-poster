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
function Get-DueSlots([string]$Time) {
    $due = @()
    if ($Time -ge "11:45") { $due += 1 }
    if ($Time -ge "12:15") { $due += 3 }
    if ($Time -ge "20:45") { $due += 2 }
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

Set-Location $RootPath
$d = (Get-Date).ToString("yyyy-MM-dd")
$t = (Get-Date).ToString("HH:mm")
$due = @(Get-DueSlots $t)

$posted = @()
$logPath = Join-Path $RootPath "data\posted-log\$d.json"
if (Test-Path -LiteralPath $logPath) {
    try {
        $parsed = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $posted = @(Get-LivePostedSlots $parsed)
    } catch {
        Write-Log ("posted-log unreadable: " + $_.Exception.Message)
        Show-Toast "posted-log 讀不了,發布狀態不明,快看 log。"
    }
}

$missing = @(Get-MissingDueSlots $due $posted)
if ($missing.Count -gt 0) {
    $list = ($missing | Sort-Object -Unique) -join ","
    Write-Log "MISSING slots: $list - firing catchup"
    Show-Toast "今天 slot $list 該發沒發!補發已啟動;若這則通知重複出現=補發也失敗,需要人看。"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RootPath "scripts\catchup-publish.ps1") *>> $logFile
    # Re-check after catchup: if still missing, say so loudly - a second toast that
    # names the failure is the difference between F21 and a caught incident.
    $posted2 = @()
    if (Test-Path -LiteralPath $logPath) {
        try {
            $parsed2 = Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $posted2 = @(Get-LivePostedSlots $parsed2)
        } catch {}
    }
    $still = @(Get-MissingDueSlots $due $posted2)
    if ($still.Count -gt 0) {
        $s = ($still | Sort-Object -Unique) -join ","
        Write-Log "STILL MISSING after catchup: $s"
        Show-Toast "補發後 slot $s 仍未發布——發布鏈卡死,需要人工介入。"
    } else {
        Write-Log "catchup recovered all due slots"
        Show-Toast "補發成功,今天該發的都上了。"
    }
} else {
    Write-Log "all due slots posted"
}
