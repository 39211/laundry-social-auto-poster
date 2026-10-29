$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$library = Join-Path $root 'scripts\_pipeline-lock.ps1'
if (-not (Test-Path -LiteralPath $library)) {
    Write-Output 'CASE_FAIL name=pipeline-mutex-library reason=missing _pipeline-lock.ps1'
    Write-Output 'SMOKE_FAIL'
    exit 1
}
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('a7-pipeline-' + [guid]::NewGuid().ToString('n'))
$script:failed = $false
$script:children = @()
$utf8 = [Text.UTF8Encoding]::new($true)
function Write-Fixture([string]$Path, [string]$Text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [IO.File]::WriteAllText($Path, $Text, $utf8)
}
function Read-Fixture([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return [IO.File]::ReadAllText($Path) }
    return ''
}
function Assert-Case([string]$Name, [bool]$Ok, [string]$Evidence = '') {
    if ($Ok) { Write-Output "CASE_OK name=$Name $Evidence" }
    else { Write-Output "CASE_FAIL name=$Name $Evidence"; $script:failed = $true }
}
function Start-Child([string]$Code) {
    $id = [guid]::NewGuid().ToString('n')
    $path = Join-Path $fixture "$id.ps1"
    Write-Fixture $path $Code
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $path + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $script:children += $process
    return $process
}
function Wait-Probe([string]$Path) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath $Path)) {
        if ($timer.Elapsed.TotalSeconds -gt 12) { throw "Fixture did not reach $Path" }
        Start-Sleep -Milliseconds 50
    }
}
function Finish-Child($Process) {
    if (-not $Process.WaitForExit(15000)) { throw 'Fixture child timed out' }
    $stdout = $Process.StandardOutput.ReadToEnd()
    $stderr = $Process.StandardError.ReadToEnd()
    return [pscustomobject]@{ Code = $Process.ExitCode; Text = $stdout + $stderr }
}
try {
    [void][IO.Directory]::CreateDirectory($fixture)
    $mutexName = 'a7-smoke-' + [guid]::NewGuid().ToString('n')
    $ready = Join-Path $fixture 'holder.ready'
    $release = Join-Path $fixture 'holder.release'
    $waiting = Join-Path $fixture 'waiter.waiting'
    $acquired = Join-Path $fixture 'waiter.acquired'
    $holder = Start-Child @"
. '$library'
`$mutex = Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 5
try {
    [IO.File]::WriteAllText('$ready', 'ready')
    `$timer = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-Path -LiteralPath '$release')) {
        if (`$timer.Elapsed.TotalSeconds -gt 15) { throw 'holder release missing' }
        Start-Sleep -Milliseconds 50
    }
} finally { Exit-PipelineMutex -Mutex `$mutex }
"@
    Wait-Probe $ready
    $waiter = Start-Child @"
. '$library'
[IO.File]::WriteAllText('$waiting', 'waiting')
`$mutex = Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 10
try { [IO.File]::WriteAllText('$acquired', 'acquired') }
finally { Exit-PipelineMutex -Mutex `$mutex }
"@
    Wait-Probe $waiting
    Start-Sleep -Milliseconds 300
    Assert-Case 'second-process-waits-for-mutex' (-not (Test-Path -LiteralPath $acquired) -and -not $waiter.HasExited)
    $timed = Start-Child @"
. '$library'
Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 1 | Out-Null
throw 'timeout must exit before work'
"@
    $timeoutResult = Finish-Child $timed
    Assert-Case 'timeout-exits-75-and-logs' ($timeoutResult.Code -eq 75 -and $timeoutResult.Text -match 'timeout|timed out') ("exit=" + $timeoutResult.Code)
    [IO.File]::WriteAllText($release, 'release')
    $holderResult = Finish-Child $holder
    $waiterResult = Finish-Child $waiter
    Assert-Case 'waiter-enters-after-release' ($holderResult.Code -eq 0 -and $waiterResult.Code -eq 0 -and (Test-Path -LiteralPath $acquired))
    $exceptionProbe = Start-Child @"
