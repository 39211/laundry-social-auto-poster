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
        $rows = @((Get-Content $logPath -Raw -Encoding UTF8 | ConvertFrom-Json))
        $valid = $rows | Where-Object {
            $_.date -eq $d -and
            $_.dry_run -is [bool] -and $_.dry_run -eq $false -and
            (@("success", "posted") -contains $_.status) -and
            (@("facebook", "instagram") -contains $_.platform) -and
            $_.post_id -is [string] -and -not [string]::IsNullOrWhiteSpace($_.post_id) -and
            $_.post_id -eq $_.post_id.Trim()
        }
        $posted = @($due | Where-Object {
            $slot = $_
            $pair = @($valid | Where-Object { $_.slot -eq $slot })
            @("facebook", "instagram" | Where-Object {
                $platform = $_
                @($pair | Where-Object { $_.platform -eq $platform }).Count -eq 1
            }).Count -eq 2
        })
    } catch {
        Write-Log ("posted-log unreadable: " + $_.Exception.Message)
        Show-Toast "posted-log 讀不了,發布狀態不明,快看 log。"
    }
}

$missing = $due | Where-Object { $posted -notcontains $_ }
if ($missing) {
    $list = ($missing | Sort-Object -Unique) -join ","
    Write-Log "MISSING or unverified slots: $list - no automatic catchup; manual recovery required"
    Show-Toast "今天 slot $list 缺乏嚴格雙平台證據，未自動補發；需要人工介入。"
    exit 1
} else {
    Write-Log "all due slots posted"
}
