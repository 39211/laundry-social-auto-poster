# 10:20 unattended approval. Approves only when every objective gate in
# src/autoApprove.ts passes, and notifies either way. Approval happens ~70
# minutes before the 11:30 slot, which is the window to intervene.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\daily-approve-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

function Write-Log([string]$message) {
    ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $now, $message) | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家自動審核")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryDailyApprove").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

Write-Log "Running auto-approve for $date."
Push-Location $root
$output = cmd /c "npm.cmd run auto-approve -- --date $date 2>&1"
Pop-Location
$output | Out-File -FilePath $logFile -Append -Encoding utf8

$text = ($output -join "`n")
$start = $text.IndexOf("{")
$stop = $text.LastIndexOf("}")
if ($start -lt 0 -or $stop -le $start) {
    Write-Log "Could not parse the auto-approve report."
    Show-Toast "自動審核沒有回傳可解讀的結果,請看 output\daily-approve-logs\$date.log"
    exit 1
}

$result = $text.Substring($start, $stop - $start + 1) | ConvertFrom-Json

if ($result.already_approved) {
    Write-Log "Already approved; nothing to do."
    exit 0
}

$prov = $result.ai_provenance
if ($null -ne $prov) {
    Write-Log ("AI provenance: {0} image(s) carry the C2PA manifest, {1} do not." -f $prov.with_manifest, $prov.without_manifest)
    if (-not $prov.consistent) {
        Write-Log "Mixed provenance: some images kept the manifest and some lost it."
    }
}

if ($result.approved) {
    $slots = @($result.approved_slots) -join ", "
    Write-Log "Approved slot(s) $slots."
    # Whether Meta shows its "AI info" label follows the manifest, not the prompt,
    # and a resize can drop it without anyone deciding to. Say which it is today.
    $label = if ($null -eq $prov -or ($prov.with_manifest + $prov.without_manifest) -eq 0) { "" }
             elseif ($prov.with_manifest -eq 0) { " 今天的圖沒有 AI 出處資訊,貼文預期不會出現 AI 標籤。" }
             elseif ($prov.without_manifest -eq 0) { " 今天的圖帶有 AI 出處資訊,貼文預期會出現 AI 標籤。" }
             else { (" 今天的圖出處不一致({0} 有 / {1} 無)。" -f $prov.with_manifest, $prov.without_manifest) }
    Show-Toast ("已自動核准今天 slot {0},11:30 起依序發佈。{1}要攔截請在 11:30 前刪除 data\approved-log\{2}.json" -f $slots, $label, $date)
    exit 0
}

$blockers = @($result.blockers)
$first = if ($blockers.Count -gt 0) { $blockers[0] } else { "未提供原因" }
Write-Log ("Not approved. Blockers: " + ($blockers -join " | "))
Show-Toast ("今天 ($date) 沒有通過自動審核,不會發文。原因:{0}" -f $first)
exit 1
