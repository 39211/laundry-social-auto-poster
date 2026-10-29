# Catch-up publisher for the daily 私享家 FB/IG slots.
# Safe to run repeatedly: post-current-slot enforces the approved-log gate and
# skips slots already recorded in posted-log. Same-day catch-up is authorized
# by data/publishing-policy.json (same_day_catch_up: true).
$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($env:CATCHUP_PUBLISH_ROOT) { [IO.Path]::GetFullPath($env:CATCHUP_PUBLISH_ROOT) } else { Split-Path -Parent $PSScriptRoot }

$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")
if ($env:CATCHUP_PUBLISH_DATE) { $date = $env:CATCHUP_PUBLISH_DATE }
if ($env:CATCHUP_PUBLISH_TIME) {
    $now = [DateTime]::ParseExact(("{0} {1}" -f $date, $env:CATCHUP_PUBLISH_TIME), "yyyy-MM-dd HH:mm", [Globalization.CultureInfo]::InvariantCulture)
}

$logDir = Join-Path $root "output\catch-up-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"
$pipelineLibrary = Join-Path $PSScriptRoot '_pipeline-lock.ps1'
if (-not (Test-Path -LiteralPath $pipelineLibrary)) { throw "Required pipeline lock library missing: $pipelineLibrary" }
. $pipelineLibrary
. (Join-Path $PSScriptRoot "publish-slot-times.ps1")

function Write-Log([string]$message) {
    $line = "[{0}] {1}" -f $now.ToString("yyyy-MM-dd HH:mm:ss"), $message
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Show-Toast([string]$text) {
    if ($env:CATCHUP_PUBLISH_TOAST_FILE) {
        ("TOAST|" + $text) | Out-File -LiteralPath $env:CATCHUP_PUBLISH_TOAST_FILE -Append -Encoding utf8
        return
    }
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家發文補跑")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryCatchUp").Show($toast)
    } catch {
        Write-Log ("Toast failed: " + $_.Exception.Message)
    }
}

function Get-PublishLastError($Output, [string]$Fallback) {
    $lines = @($Output | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $errors = @($lines | Where-Object { $_ -match '^\s*(fatal:|\w*Error:|errno:|code:)' })
    $line = if ($errors.Count -gt 0) { $errors[-1].Trim() } elseif ($lines.Count -gt 0) { $lines[-1].Trim() } else { $Fallback }
    # Keep notices single-line and avoid copying credentials from tool output.
    $line = $line -replace '(?i)Bearer\s+\S+', 'Bearer [REDACTED]'
    $line = $line -replace '(?i)((?:access_token|token|secret|password|api_key)[=:]\s*)[^\s&]+', '$1[REDACTED]'
    return ($line -replace '[\r\n\t]+', ' ')
}

function Get-PublishAlertState([string]$AlertDate) {
    $path = Join-Path $root "data\publish-alerts\$AlertDate.json"
    if (Test-Path -LiteralPath $path) {
        $state = [IO.File]::ReadAllText($path) | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $state -or $state.date -ne $AlertDate -or $null -eq $state.PSObject.Properties['reasons']) {
            throw "Invalid publish-alert state for $AlertDate; preserving it to avoid duplicate notices."
        }
        return $state
    }
    # Midnight resets the daily notice budget, not consecutive failed attempts.
    $directory = Join-Path $root 'data\publish-alerts'
    $priorFile = $null
    if (Test-Path -LiteralPath $directory) {
        $priorFile = Get-ChildItem -LiteralPath $directory -Filter '*.json' -File -ErrorAction Stop |
            Where-Object { $_.BaseName -match '^\d{4}-\d{2}-\d{2}$' -and $_.BaseName -lt $AlertDate } |
            Sort-Object -Property BaseName -Descending | Select-Object -First 1
    }
    $failures = 0
    $lastError = ''
    if ($null -ne $priorFile) {
        # No run on an offline day is not a successful publish-pages attempt.
        $prior = [IO.File]::ReadAllText($priorFile.FullName) | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $prior -and $prior.date -eq $priorFile.BaseName) {
            $failures = [int]$prior.publish_pages_consecutive_failures
            $lastError = [string]$prior.last_error
        }
    }
    return [pscustomobject]@{ date = $AlertDate; publish_pages_consecutive_failures = $failures; last_error = $lastError; reasons = @() }
}