. '$library'
`$mutex = Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 1
try { throw 'expected fixture failure' } catch {} finally { Exit-PipelineMutex -Mutex `$mutex }
`$next = Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 1
Exit-PipelineMutex -Mutex `$next
"@
    Assert-Case 'finally-releases-after-exception' ((Finish-Child $exceptionProbe).Code -eq 0)
    $keptHandle = [Threading.Mutex]::new($false, ('Global\' + $mutexName))
    try {
        $abandoned = Start-Child @"
. '$library'
Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 1 | Out-Null
[Environment]::Exit(0)
"@
        [void](Finish-Child $abandoned)
        $recover = Start-Child @"
. '$library'
`$mutex = Enter-PipelineMutex -Name '$mutexName' -TimeoutSec 1
Exit-PipelineMutex -Mutex `$mutex
"@
        $recovered = Finish-Child $recover
        Assert-Case 'abandoned-mutex-recovered' ($recovered.Code -eq 0 -and $recovered.Text -match 'abandoned')
    } finally { $keptHandle.Dispose() }

    # Execute the real catch-up body with only OS/network boundaries stubbed.
    # A unique mutex name keeps the fixture away from the production namespace.
    $caseRoot = Join-Path $fixture 'catchup'
    $scripts = Join-Path $caseRoot 'scripts'
    foreach ($file in @('catchup-publish.ps1', '_pipeline-lock.ps1', 'publish-slot-times.ps1')) {
        $text = [IO.File]::ReadAllText((Join-Path $root "scripts\$file"))
        $text = $text.Replace("-Name 'sxj-publish'", "-Name '$mutexName'")
        Write-Fixture (Join-Path $scripts $file) $text
    }
    Write-Fixture (Join-Path $scripts '_watchdog.ps1') '# fixture: no scheduler access'
    $date = '2026-10-29'
    Write-Fixture (Join-Path $caseRoot "data\content-calendar\$date.json") '{"slots":[{"slot":1},{"slot":2}]}'
    Write-Fixture (Join-Path $caseRoot "data\approved-log\$date.json") '[{"slot":1},{"slot":2}]'
    Write-Fixture (Join-Path $caseRoot "output\operations\indexing-push-$date.json") '{}'
    Write-Fixture (Join-Path $caseRoot "docs\assets\$date\slot-01.png") 'fixture, never uploaded'
    $fakeStaff = @'
import json
from pathlib import Path
def group_id(): return 'fixture-group'
def _post_to_group(gid, text, retry_key=''):
    assert gid == 'fixture-group'
    with (Path(__file__).parent.parent / 'line-sends.jsonl').open('a', encoding='utf-8') as f:
        f.write(json.dumps({'text': text, 'key': retry_key}, ensure_ascii=False) + '\n')
    return True, ''
'@
    Write-Fixture (Join-Path $caseRoot 'line-bot\staff_notify.py') $fakeStaff
    $commands = Join-Path $caseRoot 'commands.log'
    $toast = Join-Path $caseRoot 'toasts.log'
    $wrapper = @"
`$env:CATCHUP_PUBLISH_ROOT = '$caseRoot'
`$env:CATCHUP_PUBLISH_DATE = '$date'
`$env:CATCHUP_PUBLISH_TIME = '16:40'
`$env:CATCHUP_PUBLISH_TOAST_FILE = '$toast'
`$env:CATCHUP_PUBLISH_PLAN_ONLY = 'false'
`$global:a7PagesCode = 1
`$global:a7SiteCode = 0
function cmd {
    param(`$c, `$command)
    Add-Content -LiteralPath '$commands' -Value `$command
    if (`$command -match 'generate-public-site' -and `$global:a7SiteCode -ne 0) { `$global:LASTEXITCODE = `$global:a7SiteCode; return 'Error: fixture generation failed' }
    if (`$command -match 'publish-pages') { `$global:LASTEXITCODE = `$global:a7PagesCode; return 'fatal: index.lock File exists' }
    `$global:LASTEXITCODE = 0
    return 'fixture success'
}
function curl.exe { `$global:LASTEXITCODE = 0; return '404' }
& '$scripts\catchup-publish.ps1'
exit `$LASTEXITCODE
"@
    $run1 = Finish-Child (Start-Child $wrapper)
    $alertsPath = Join-Path $caseRoot "data\publish-alerts\$date.json"
    $alert1 = Read-Fixture $alertsPath
    Assert-Case 'expired-window-alert-sends-once' ((@(Get-Content -LiteralPath (Join-Path $caseRoot 'line-sends.jsonl') -ErrorAction SilentlyContinue)).Count -eq 1 -and $alert1 -match 'index.lock') ("exit=" + $run1.Code)
    $run2 = Finish-Child (Start-Child $wrapper)
    Assert-Case 'same-day-same-reason-deduplicated' ((@(Get-Content -LiteralPath (Join-Path $caseRoot 'line-sends.jsonl') -ErrorAction SilentlyContinue)).Count -eq 1)
    Assert-Case 'site-failure-blocks-posting-and-returns-nonzero' ($run1.Code -ne 0 -and $run2.Code -ne 0 -and (Read-Fixture $commands) -notmatch 'post-current-slot')
    $alertState = (Read-Fixture $alertsPath) | ConvertFrom-Json
    Assert-Case 'consecutive-publish-pages-failures-persist' ($alertState.publish_pages_consecutive_failures -eq 2)

    # A fresh fixture before expiry verifies the independent two-round trigger.
    $retryRoot = Join-Path $fixture 'two-rounds'
    Copy-Item -LiteralPath $caseRoot -Destination $retryRoot -Recurse
    foreach ($name in @('line-sends.jsonl', "data\publish-alerts\$date.json", 'commands.log', 'toasts.log')) {
        Remove-Item -LiteralPath (Join-Path $retryRoot $name) -ErrorAction SilentlyContinue
    }
    $retryWrapper = $wrapper.Replace($caseRoot, $retryRoot).Replace("'16:40'", "'11:35'")
    [void](Finish-Child (Start-Child $retryWrapper))
    Assert-Case 'first-pages-failure-before-expiry-does-not-alert' (-not (Test-Path -LiteralPath (Join-Path $retryRoot 'line-sends.jsonl')))
    [void](Finish-Child (Start-Child $retryWrapper))
    Assert-Case 'second-pages-failure-before-expiry-alerts' ((@(Get-Content -LiteralPath (Join-Path $retryRoot 'line-sends.jsonl') -ErrorAction SilentlyContinue)).Count -eq 1)
    Assert-Case 'failed-pages-never-post-within-recovery-window' ((Read-Fixture (Join-Path $retryRoot 'commands.log')) -notmatch 'post-current-slot')
    $successWrapper = $retryWrapper.Replace('a7PagesCode = 1', 'a7PagesCode = 0')
    [void](Finish-Child (Start-Child $successWrapper))
    $resetState = (Read-Fixture (Join-Path $retryRoot "data\publish-alerts\$date.json")) | ConvertFrom-Json
    Assert-Case 'successful-pages-resets-failure-streak' ($resetState.publish_pages_consecutive_failures -eq 0)

    function New-CatchupFixture([string]$Name, [string]$Time = '16:40') {
        $nextRoot = Join-Path $fixture $Name
        Copy-Item -LiteralPath $caseRoot -Destination $nextRoot -Recurse
        foreach ($name in @('line-sends.jsonl', "data\publish-alerts\$date.json", 'commands.log', 'toasts.log')) {
            Remove-Item -LiteralPath (Join-Path $nextRoot $name) -ErrorAction SilentlyContinue
        }
        return [pscustomobject]@{
            Root = $nextRoot
            Code = $wrapper.Replace($caseRoot, $nextRoot).Replace("'16:40'", "'$Time'").Replace('a7PagesCode = 1', 'a7PagesCode = 0')
        }
    }
    $before = New-CatchupFixture 'before-expiry' '15:29'
    [void](Finish-Child (Start-Child $before.Code))
    Assert-Case 'four-hour-window-not-closed-early' (-not (Test-Path -LiteralPath (Join-Path $before.Root 'line-sends.jsonl')))
    $boundary = New-CatchupFixture 'at-expiry' '15:30'
    [void](Finish-Child (Start-Child $boundary.Code))
    Assert-Case 'four-hour-boundary-alerts-without-success-log' ((Read-Fixture (Join-Path $boundary.Root 'line-sends.jsonl')) -match 'slot 1')
    $partial = New-CatchupFixture 'partial-dry-run'
    Write-Fixture (Join-Path $partial.Root "data\posted-log\$date.json") '[{"slot":1,"platform":"facebook","status":"posted"},{"slot":1,"platform":"instagram","status":"success","dry_run":true}]'
    [void](Finish-Child (Start-Child $partial.Code))
    Assert-Case 'fb-only-and-dry-run-ig-do-not-silence-alert' ((Read-Fixture (Join-Path $partial.Root 'line-sends.jsonl')) -match 'slot 1')
    $complete = New-CatchupFixture 'both-platforms-posted'
    Write-Fixture (Join-Path $complete.Root "data\posted-log\$date.json") '[{"slot":1,"platform":"facebook","status":"posted"},{"slot":1,"platform":"instagram","status":"success"}]'
    [void](Finish-Child (Start-Child $complete.Code))
    Assert-Case 'both-platforms-live-silence-expiry-alert' (-not (Test-Path -LiteralPath (Join-Path $complete.Root 'line-sends.jsonl'))) (Read-Fixture (Join-Path $complete.Root 'line-sends.jsonl'))
    $custom = New-CatchupFixture 'assigned-time'
    Write-Fixture (Join-Path $custom.Root "data\publish-times\$date.json") ('{"date":"' + $date + '","slots":[{"slot":1,"time":"14:12"}]}')
    [void](Finish-Child (Start-Child $custom.Code))
    Assert-Case 'alert-respects-assigned-publish-time' (-not (Test-Path -LiteralPath (Join-Path $custom.Root 'line-sends.jsonl')))
    $fallback = New-CatchupFixture 'staff-module-missing'
    Remove-Item -LiteralPath (Join-Path $fallback.Root 'line-bot\staff_notify.py')
    [void](Finish-Child (Start-Child $fallback.Code))
    [void](Finish-Child (Start-Child $fallback.Code))
    $fallbackState = (Read-Fixture (Join-Path $fallback.Root "data\publish-alerts\$date.json")) | ConvertFrom-Json
    Assert-Case 'missing-staff-module-persists-and-toasts-once' ($fallbackState.reasons[0].delivery -eq 'toast-fallback' -and [regex]::Matches((Read-Fixture (Join-Path $fallback.Root 'toasts.log')), 'TOAST\|\[發布異常\]').Count -eq 1)
    $generation = New-CatchupFixture 'generation-fails' '11:35'
    $generationResult = Finish-Child (Start-Child ($generation.Code.Replace('a7SiteCode = 0', 'a7SiteCode = 1')))
    Assert-Case 'generation-failure-blocks-pages-and-post' ($generationResult.Code -eq 2 -and (Read-Fixture (Join-Path $generation.Root 'commands.log')) -notmatch 'publish-pages|post-current-slot')
    $noApproval = New-CatchupFixture 'no-approval'
    Remove-Item -LiteralPath (Join-Path $noApproval.Root "data\approved-log\$date.json")
    [void](Finish-Child (Start-Child $noApproval.Code))
    Assert-Case 'early-no-approval-exit-still-checks-alerts' ((Read-Fixture (Join-Path $noApproval.Root 'line-sends.jsonl')) -match 'slot 1')
    $midnight = New-CatchupFixture 'midnight' '00:29'
    Write-Fixture (Join-Path $midnight.Root "data\posted-log\$date.json") '[{"slot":1,"platform":"facebook","status":"success"},{"slot":1,"platform":"instagram","status":"success"}]'
    $midnightCode = $midnight.Code.Replace("CATCHUP_PUBLISH_DATE = '$date'", "CATCHUP_PUBLISH_DATE = '2026-10-30'")
    [void](Finish-Child (Start-Child $midnightCode))
    Assert-Case 'evening-window-stays-open-until-next-day-0030' (-not (Test-Path -LiteralPath (Join-Path $midnight.Root 'line-sends.jsonl'))) (Read-Fixture (Join-Path $midnight.Root 'line-sends.jsonl'))
    [void](Finish-Child (Start-Child ($midnightCode.Replace("'00:29'", "'00:30'"))))
    Assert-Case 'previous-day-evening-expiry-alerts-at-0030' ((Read-Fixture (Join-Path $midnight.Root 'line-sends.jsonl')) -match '2026-10-29 slot 2') (Read-Fixture (Join-Path $midnight.Root 'line-sends.jsonl'))

    $crossDay = New-CatchupFixture 'failure-streak-crosses-midnight' '23:55'
    Write-Fixture (Join-Path $crossDay.Root "data\posted-log\$date.json") '[{"slot":1,"platform":"facebook","status":"success"},{"slot":1,"platform":"instagram","status":"success"}]'
    $crossCode = $crossDay.Code.Replace('a7PagesCode = 0', 'a7PagesCode = 1')
    [void](Finish-Child (Start-Child $crossCode))
    $tomorrow = '2026-10-30'
    Write-Fixture (Join-Path $crossDay.Root "data\content-calendar\$tomorrow.json") '{"slots":[{"slot":1},{"slot":2}]}'
    Write-Fixture (Join-Path $crossDay.Root "data\approved-log\$tomorrow.json") '[{"slot":1},{"slot":2}]'
    Write-Fixture (Join-Path $crossDay.Root "output\operations\indexing-push-$tomorrow.json") '{}'
    Write-Fixture (Join-Path $crossDay.Root "docs\assets\$tomorrow\slot-01.png") 'fixture, never uploaded'
    [void](Finish-Child (Start-Child ($crossCode.Replace("CATCHUP_PUBLISH_DATE = '$date'", "CATCHUP_PUBLISH_DATE = '$tomorrow'").Replace("'23:55'", "'00:05'"))))
    $crossState = (Read-Fixture (Join-Path $crossDay.Root "data\publish-alerts\$tomorrow.json")) | ConvertFrom-Json
    Assert-Case 'second-failure-across-midnight-alerts' ($crossState.publish_pages_consecutive_failures -eq 2 -and (Read-Fixture (Join-Path $crossDay.Root 'line-sends.jsonl')) -match '2026-10-30')
    $gap = New-CatchupFixture 'failure-streak-after-offline-day' '11:35'
    Write-Fixture (Join-Path $gap.Root 'data\publish-alerts\2026-10-27.json') '{"date":"2026-10-27","publish_pages_consecutive_failures":1,"last_error":"fatal: index.lock File exists","reasons":[]}'
    [void](Finish-Child (Start-Child ($gap.Code.Replace('a7PagesCode = 0', 'a7PagesCode = 1'))))
    $gapState = (Read-Fixture (Join-Path $gap.Root "data\publish-alerts\$date.json")) | ConvertFrom-Json
    Assert-Case 'offline-day-does-not-reset-failure-streak' ($gapState.publish_pages_consecutive_failures -eq 2 -and (Read-Fixture (Join-Path $gap.Root 'line-sends.jsonl')) -match '2026-10-29')
    $lastSuccess = New-CatchupFixture 'latest-success-resets-prior-failures' '11:35'
    Write-Fixture (Join-Path $lastSuccess.Root 'data\publish-alerts\2026-10-27.json') '{"date":"2026-10-27","publish_pages_consecutive_failures":3,"last_error":"fatal: index.lock File exists","reasons":[]}'
    Write-Fixture (Join-Path $lastSuccess.Root 'data\publish-alerts\2026-10-28.json') '{"date":"2026-10-28","publish_pages_consecutive_failures":0,"last_error":"","reasons":[]}'
    [void](Finish-Child (Start-Child ($lastSuccess.Code.Replace('a7PagesCode = 0', 'a7PagesCode = 1'))))
    $lastSuccessState = (Read-Fixture (Join-Path $lastSuccess.Root "data\publish-alerts\$date.json")) | ConvertFrom-Json
    Assert-Case 'latest-success-state-resets-older-failures' ($lastSuccessState.publish_pages_consecutive_failures -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $lastSuccess.Root 'line-sends.jsonl')))

    # Daily generation has an indirect site writer (image backfill); exercise its
    # ready-calendar branch under the same mutex, with no Codex or scheduler.
    $dailyRoot = Join-Path $fixture 'daily'
    $dailyScript = Join-Path $dailyRoot 'scripts\daily-generate.ps1'
    Write-Fixture $dailyScript (([IO.File]::ReadAllText((Join-Path $root 'scripts\daily-generate.ps1'))).Replace("-Name 'sxj-publish'", "-Name '$mutexName'"))
    Write-Fixture (Join-Path $dailyRoot 'scripts\_pipeline-lock.ps1') ([IO.File]::ReadAllText($library))
    Write-Fixture (Join-Path $dailyRoot 'scripts\generate-missing-images.ps1') '# fixture QA only'
    Write-Fixture (Join-Path $dailyRoot "data\content-calendar\$date.json") '{"slots":[{"slot":1},{"slot":2}]}'
    Write-Fixture (Join-Path $dailyRoot 'node_modules\.bin\tsx.cmd') "@echo off`r`nexit /b 0`r`n"
    $dailyTrace = Join-Path $dailyRoot 'commands.log'
    $dailyWrapper = @"
function Get-ScheduledTask { return @() }
function cmd {
    param(`$c, `$command)
    Add-Content -LiteralPath '$dailyTrace' -Value `$command
    if (`$command -match 'generate-public-site') { `$global:LASTEXITCODE = 1; return 'Error: fixture generation failed' }
    `$global:LASTEXITCODE = 0
}
& '$dailyScript' -Date '$date'
exit `$LASTEXITCODE
"@
    . $library
    $dailyMutex = Enter-PipelineMutex -Name $mutexName -TimeoutSec 1
    try {
        $dailyChild = Start-Child $dailyWrapper
        Start-Sleep -Milliseconds 800
        Assert-Case 'daily-waits-before-any-git-or-site-work' (-not (Test-Path -LiteralPath $dailyTrace) -and -not $dailyChild.HasExited)
    } finally { Exit-PipelineMutex -Mutex $dailyMutex }
    $dailyResult = Finish-Child $dailyChild
    Assert-Case 'daily-generation-failure-does-not-push' ($dailyResult.Code -eq 1 -and (Read-Fixture $dailyTrace) -match 'generate-public-site' -and (Read-Fixture $dailyTrace) -notmatch 'publish-pages')
} finally {
    foreach ($child in $script:children) {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
if ($script:failed) { Write-Output 'SMOKE_FAIL'; exit 1 }
Write-Output 'SMOKE_OK pipeline-lock'
