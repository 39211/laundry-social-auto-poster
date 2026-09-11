# One-shot resume runner for the 2026-09-15 reel-v3 character reel.
#
# Registered as a scheduled task because on 2026-09-12 01:35 every still backend
# was unavailable at the same time: Codex out of credit until 09-15 16:18, and
# Gemini/agy returning 429 RESOURCE_EXHAUSTED with a ~3h44m reset. Grok is not an
# option for stills -- its image model paints brand marks onto shoes, proven three
# times on 2026-08-25 -- so the only correct move was to wait and let this pick up
# the moment the quota returns.
#
# produce_day.py is resumable, so this is safe to fire more than once: anything
# already produced is skipped. It re-arms itself while the job is incomplete and
# deletes its own task once the master exists.
#
# ASCII only apart from the toast text; the file carries a UTF-8 BOM so cp950
# does not eat the Chinese.

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = "C:\Users\cyc39\laundry-repo"
$jobDir = "$repo\output\reel-v3\2026-09-15"
$log = "$repo\output\reel-production-logs\v3-2026-09-15.log"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null

function Write-Log([string]$m) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    $line | Out-File -FilePath $log -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $n = $t.GetElementsByTagName("text")
        $n.Item(0).AppendChild($t.CreateTextNode("私享家 Reel v3")) | Out-Null
        $n.Item(1).AppendChild($t.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryReelV3").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($t)))
    } catch { Write-Log ("Toast failed: " + $_.Exception.Message) }
}

Write-Log "Resuming reel-v3 production for 2026-09-15."
Push-Location $repo
$out = & python "$repo\scripts\reel-v3\produce_day.py" $jobDir 2>&1
$code = $LASTEXITCODE
Pop-Location
$out | ForEach-Object { Write-Log $_ }

$master = "$jobDir\master-candidate.mp4"
if (Test-Path $master) {
    $size = [int]((Get-Item $master).Length / 1MB)
    Write-Log "MASTER READY: $master (${size} MB)"
    Show-Toast "9/15 長片做好了,等你看片驗收。"
    # Job done: remove the task so it stops firing.
    Unregister-ScheduledTask -TaskName "Laundry-ReelV3-0915-Resume" -Confirm:$false -ErrorAction SilentlyContinue
    exit 0
}

Write-Log "Not finished (exit $code). Re-arming for the next attempt."
# Quota windows are hours, not minutes, so retry on a slow cadence rather than
# hammering a backend that has already said no.
$next = (Get-Date).AddHours(2)
try {
    $task = Get-ScheduledTask -TaskName "Laundry-ReelV3-0915-Resume" -ErrorAction Stop
    $task.Triggers = @(New-ScheduledTaskTrigger -Once -At $next)
    Set-ScheduledTask -TaskName "Laundry-ReelV3-0915-Resume" -Trigger $task.Triggers | Out-Null
    Write-Log ("Next attempt at {0:yyyy-MM-dd HH:mm}." -f $next)
} catch {
    Write-Log ("Could not re-arm: " + $_.Exception.Message)
}
exit $code