function Save-PublishAlertState($State) {
    $directory = Join-Path $root 'data\publish-alerts'
    [void][IO.Directory]::CreateDirectory($directory)
    $path = Join-Path $directory ($State.date + '.json')
    $temporary = $path + '.' + [guid]::NewGuid().ToString('n') + '.tmp'
    try {
        [IO.File]::WriteAllText($temporary, ($State | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $path -Force -ErrorAction Stop
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Send-PublishStaffAlert([string]$Message, [string]$Key) {
    $staffModule = Join-Path $root 'line-bot\staff_notify.py'
    $python = 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe'
    if (-not (Test-Path -LiteralPath $staffModule) -or -not (Test-Path -LiteralPath $python)) { return $false }
    # Existing raw group-text interface. No customer inbox/handoff is fabricated.
    # Pass Unicode/path data on stdin, never through a shell or Python source.
    $bridge = "import json,os,sys,uuid; p=json.load(sys.stdin); os.environ['LAUNDRY_REPO_ROOT']=p['root']; sys.path.insert(0,os.path.join(p['root'],'line-bot')); import staff_notify as s; ok,err=s._post_to_group(s.group_id(),p['message'],str(uuid.uuid5(uuid.NAMESPACE_URL,p['key']))); sys.exit(0 if ok else 1)"
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $python
    $start.Arguments = '-X utf8 -B -c "' + $bridge + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = $null
    try {
        $process = [Diagnostics.Process]::Start($start)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $payload = @{ root = $root; message = $Message; key = $Key } | ConvertTo-Json -Compress
        $asciiPayload = [regex]::Replace($payload, '[^\x00-\x7F]', { param($match) '\u{0:x4}' -f [int][char]$match.Value })
        $process.StandardInput.WriteLine($asciiPayload)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(25000)) {
            $process.Kill()
            $process.WaitForExit()
            Write-Log 'staff_notify timed out; using persisted alert and toast.'
            return $false
        }
        if ($process.ExitCode -ne 0) {
            Write-Log ("staff_notify failed (exit {0}); using persisted alert and toast." -f $process.ExitCode)
        }
        return ($process.ExitCode -eq 0)
    } catch {
        Write-Log ('staff_notify unavailable: ' + $_.Exception.GetType().Name)
        return $false
    } finally {
        if ($null -ne $process) { $process.Dispose() }
    }
}

function Invoke-CatchupPublishAlerts {
    if ($env:CATCHUP_PUBLISH_PLAN_ONLY -eq 'true') { return }
    $alertNow = if ($env:CATCHUP_PUBLISH_TIME) { $now } else { [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz) }
    $day = [DateTime]::ParseExact($date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    # Slot 2's 20:30 + 4h expiry is on the next date. Read yesterday too.
    foreach ($alertDate in @($date, $day.AddDays(-1).ToString('yyyy-MM-dd'))) {
        $calendarPath = Join-Path $root "data\content-calendar\$alertDate.json"
        if ($alertDate -ne $date -and -not (Test-Path -LiteralPath $calendarPath)) { continue }
        $state = Get-PublishAlertState $alertDate
        if ($alertDate -eq $date) {
            if ($script:publishPagesAttempted) {
                if ($script:publishPagesSucceeded) { $state.publish_pages_consecutive_failures = 0; $state.last_error = '' }
                else { $state.publish_pages_consecutive_failures = [int]$state.publish_pages_consecutive_failures + 1 }
            }
            if ($script:pipelineLastError) { $state.last_error = $script:pipelineLastError }
        }
        $slots = @(Get-EffectivePublishSlots -CalendarSlots (Get-CalendarSlots -Root $root -Date $alertDate))
        $times = Get-SlotTimes -Root $root -Date $alertDate
        $rows = @()
        $postedPath = Join-Path $root "data\posted-log\$alertDate.json"
        if (Test-Path -LiteralPath $postedPath) {
            try {
                # Windows PowerShell 5.1 emits a JSON array as one pipeline item.
                $parsedRows = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($postedPath)) -ErrorAction Stop
                $rows = @($parsedRows)
            }
            catch { $state.last_error = 'posted-log unreadable; no verified success record' }
        }
        $missing = @()
        $expired = @()
        $slotDay = [DateTime]::ParseExact($alertDate, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        foreach ($slot in $slots) {
            $live = @($rows | Where-Object { $_.slot -eq $slot -and -not $_.dry_run -and @('success', 'posted') -contains $_.status })
            if (@($live | Where-Object { $_.platform -eq 'facebook' }).Count -gt 0 -and
                @($live | Where-Object { $_.platform -eq 'instagram' }).Count -gt 0) { continue }
            $missing += $slot
            if ($times.ContainsKey([int]$slot) -and $alertNow -ge $slotDay.Add($times[[int]$slot]).AddHours(4)) { $expired += $slot }
        }
        $pagesFailed = $alertDate -eq $date -and $script:publishPagesAttempted -and -not $script:publishPagesSucceeded -and [int]$state.publish_pages_consecutive_failures -ge 2
        if ($expired.Count -gt 0 -or $pagesFailed) {
            $reason = [string]$state.last_error
            if (-not $reason) { $reason = 'posted-log 缺少 FB/IG 成功紀錄' }
            $reasonKey = if ($reason -match 'index\.lock') { 'git-index-lock' } else { $reason.ToLowerInvariant() }
            $hash = [Security.Cryptography.SHA256]::Create()
            try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($reasonKey))).Replace('-', '').ToLowerInvariant() }
            finally { $hash.Dispose() }
            if (@($state.reasons | Where-Object { $_.key -eq $key }).Count -eq 0) {
                $alertSlots = if ($expired.Count -gt 0) { $expired } else { $missing }
                $subject = if (@($alertSlots).Count -gt 0) { 'slot {0} 未發出' -f ($alertSlots -join ',') } else { '公開站更新連續失敗（各 slot 已有成功紀錄）' }
                $message = '[發布異常] {0} {1};原因:{2};看 output/catch-up-logs/{0}.log' -f $alertDate, $subject, $reason
                $entry = [pscustomobject]@{ key = $key; reason = $reason; message = $message; attempted_at = $alertNow.ToString('o'); delivery = 'reserved' }
                # Reserve while holding the pipeline mutex before any external call.
                $state.reasons = @($state.reasons) + @($entry)
                Save-PublishAlertState $state
                if (Send-PublishStaffAlert -Message $message -Key "$root/$alertDate/$key") {
                    $entry.delivery = 'line'
                    Write-Log "Publish alert delivered via staff_notify for $alertDate (reason $key)."
                } else {
                    $entry.delivery = 'toast-fallback'
                    Show-Toast $message
                    Write-Log "Publish alert persisted with toast fallback for $alertDate (reason $key)."
                }
            }
        }
        Save-PublishAlertState $state
    }
}

function Invoke-CatchupSocialFollowup {
    Push-Location $root
    cmd /c "npm.cmd run first-comment -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    cmd /c "npm.cmd run share-story -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}

function Invoke-CatchupEveningSteps {
    Invoke-CatchupSocialFollowup
    Invoke-CatchupEveningCloseout
}

function Invoke-CatchupEveningCloseout {

    $queuePath = Join-Path $root "data\video-repair-queue\queue.json"
    if (Test-Path $queuePath) {
        try {
            $parsed = ConvertFrom-Json -InputObject (Get-Content -Path $queuePath -Raw -Encoding utf8)
            $queue = @($parsed)
            $open = @($queue | Where-Object { $_.status -eq "VIDEO_DEFERRED" -and -not $_.dry_run })
            $faults = @($open | Where-Object { $_.defer_kind -eq "unexpected" -and -not $_.frozen_at })

            if ($faults.Count -gt 0) {
                $first = $faults[0]
                Write-Log ("UNEXPECTED video failure: {0} slot {1} - {2}" -f $first.source_date, $first.source_slot, $first.failure_reason)
                Show-Toast ("影片檢查本身出錯({0} 筆),不是等待複審。{1} slot {2}:{3}" -f $faults.Count, $first.source_date, $first.source_slot, $first.failure_reason)
            } elseif ($open.Count -gt 0 -and $now.TimeOfDay -ge [TimeSpan]"20:30") {
                Write-Log ("{0} video repair(s) still open." -f $open.Count)
                Show-Toast ("有 {0} 支影片待修復,今天已改發圖片。修好後放進下一篇題材相符的貼文。" -f $open.Count)
            }
        } catch {
            Write-Log ("Could not read repair queue: " + $_.Exception.Message)
        }
    }

    if ($now.TimeOfDay -ge [TimeSpan]"20:30") {
        Push-Location $root
        $reachOut = cmd /c "npm.cmd run local-reach 2>&1"
        Pop-Location
        $reachOut | Out-File -FilePath $logFile -Append -Encoding utf8

        $reachPath = Join-Path $root "output\operations\local-reach.json"
        if (Test-Path $reachPath) {
            try {
                $reach = ConvertFrom-Json -InputObject (Get-Content -Path $reachPath -Raw -Encoding utf8)
                Write-Log ("28d: non-follower reach {0}, accounts engaged {1}, followers gained {2}" -f `
                    $reach.reach_non_follower, $reach.accounts_engaged, $reach.followers_gained)
            } catch {
                Write-Log ("Could not read local-reach report: " + $_.Exception.Message)
            }
        }
    }
}

$script:publishPagesAttempted = $false
$script:publishPagesSucceeded = $false
$script:pipelineLastError = ''
$pipelineMutex = $null
try {
$pipelineMutex = Enter-PipelineMutex -Name 'sxj-publish' -TimeoutSec 600
# Refresh the clock after waiting so the existing 4h gate uses actual entry time.
if (-not $env:CATCHUP_PUBLISH_TIME) {
    $now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    if (-not $env:CATCHUP_PUBLISH_DATE) { $date = $now.ToString('yyyy-MM-dd'); $logFile = Join-Path $logDir "$date.log" }
}
Remove-StaleGitLock -RepoRoot $root
. (Join-Path $PSScriptRoot "_watchdog.ps1")
Write-Log "Catch-up run started (Taipei time $($now.ToString('HH:mm')))."

# Restore today's scheduled Reel before publishing anything: a morning rewrite
# of the calendar (it has happened three times) must cost nothing more than
# this heal step. No-op when the slot is already correct.
Push-Location $root
# Slot 1 heals from the day lock too: on 2026-08-07 a morning rewrite swapped
# slot 1's topic after the images were made, and the mismatch published.
# Create-if-absent first: on 2026-08-10 the images arrived hours after 06:30,
# no generate branch ever locked the day, and a midday rewrite went unhealed.
# Locking at first publish attempt freezes whatever is about to be published.
cmd /c "npm.cmd run day-lock -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$lockExit = $LASTEXITCODE
cmd /c "npm.cmd run day-lock -- --date $date --heal 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$healExit = $LASTEXITCODE
cmd /c "npm.cmd run heal-reel-slot -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
$reelHealExit = $LASTEXITCODE
Pop-Location
# A failed heal means the calendar may still be clobbered; publishing an
# unrepaired package is worse than publishing late (luna, high).
if ($lockExit -ne 0 -or $healExit -ne 0 -or $reelHealExit -ne 0) {
    $script:pipelineLastError = "Lock/heal step failed (lock=$lockExit heal=$healExit reel=$reelHealExit)"
    Write-Log "Lock/heal step failed (lock=$lockExit heal=$healExit reel=$reelHealExit); refusing to publish."
    Show-Toast "$date 自癒步驟失敗,補發已停止,請看 output\catch-up-logs\$date.log"
    exit 1
}

$approvedPath = Join-Path $root "data\approved-log\$date.json"
# Late-images day: when the package became complete only after the 11:15
# approve retry, no scheduled run ever re-judges it and the whole day used to
# publish nothing (both review families flagged this; it happened on 08-10).
# auto-approve is idempotent and every gate still applies -- this only moves
# WHEN the judgment happens, never what it decides.
# A partial approval used to be permanent. The condition below was "no approval
# log at all", so the moment ONE slot was approved the day stopped being
# re-judged -- and a slot blocked at 10:20 for a fixable reason stayed blocked
# until a human deleted the log. That failure mode got much more likely once
# approval started demanding image evidence per slot, so re-judge whenever any
# calendar slot is still missing its approval, not only when none has one.
$needsJudging = $true
if (Test-Path $approvedPath) {
    try {
        $calendarPath = Join-Path $root "data\content-calendar\$date.json"
        $calendarSlots = ([IO.File]::ReadAllText($calendarPath, [Text.UTF8Encoding]::new($false)) |
            ConvertFrom-Json).slots | ForEach-Object { $_.slot }
        $approvedSlots = ([IO.File]::ReadAllText($approvedPath, [Text.UTF8Encoding]::new($false)) |
            ConvertFrom-Json) | ForEach-Object { $_.slot } | Sort-Object -Unique
        $needsJudging = @($calendarSlots | Where-Object { $approvedSlots -notcontains $_ }).Count -gt 0
    } catch {
        # Unreadable either file: re-judging is the safe direction, since
        # auto-approve applies every gate and approves nothing it should not.
        $needsJudging = $true
    }
}
if ($needsJudging) {
    Write-Log "One or more slots for $date are still unapproved; running auto-approve now (gates unchanged)."
    Push-Location $root
    cmd /c "npm.cmd run auto-approve -- --date $date --no-fail 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}
# The changed-URL notification must remain observable even if the morning
# generation did not run. This scheduled script runs several times a day, but
# it never re-sends an unchanged sitemap: indexing-push records a semantic
# sitemap fingerprint and decides whether there is anything to notify.
#
# This runs many times a day, so it is the natural place to notice. It only
# records the decision and audits; it publishes nothing.
$indexingRecord = Join-Path $root "output\operations\indexing-push-$date.json"
if (-not (Test-Path $indexingRecord)) {
    Write-Log "No indexing record for $date; recording the changed-URL IndexNow decision and audit now."
    Push-Location $root
    cmd /c "npm.cmd run indexing-push -- --date $date 2>&1" | Out-File -FilePath $logFile -Append -Encoding utf8
    Pop-Location
}

# Local images exist but the public copies are not live. Publishing verifies the
# public URL, so this 404s every attempt and the day stalls with nothing to fix
# it -- 2026-08-15: the site was pushed at 06:30:02 and the images landed at
# 06:50, so every publish from 11:30 onward failed on an asset that was sitting
# right there on disk. The push and the images had simply happened in the wrong
# order, and nothing downstream re-pushed.
#
# Checked against the hero image of the first approved slot: if the file is here
# and the web says 404, the site is stale, so push it again.
$heroLocal = Join-Path $root "docs\assets\$date\slot-01.png"
$script:publicSiteRepushFailed = $false
if (Test-Path $heroLocal) {
    # Read the host from .env rather than hardcoding it. The site moved to the
    # custom domain and this check kept asking github.io, which now answers 301
    # -- not 200 -- so it judged the site stale on every single run and did a
    # full regenerate + mirror clone before every publish. On 2026-08-26 that
    # ran long enough for the 11:30 task to hit its two-hour limit and be
    # terminated before it ever reached Instagram: FB was covered by the Meta
    # queue, IG lost slot 1 and slot 3 for the day.
    $heroHost = "https://sixiangjialaundry.com"
    $envPath = Join-Path $root ".env"
    if (Test-Path $envPath) {
        $envLine = Get-Content $envPath | Where-Object { $_ -match '^PUBLIC_IMAGE_BASE_URL=' } | Select-Object -First 1
        if ($envLine) {
            $envValue = ($envLine -split '=', 2)[1].Trim().TrimEnd('/')
            if ($envValue) { $heroHost = $envValue }
        }
    }
    $heroUrl = "$heroHost/assets/$date/slot-01.png"
    # curl.exe, not Invoke-WebRequest. Under Task Scheduler PowerShell runs
    # NonInteractive, where Invoke-WebRequest throws "Read and Prompt
    # functionality is not available" before it ever reaches the network --
    # every check would fail, every run would decide the site was stale, and it
    # would re-push six times a day forever. Verified on this box: curl returns
    # 200 on the same URL that makes Invoke-WebRequest throw.
    # -L so a host that answers with a redirect is judged on where it lands.
    $heroOutput = & curl.exe -s -S -L -o NUL -w "%{http_code}" --max-time 20 $heroUrl 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "curl hero check failed (exit $LASTEXITCODE): $heroOutput"
        $heroLive = $true
    } else {
        $heroCode = [string]$heroOutput
        $heroLive = ($heroCode -eq "200")
    }
    if (-not $heroLive) {
        Write-Log "Local images exist for $date but $heroUrl is not live; re-publishing the site."
        Push-Location $root
        $siteOutput = cmd /c "npm.cmd run generate-public-site 2>&1"
        $siteExit = $LASTEXITCODE
        $siteOutput | Out-File -FilePath $logFile -Append -Encoding utf8
        if ($siteExit -ne 0) {
            $script:pipelineLastError = Get-PublishLastError $siteOutput "generate-public-site failed (exit $siteExit)"
            Write-Log "generate-public-site failed (exit $siteExit); refusing to continue."
            Pop-Location
            Show-Toast "$date 的公開站沒推上去(generate-public-site 失敗),請看 output\catch-up-logs\$date.log"
            $script:publicSiteRepushFailed = $true
        } else {
            $script:publishPagesAttempted = $true
            $pagesOutput = cmd /c "npm.cmd run publish-pages -- --date $date --skip-audit 2>&1"
            $pagesExit = $LASTEXITCODE
            $script:publishPagesSucceeded = ($pagesExit -eq 0)
            $pagesOutput | Out-File -FilePath $logFile -Append -Encoding utf8
            if ($pagesExit -ne 0) {
                $script:pipelineLastError = Get-PublishLastError $pagesOutput "publish-pages failed (exit $pagesExit)"
                Write-Log "publish-pages failed (exit $pagesExit); refusing to continue."
                Pop-Location
                Show-Toast "$date 的公開站沒推上去(publish-pages 失敗),請看 output\catch-up-logs\$date.log"
                $script:publicSiteRepushFailed = $true
            } else {
                Pop-Location
            }
        }
    }
}

if ($script:publicSiteRepushFailed) {
    Write-Log "Public-site refresh failed; no post-current-slot will run; exiting 2."
    exit 2
}

if (-not (Test-Path $approvedPath)) {
    Write-Log "No approved-log for $date. Nothing can be published yet."
    Show-Toast "今天 ($date) 還沒有審核紀錄,請執行 Codex 審核流程,否則今天不會發文。"
    exit 0
}

# A slot recovers only within a few hours of its own time. Past that the evening
# run would fire both slots minutes apart, which reaches fewer people than one
# well-placed post and reads as automated. A stale slot is reported, not posted.
$recoveryWindow = [TimeSpan]::FromHours(4)
$calendarSlots = Get-CalendarSlots -Root $root -Date $date
if ($null -eq $calendarSlots) {
    Write-Log "Calendar unreadable; falling back to slots 1, 2, 3."
    $calendarSlots = [int[]]@(1, 2, 3)
}
$slotTimeWarning = $null
$slotTimes = Get-SlotTimes -Root $root -Date $date -WarningMessage ([ref]$slotTimeWarning)
if ($slotTimeWarning) { Write-Log ([string]$slotTimeWarning) }
$slotWindows = Get-CatchupSlotWindows -NowTime $now.TimeOfDay -SlotTimes $slotTimes -CalendarSlots $calendarSlots -RecoveryWindow $recoveryWindow
$dueSlots = @($slotWindows.DueSlots)
$staleSlots = @($slotWindows.StaleSlots)
$missingRequiredCalendarSlots = @(Get-MissingRequiredCalendarSlots -CalendarSlots $calendarSlots)
if ($env:CATCHUP_PUBLISH_PLAN_ONLY -eq "true") {
    [pscustomobject]@{ date = $date; due_slots = @($dueSlots); stale_slots = @($staleSlots) } | ConvertTo-Json -Compress
    exit 0
}

if ($staleSlots.Count -gt 0) {
    $stale = $staleSlots -join ", "
    Write-Log "Slot $stale is past its $($recoveryWindow.TotalHours)h recovery window; not publishing it late."
}

if ($dueSlots.Count -eq 0) {
    if ($staleSlots.Count -gt 0) {
        $unposted = @()
        $postedPath = Join-Path $root "data\posted-log\$date.json"
        $postedSlots = @()
        if (Test-Path $postedPath) {
            $postedParsed = Get-Content $postedPath -Raw -Encoding utf8 | ConvertFrom-Json
            # Matches hasRecordedPost in src/logging.ts, which accepts either
            # status string; checking only "success" here reported a "posted"
            # slot as missed.
            $postedSlots = @(@($postedParsed) | Where-Object { @("success", "posted") -contains $_.status -and -not $_.dry_run } | ForEach-Object { $_.slot })
        }
        $unposted = @($staleSlots | Where-Object { $postedSlots -notcontains $_ })
        if ($unposted.Count -gt 0) {
            Show-Toast ("今天 slot {0} 已超過補發時限,不會補發以免和下一篇擠在一起。" -f ($unposted -join ", "))
        }
    } else {
        Write-Log "No slot is due yet."
    }
    if ($missingRequiredCalendarSlots.Count -gt 0) {
        Write-Log ("Calendar missing required slot(s): {0}; refusing to publish with an incomplete calendar." -f ($missingRequiredCalendarSlots -join ","))
        Show-Toast ("今天行事曆缺少必備 slot {0},補發已停止,請先修復行事曆。" -f ($missingRequiredCalendarSlots -join ","))
    }
    if ($now.TimeOfDay -ge [TimeSpan]"20:30") {
        Write-Log "No publish slot is due; running evening closeout steps."
        Invoke-CatchupEveningSteps
        Write-Log "Catch-up evening closeout finished."
    }
    if ($missingRequiredCalendarSlots.Count -gt 0) { exit 1 }
    exit 0
}

if ($missingRequiredCalendarSlots.Count -gt 0) {
    Write-Log ("Calendar missing required slot(s): {0}; refusing to publish with an incomplete calendar." -f ($missingRequiredCalendarSlots -join ","))
    Show-Toast ("今天行事曆缺少必備 slot {0},補發已停止,請先修復行事曆。" -f ($missingRequiredCalendarSlots -join ","))
    exit 1
}

$failed = @()
foreach ($slot in $dueSlots) {
    # Slot 3 is optional on older 2-slot calendars. Missing ≠ failed: log once
    # and continue so catch-up still publishes slots 1/2 without a toast or
    # non-zero exit. post-current-slot also skips absent slot 3; this check
    # avoids a wasted npm invocation and keeps the log wording explicit.
    if ($slot -eq 3) {
        $calendarPath = Join-Path $root "data\content-calendar\$date.json"
        $hasSlot3 = $false
        if (Test-Path $calendarPath) {
            try {
                $calendarParsed = Get-Content $calendarPath -Raw -Encoding utf8 | ConvertFrom-Json
                $hasSlot3 = @(@($calendarParsed.slots) | Where-Object { $_.slot -eq 3 }).Count -gt 0
            } catch {
                Write-Log ("Could not read content calendar for slot-3 presence: " + $_.Exception.Message)
            }
        }
        if (-not $hasSlot3) {
            Write-Log "Slot 3 absent on calendar for $date; skipping (not a failure)."
            continue
        }
    }

    Write-Log "Running post-current-slot --slot $slot"
    Push-Location $root
    # Explicit --date: PowerShell resolves Taipei but Node falls back to its
    # own TIMEZONE env; around midnight the two can disagree and publish
    # yesterday's slot into today's logs (luna, high).
    $output = cmd /c "npm.cmd run post-current-slot -- --slot $slot --date $date 2>&1"
    $exitCode = $LASTEXITCODE
    Pop-Location
    $output | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($exitCode -ne 0) { $script:pipelineLastError = Get-PublishLastError $output "post-current-slot failed (exit $exitCode)" }
    # Fail-closed: a reel / noon slot 3 must never count a cover-image success
    # as published. That is the 8/27-29 failure mode.
    $requiresVideo = ($slot -eq 3)
    try {
        $calendarPath = Join-Path $root "data\content-calendar\$date.json"
        if (Test-Path $calendarPath) {
            $cal = ([IO.File]::ReadAllText($calendarPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json)
            $calSlot = @($cal.slots) | Where-Object { $_.slot -eq $slot } | Select-Object -First 1
            if ($null -ne $calSlot) {
                $requiresVideo = ($calSlot.media_type -eq "reel") -or ($slot -eq 3)
            }
        }
    } catch {
        Write-Log ("Could not read calendar media_type for slot $slot : " + $_.Exception.Message)
    }
    $reelImageFallback = $false
    if ($requiresVideo) {
        try {
            $postedPath = Join-Path $root "data\posted-log\$date.json"
            if (Test-Path $postedPath) {
                $postedRaw = [IO.File]::ReadAllText($postedPath, [Text.UTF8Encoding]::new($false))
                $entries = @(ConvertFrom-Json $postedRaw)
                $reelImageFallback = @($entries | Where-Object {
                    $_.slot -eq $slot -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) -and
                    $_.published_media_type -eq "image"
                }).Count -gt 0
            }
        } catch {
            Write-Log ("Reel image-fallback log check failed: " + $_.Exception.Message)
        }
    }
    if ($reelImageFallback) {
        Write-Log "Slot $slot is a reel but posted-log recorded IMAGE success; refusing to treat as published."
        $failed += $slot
        continue
    }
    if ($exitCode -ne 0) {
        # The exit code alone is not evidence: on 2026-08-08 the process was
        # terminated (-1) after both platforms had already recorded success,
        # the slot was misjudged as failed, and first comments were skipped.
        # The posted-log is the ground truth, so consult it before declaring
        # failure.
        $postedOk = $false
        try {
            $postedRaw = [IO.File]::ReadAllText((Join-Path $root "data\posted-log\$date.json"), [Text.UTF8Encoding]::new($false))
            $entries = @(ConvertFrom-Json $postedRaw)
            $igOk = @($entries | Where-Object { $_.slot -eq $slot -and $_.platform -eq "instagram" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
            $fbOk = @($entries | Where-Object { $_.slot -eq $slot -and $_.platform -eq "facebook" -and -not $_.dry_run -and (@("success", "posted") -contains $_.status) }).Count -gt 0
            $postedOk = $igOk -and $fbOk
        } catch {}
        if ($postedOk) {
            Write-Log "Slot $slot exited $exitCode but the posted-log records success on both platforms; treating as published."
        } else {
            Write-Log "Slot $slot failed with exit code $exitCode."
            $failed += $slot
        }
    } else {
        Write-Log "Slot $slot finished (published or already recorded)."
    }
}

Invoke-CatchupSocialFollowup

if ($failed.Count -gt 0) {
    Show-Toast ("今天 slot {0} 補發失敗,請看 output\catch-up-logs\{1}.log" -f ($failed -join ", "), $date)
    exit 1
}

Invoke-CatchupEveningCloseout

Write-Log "Catch-up run finished."
} finally {
    if ($null -ne $pipelineMutex) {
        try {
            Invoke-CatchupPublishAlerts
        } catch {
            Write-Log ('Publish alert handling failed: ' + $_.Exception.Message)
            Show-Toast "$date 發布告警處理失敗，請看 output/catch-up-logs/$date.log"
        } finally { Exit-PipelineMutex -Mutex $pipelineMutex }
    }
}
