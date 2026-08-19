# Publish-window sentinel. Runs at 11:50 / 12:20 / 20:50 via Laundry-Publish-Sentinel.
# Checks the posted-log against due slots; on a gap it fires catchup AND raises a
# desktop toast. Lesson F21/F22: an alarm that only appends to a log file is not
# an alarm - both blackout days had the detection fire into an unread file.
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

Set-Location $RootPath
$d = (Get-Date).ToString("yyyy-MM-dd")
$t = (Get-Date).ToString("HH:mm")
$due = @()
if ($t -ge "11:45") { $due += 1 }
if ($t -ge "12:15") { $due += 3 }
if ($t -ge "20:45") { $due += 2 }

$posted = @()
$logPath = Join-Path $RootPath "data\posted-log\$d.json"
if (Test-Path $logPath) {
    try {
        $posted = (Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json) |
            Where-Object { $_.status -eq "success" } | ForEach-Object { $_.slot }
    } catch {
        Write-Log ("posted-log unreadable: " + $_.Exception.Message)
        Show-Toast "posted-log 讀不了,發布狀態不明,快看 log。"
    }
}

$missing = $due | Where-Object { $posted -notcontains $_ }
if ($missing) {
    $list = ($missing | Sort-Object -Unique) -join ","
    Write-Log "MISSING slots: $list - firing catchup"
    Show-Toast "今天 slot $list 該發沒發!補發已啟動;若這則通知重複出現=補發也失敗,需要人看。"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RootPath "scripts\catchup-publish.ps1") *>> $logFile
    # Re-check after catchup: if still missing, say so loudly - a second toast that
    # names the failure is the difference between F21 and a caught incident.
    $posted2 = @()
    if (Test-Path $logPath) {
        try { $posted2 = (Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json) | Where-Object { $_.status -eq "success" } | ForEach-Object { $_.slot } } catch {}
    }
    $still = $due | Where-Object { $posted2 -notcontains $_ }
    if ($still) {
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
