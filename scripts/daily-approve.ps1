# 10:20 unattended approval. Approves only when every objective gate in
# src/autoApprove.ts passes, and notifies either way. Approval happens ~70
# minutes before the 11:30 slot, which is the window to intervene.
$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\daily-approve-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"
. (Join-Path $PSScriptRoot "_watchdog.ps1")

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

# Path E: Codex automations (and any other external writer) can overwrite
# today's calendar without going through writeDailyContent. Detect that before
# any heal that would restamp the tampered slots and hide the evidence.
$calendar = Join-Path $root "data\content-calendar\$date.json"
if (Test-Path -LiteralPath $calendar) {
    Push-Location $root
    $tsx = Join-Path $root "node_modules\.bin\tsx.cmd"
    $inspectOut = & $tsx src/logging.ts --inspect-calendar --date $date 2>&1
    $inspectCode = $LASTEXITCODE
    Pop-Location
    $inspectOut | Out-File -FilePath $logFile -Append -Encoding utf8
    $shouldRebuild = ($inspectCode -eq 2)
    $inspectLine = @($inspectOut | Where-Object { "$_" -match '"shouldRebuild"' } | Select-Object -Last 1)
    if ($inspectLine) {
        try {
            if (([string]$inspectLine | ConvertFrom-Json).shouldRebuild) { $shouldRebuild = $true }
        } catch {}
    }
    if ($shouldRebuild) {
        Write-Log "Calendar tamper detected for $date; rebuilding from plan and regenerating the image manifest."
        Show-Toast ("今天 ($date) 的行事曆被外部寫手竄改,已從 plan 強制重建。證據: output\operations\calendar-tamper-$date.json")
        Push-Location $root
        $generateOut = cmd /c "npm.cmd run generate -- --date $date --force 2>&1"
        $generateCode = $LASTEXITCODE
        $generateOut | Out-File -FilePath $logFile -Append -Encoding utf8
        $manifestOut = cmd /c "npm.cmd run generate-image-manifest -- --date $date 2>&1"
        $manifestCode = $LASTEXITCODE
        $manifestOut | Out-File -FilePath $logFile -Append -Encoding utf8
        Pop-Location
        if ($generateCode -ne 0 -or $manifestCode -ne 0) {
            Write-Log "generate/manifest failed after tamper rebuild (generate=$generateCode manifest=$manifestCode); refusing auto-approve."
            Show-Toast "今天 ($date) 行事曆重建或圖片清單失敗,已停止自動審核。"
            exit 1
        }
    }
}

# Codex's morning flow writes calendar files directly and has reverted a
# scheduled Reel three times. Healing before judging means approval always
# evaluates the day as scheduled, not as clobbered.
Write-Log "Healing today's slots if they were rewritten."
Push-Location $root
# Slot 1 heals from the day lock (created at 06:30 once images exist);
# 2026-08-07 published a rewritten caption over images made for the locked
# topic. Reel slots heal from REEL_SCHEDULE as before.
cmd /c "npm.cmd run day-lock -- --date $date --heal 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
cmd /c "npm.cmd run heal-reel-slot -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
Pop-Location

Write-Log "Running auto-approve for $date."
Push-Location $root
$output = cmd /c "npm.cmd run auto-approve -- --date $date 2>&1"
Pop-Location
$output | Out-File -FilePath $logFile -Append -Encoding utf8

# The verdict is read from the report file autoApprove writes, never scraped
# out of npm stdout: a brace inside any npm warning used to shift the substring
# parse, and a "successful" parse into an object whose .approved was null
# silently skipped the day. An absent or unreadable report is an explicit
# failure, never a quiet skip.
$reportPath = Join-Path $root "output\operations\auto-approve-$date.json"
if (-not (Test-Path $reportPath)) {
    Write-Log "Auto-approve wrote no report file."
    Show-Toast "自動審核沒有產生報告檔,今天的審核狀態不明,請看 output\daily-approve-logs\$date.log"
    exit 1
}
try {
    $result = [IO.File]::ReadAllText($reportPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
} catch {
    Write-Log ("Report file unreadable: " + $_.Exception.Message)
    Show-Toast "自動審核報告檔無法解讀,請看 output\daily-approve-logs\$date.log"
    exit 1
}
if ($null -eq $result.date -or $result.date -ne $date) {
    Write-Log "Report file is for '$($result.date)', expected '$date'."
    Show-Toast "自動審核報告檔日期不符,請看 log。"
    exit 1
}

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
    # Do not tell the owner to delete the approval log. That was never a brake:
    # the catch-up chain re-approves any unapproved slot, and it became more
    # eager on 2026-08-15, so the deletion is undone within the hour. Point at
    # the one that holds -- approval and publishing both refuse while it exists,
    # and no automated path removes it.
    Show-Toast ("已自動核准今天 slot {0},11:30 起依序發佈。{1}要停下今天:在終端機執行 npm run pause -- --reason 原因" -f $slots, $label)
    exit 0
}

$blockers = @($result.blockers)
$first = if ($blockers.Count -gt 0) { $blockers[0] } else { "未提供原因" }
Write-Log ("Not approved. Blockers: " + ($blockers -join " | "))
Show-Toast ("今天 ($date) 沒有通過自動審核,不會發文。原因:{0}" -f $first)
exit 1
