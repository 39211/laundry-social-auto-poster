[CmdletBinding()]
param([switch]$MutateDateGuard, [switch]$MutateWeekRegex, [switch]$MutateFirstCommentGuard, [switch]$UseAtomicReplaceShim)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'scripts\backfill-publish.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('a9-backfill-' + [guid]::NewGuid().ToString('n'))
$script:failures = 0
$script:cases = 0
$script:blocked = 0
$utf8 = [Text.UTF8Encoding]::new($false)

function Write-Fixture([string]$Path, [string]$Text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [IO.File]::WriteAllText($Path, $Text, $utf8)
}
function Write-Json([string]$Path, $Value) {
    Write-Fixture $Path (ConvertTo-Json -InputObject $Value -Depth 20)
}
function Read-Queue([string]$CaseRoot) {
    $decoded = Get-Content -LiteralPath (Join-Path $CaseRoot 'output\backfill\queue.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    return $decoded
}
function Assert-Case([string]$Name, [bool]$Ok, [string]$Evidence = '') {
    $script:cases++
    if ($Ok) { Write-Output "CASE_OK name=$Name $Evidence" }
    else { Write-Output "CASE_FAIL name=$Name $Evidence"; $script:failures++ }
}
function Get-Snapshot([string]$CaseRoot) {
    return (@(Get-ChildItem -LiteralPath $CaseRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
        '{0}|{1}|{2}' -f $_.FullName, (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash, $_.LastWriteTimeUtc.Ticks
    }) -join "`n")
}
function New-Case([string]$Name, [string]$Caption = 'Shoe care tips.', [string]$Mode = 'success', [switch]$Single) {
    $caseRoot = Join-Path $fixture $Name
    $queue = @(
        [ordered]@{ date = '2026-10-26'; slot = 2; status = 'pending'; note = ''; attempted_at = $null; result = $null },
        [ordered]@{ date = '2026-10-27'; slot = 1; status = 'pending'; note = ''; attempted_at = $null; result = $null }
    )
    if ($Single) { $queue = @($queue[0]) }
    Write-Json (Join-Path $caseRoot 'output\backfill\queue.json') $queue
    Write-Json (Join-Path $caseRoot 'data\backfill-seed.json') $queue
    foreach ($entry in $queue) {
        $calendar = Get-Content -LiteralPath (Join-Path $root 'test\fixtures\backfill-calendar-2026-10-27.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $calendar.date = $entry.date
        foreach ($slot in $calendar.slots) { $slot.facebook_caption = $Caption; $slot.instagram_caption = 'Evergreen advice.' }
        Write-Json (Join-Path $caseRoot ('data\content-calendar\' + $entry.date + '.json')) $calendar
    }
    Write-Json (Join-Path $caseRoot 'fake-mode.json') $Mode
    Write-Fixture (Join-Path $caseRoot 'backfill-script.txt') $script:production
    return $caseRoot
}
function Set-Posted([string]$CaseRoot, [string]$Facebook, [string]$Instagram, $Dry = $false) {
    Write-Json (Join-Path $CaseRoot 'data\posted-log\2026-10-26.json') @(
        [ordered]@{ date = '2026-10-26'; slot = '2'; platform = 'facebook'; status = $Facebook; dry_run = $Dry; attempts = 1; published_media_type = 'image'; video_status = 'not_planned'; post_id = 'fake-fb'; created_at = '2026-10-26T03:30:12.496Z' },
        [ordered]@{ date = '2026-10-26'; slot = '2'; platform = 'instagram'; status = $Instagram; dry_run = $Dry; attempts = 1; published_media_type = 'image'; video_status = 'not_planned'; post_id = 'fake-ig'; created_at = '2026-10-26T03:30:22.646Z' }
    )
}
function Invoke-Probe([string]$CaseRoot, [string[]]$Extra = @(), [switch]$CmdStub, [switch]$DefaultRoot) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $stub = if ($CmdStub) { Join-Path $fixture 'fake npm.cmd' } else { Join-Path $fixture 'fake npm.ps1' }
    $scriptPath = if ($DefaultRoot) { Join-Path $CaseRoot 'scripts\backfill-publish.ps1' } else { $script:production }
    $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + (Join-Path $fixture 'probe-wrapper.ps1') +
        '" -Script "' + $scriptPath + '" -RootPath "' + $CaseRoot + '" -NpmCommand "' + $stub + '" ' + ($Extra -join ' ')
    if ($DefaultRoot) { $start.Arguments += ' -DefaultRoot' }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
    $child = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(100000)) {
            & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $child.Id /T /F | Out-Null
            throw 'Task-owned smoke child timed out.'
        }
        $text = $(if ($stdout.Wait(30000)) { $stdout.Result } else { '[probe stdout not closed]' }) +
            $(if ($stderr.Wait(30000)) { $stderr.Result } else { '[probe stderr not closed]' })
        $log = @(Get-ChildItem -LiteralPath (Join-Path $CaseRoot 'output\backfill-logs') -Filter '*.log' -ErrorAction SilentlyContinue |
            ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 }) -join "`n"
        $callsPath = Join-Path $CaseRoot 'calls.txt'
        return [pscustomobject]@{
            Code = $child.ExitCode; Text = $text; Log = $log
            Calls = @(if (Test-Path -LiteralPath $callsPath) { Get-Content -LiteralPath $callsPath -Encoding UTF8 })
        }
    } finally { $child.Dispose() }
}

try {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        Assert-Case 'backfill-script-exists' $false 'missing scripts/backfill-publish.ps1'
    } else {
        [void][IO.Directory]::CreateDirectory($fixture)
        $script:production = $source
        $original = [IO.File]::ReadAllText($source)
        if ($UseAtomicReplaceShim) {
            $needle = "[IO.File]::Replace(`$tmp, `$queuePath, `$queuePath + '.bak')"
            if (-not $original.Contains($needle)) { throw 'Atomic replacement anchor missing.' }
            $original = $original.Replace($needle, "[IO.File]::Copy(`$queuePath, `$queuePath + '.bak', `$true); [IO.File]::Copy(`$tmp, `$queuePath, `$true); [IO.File]::Delete(`$tmp)")
            Write-Output 'TEST_ONLY ATOMIC_REPLACE_SHIM: temporary copy uses file copies; native atomicity is NOT validated.'
        } else {
            $native = Join-Path $fixture 'replace-native.json'
            [IO.File]::WriteAllText($native, '[]')
            [IO.File]::WriteAllText(($native + '.tmp'), '[1]')
            try { [IO.File]::Replace(($native + '.tmp'), $native, ($native + '.bak')) }
            catch { Write-Output ('SMOKE_BLOCKED native File.Replace: ' + $_.Exception.Message); exit 2 }
        }
        if ($MutateDateGuard) {
            $needle = '$dateHits = @(Get-DateTextHits -Slot $calendarSlot -Entry $entry)'
            if (-not $original.Contains($needle)) { throw 'Date guard mutation anchor missing.' }
            $original = $original.Replace($needle, '$dateHits = @()')
            Write-Output 'MUTATION date-text guard removed in temporary copy; production source unchanged.'
        }
        if ($MutateWeekRegex) {
            $needle = '[\u672c\u9019][\u9031\u5468]|'
            if (-not $original.Contains($needle)) { throw 'Week regex mutation anchor missing.' }
            $original = $original.Replace($needle, '')
            Write-Output 'MUTATION this-week regex branch removed in temporary copy; production source unchanged.'
        }
        if ($MutateFirstCommentGuard) {
            $needle = '$texts += @(Get-FirstCommentStrings $Entry)'
            if (-not $original.Contains($needle)) { throw 'First comment mutation anchor missing.' }
            $original = $original.Replace($needle, '# MUTATION: first comments ignored.')
            Write-Output 'MUTATION first comment scan removed in temporary copy; production source unchanged.'
        }
        if ($UseAtomicReplaceShim -or $MutateDateGuard -or $MutateWeekRegex -or $MutateFirstCommentGuard) {
            $script:production = Join-Path $fixture 'candidate-backfill-publish.ps1'
            Write-Fixture $script:production $original
        }
        Write-Fixture (Join-Path $fixture 'probe-wrapper.ps1') @'
param($Script, $RootPath, $NpmCommand, [switch]$DryRun, [switch]$Stop, [switch]$DefaultRoot, [int]$NpmTimeoutSec = 600)
$ErrorActionPreference = 'Stop'
function Disable-ScheduledTask {
    [CmdletBinding()]param($TaskName)
    if (Test-Path -LiteralPath (Join-Path $RootPath 'disable-throws.txt')) { throw 'fixture disable failure' }
    [IO.File]::WriteAllText((Join-Path $RootPath 'disabled-task.txt'), $TaskName)
}
$params = @{ NpmCommand = $NpmCommand; DryRun = $DryRun; Stop = $Stop; NpmTimeoutSec = $NpmTimeoutSec }
if (-not $DefaultRoot) { $params.RootPath = $RootPath }
& $Script @params
exit $LASTEXITCODE
'@
        Write-Fixture (Join-Path $fixture 'sleeper.ps1') @'
param([string]$RootPath, [int]$Seconds)
Write-Output 'task-owned grandchild'
Start-Sleep -Seconds $Seconds
[IO.File]::WriteAllText((Join-Path $RootPath 'grandchild-survived.txt'), 'survived')
'@
        Write-Fixture (Join-Path $fixture 'fake npm.ps1') @'
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
if ($args.Count -ne 8 -or $args[0] -ne 'run' -or $args[1] -ne 'post-current-slot' -or
    $args[2] -ne '--' -or $args[3] -ne '--date' -or $args[5] -ne '--slot' -or $args[7] -ne '--live') { exit 90 }
if ($env:ALLOW_OFF_SCHEDULE_PUBLISH -ne 'true') { exit 91 }
$root = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $root 'fake-mode.json'))) { exit 92 }
$date = [string]$args[4]
$slot = [int]$args[6]
$queue = Get-Content -LiteralPath (Join-Path $root 'output\backfill\queue.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$claimed = @($queue | Where-Object { $_.date -eq $date -and $_.slot -eq $slot })
if ($claimed.Count -ne 1 -or $claimed[0].status -ne 'failed' -or -not $claimed[0].attempted_at) { exit 93 }
Add-Content -LiteralPath (Join-Path $root 'calls.txt') -Encoding UTF8 -Value ($date + '|' + $slot)
$mode = Get-Content -LiteralPath (Join-Path $root 'fake-mode.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output 'fake publisher output'
Write-Output 'access_token=FAKE_ACCESS_TOKEN_DO_NOT_LOG'
Write-Output 'Authorization: Bearer FAKE_BEARER_DO_NOT_LOG'
Write-Output '{"refresh_token":"FAKE_REFRESH_DO_NOT_LOG"}'
Write-Output 'https://example.invalid/?token=FAKE_QUERY_DO_NOT_LOG&ok=1'
Write-Output ('IGQV' + ('a' * 28))
Write-Output ('IGAA' + ('b' * 28))
Write-Output ('EA' + ('c' * 28))
Write-Output ('sk-' + ('d' * 28))
if ($mode -in @('timeout', 'pipe-held')) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $seconds = 45
    $start.Arguments = '-NoProfile -NonInteractive -File "' + (Join-Path $PSScriptRoot 'sleeper.ps1') + '" -RootPath "' + $root + '" -Seconds ' + $seconds
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $grandchild = [Diagnostics.Process]::Start($start)
    [IO.File]::WriteAllText((Join-Path $root 'child-pids.json'), (ConvertTo-Json -InputObject @($PID, $grandchild.Id)))
    Write-Output 'partial stdout before timeout'
    [Console]::Error.WriteLine('partial stderr before timeout')
    if ($mode -eq 'pipe-held') { exit 0 }
    Start-Sleep -Seconds 45
    exit 0
}
if ($mode -eq 'stop-during-attempt') {
    $backfill = Get-Content -LiteralPath (Join-Path $root 'backfill-script.txt') -Raw -Encoding UTF8
    & (Join-Path $PSHOME 'powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'probe-wrapper.ps1') -Script $backfill -RootPath $root -NpmCommand $PSCommandPath -Stop
    if ($LASTEXITCODE -ne 0) { exit 94 }
}
if ($mode -eq 'missing') { exit 0 }
$path = Join-Path $root ('data\posted-log\' + $date + '.json')
[void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
$rows = @()
if (Test-Path -LiteralPath $path) {
    $decoded = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $rows = @($decoded)
}
foreach ($platform in @('facebook', 'instagram')) {
    if (@($rows | Where-Object { $_.slot -eq $slot -and $_.platform -eq $platform -and $_.status -eq 'success' -and -not ($_.dry_run -eq $true -or [string]$_.dry_run -ieq 'true') }).Count -gt 0) { continue }
    if ($mode -eq 'partial' -and $platform -eq 'instagram') { continue }
    Add-Content -LiteralPath (Join-Path $root 'platform-calls.txt') -Value $platform -Encoding UTF8
    $status = if ($mode -eq 'failure') { 'failed' } elseif ($mode -eq 'uncertain' -and $platform -eq 'instagram') { 'uncertain' } else { 'success' }
    $rows += [ordered]@{ date = $date; slot = $slot; platform = $platform; status = $status; dry_run = $false }
}
[IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $rows -Depth 10), [Text.UTF8Encoding]::new($false))
if ($mode -eq 'stderr') { [Console]::Error.WriteLine('fake stderr diagnostic') }
if ($mode -in @('failure', 'nonzero-success')) { exit 9 }
exit 0
'@
        Write-Fixture (Join-Path $fixture 'fake npm.cmd') ('@echo off' + "`r`n" +
            '"' + (Join-Path $PSHOME 'powershell.exe') + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
            (Join-Path $fixture 'fake npm.ps1') + '" %*' + "`r`n" + 'exit /b %errorlevel%' + "`r`n")

        $case = New-Case 'advance'
        $probe = Invoke-Probe $case
        $queue = Read-Queue $case
        Assert-Case 'advance-first-pending-only' ($probe.Code -eq 0 -and $queue[0].status -eq 'done' -and
            $queue[1].status -eq 'pending' -and @($probe.Calls).Count -eq 1 -and $probe.Calls[0] -eq '2026-10-26|2') $probe.Text.Trim()
        Assert-Case 'attempt-result-and-log' ($queue[0].attempted_at -and $queue[0].result.exit_code -eq 0 -and
            $queue[0].result.facebook -eq 'success' -and $queue[0].result.instagram -eq 'success' -and
            $probe.Log.Contains('fake publisher output'))
        Assert-Case 'tokens-redacted' ($probe.Log.Contains('[REDACTED]') -and
            ($probe.Log + $probe.Text + (ConvertTo-Json -InputObject $queue -Depth 20)) -notmatch 'FAKE_(ACCESS_TOKEN|BEARER|REFRESH|QUERY)_DO_NOT_LOG|IG(?:QV|AA)[ab]{28}|EAc{28}|sk-d{28}')
        $backup = Get-Content -LiteralPath (Join-Path $case 'output\backfill\queue.json.bak') -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-Case 'queue-backup-preserves-before-completion' ($backup[0].status -eq 'failed' -and $backup[1].status -eq 'pending')
        $probe = Invoke-Probe $case -CmdStub
        $queue = Read-Queue $case
        Assert-Case 'same-day-second-run-blocked' ($probe.Code -eq 0 -and $queue[1].status -eq 'pending' -and
            @($probe.Calls).Count -eq 1) $probe.Text.Trim()
        $queue[0].attempted_at = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd') + 'T16:00:00+08:00'
        Write-Json (Join-Path $case 'output\backfill\queue.json') $queue
        $probe = Invoke-Probe $case -CmdStub
        Assert-Case 'next-day-advances-cmd-stub' ($probe.Code -eq 0 -and (Read-Queue $case)[1].status -eq 'done' -and @($probe.Calls).Count -eq 2) $probe.Text.Trim()

        $case = New-Case 'already-success' ([string][char]0x4eca + [char]0x5929) -Single
        Set-Posted $case 'success' 'success'
        $probe = Invoke-Probe $case
        Assert-Case 'both-success-no-publish-before-date-check' ($probe.Code -eq 0 -and
            (Read-Queue $case)[0].status -eq 'done' -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()

        # Hand-derived Unicode fixtures keep every script byte ASCII.
        # Removing the date guard must break these observable skip decisions.
        $words = @(
            @{ Name = 'today'; Text = ([string][char]0x4eca + [char]0x5929) },
            @{ Name = 'today-formal'; Text = ([string][char]0x4eca + [char]0x65e5) },
            @{ Name = 'tomorrow'; Text = ([string][char]0x660e + [char]0x5929) },
            @{ Name = 'yesterday'; Text = ([string][char]0x6628 + [char]0x5929) },
            @{ Name = 'monday'; Text = ([string][char]0x9031 + [char]0x4e00) },
            @{ Name = 'sunday'; Text = ([string][char]0x9031 + [char]0x65e5) },
            @{ Name = 'weekday'; Text = ([string][char]0x661f + [char]0x671f + [char]0x4e09) },
            @{ Name = 'this-week'; Text = ([string][char]0x672c + [char]0x9031) },
            @{ Name = 'this-week-alt'; Text = ([string][char]0x9019 + [char]0x9031) },
            @{ Name = 'slash-date'; Text = '10/26' },
            @{ Name = 'chinese-date'; Text = ('10' + [char]0x6708 + '29' + [char]0x65e5) },
            @{ Name = 'iso-date'; Text = '2026-10-26' },
            @{ Name = 'worship-monday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x4e00) },
            @{ Name = 'weekend'; Text = ([string][char]0x9031 + [char]0x672b) },
            @{ Name = 'next-week'; Text = ([string][char]0x4e0b + [char]0x9031) },
            @{ Name = 'tonight'; Text = ([string][char]0x4eca + [char]0x665a) },
            @{ Name = 'day-after'; Text = ([string][char]0x5f8c + [char]0x5929) },
            @{ Name = 'chinese-date-colloquial'; Text = ('10' + [char]0x6708 + '26' + [char]0x865f) },
            @{ Name = 'fullwidth-date'; Text = ('10' + [char]0xff0f + '26') },
            @{ Name = 'october'; Text = ([string][char]0x5341 + [char]0x6708) },
            @{ Name = 'halloween'; Text = ([string][char]0x842c + [char]0x8056) },
            @{ Name = 'worship-tuesday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x4e8c) },
            @{ Name = 'worship-wednesday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x4e09) },
            @{ Name = 'worship-thursday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x56db) },
            @{ Name = 'worship-friday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x4e94) },
            @{ Name = 'worship-saturday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x516d) },
            @{ Name = 'worship-sunday'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x65e5) },
            @{ Name = 'worship-sky'; Text = ([string][char]0x79ae + [char]0x62dc + [char]0x5929) },
            @{ Name = 'weekend-alt'; Text = ([string][char]0x5468 + [char]0x672b) },
            @{ Name = 'last-week'; Text = ([string][char]0x4e0a + [char]0x9031) },
            @{ Name = 'last-week-alt'; Text = ([string][char]0x4e0a + [char]0x5468) },
            @{ Name = 'next-week-alt'; Text = ([string][char]0x4e0b + [char]0x5468) },
            @{ Name = 'this-morning'; Text = ([string][char]0x4eca + [char]0x65e9) },
            @{ Name = 'tomorrow-morning'; Text = ([string][char]0x660e + [char]0x65e9) },
            @{ Name = 'tomorrow-night'; Text = ([string][char]0x660e + [char]0x665a) },
            @{ Name = 'day-before'; Text = ([string][char]0x524d + [char]0x5929) }
        )
        foreach ($word in $words) {
            $case = New-Case ('date-' + $word.Name) $word.Text -Single
            $probe = Invoke-Probe $case
            $entry = (Read-Queue $case)[0]
            Assert-Case ('date-skip-' + $word.Name) ($probe.Code -eq 0 -and $entry.status -eq 'skipped' -and
                $entry.note.Contains($word.Text) -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()
        }
        $case = New-Case 'nested-first-comment' -Single
        $calendarPath = Join-Path $case 'data\content-calendar\2026-10-26.json'
        $calendar = Get-Content -LiteralPath $calendarPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $calendar.slots[1] | Add-Member NoteProperty first_comments ([pscustomobject]@{ instagram = @([pscustomobject]@{ text = '10/28 details' }) })
        Write-Json $calendarPath $calendar
        $probe = Invoke-Probe $case
        Assert-Case 'calendar-inline-first-comment-not-scanned' ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and
            @($probe.Calls).Count -eq 1 -and $probe.Text.Contains('date_check=pass')) $probe.Text.Trim()

        $weekend = [string][char]0x9031 + [char]0x672b
        foreach ($field in @('text', 'message', 'comment', 'comment_text')) {
            $case = New-Case ('first-comment-' + $field) -Single
            $row = [ordered]@{ date = '2026-10-26'; slot = 2; media_id = 'fake-media'; comment_id = 'fake-comment'; created_at = '2026-10-26T03:30:31.438Z' }
            $row[$field] = $weekend + ' care tips.'
            Write-Json (Join-Path $case 'data\first-comments\2026-10-26.json') @($row)
            $before = Get-Snapshot $case
            $preview = Invoke-Probe $case @('-DryRun')
            Assert-Case ('first-comment-' + $field + '-dry-run-skip-zero-writes') ($preview.Code -eq 0 -and
                $before -ceq (Get-Snapshot $case) -and $preview.Text.Contains('date_check=skip') -and $preview.Text.Contains($weekend)) $preview.Text.Trim()
            $probe = Invoke-Probe $case
            Assert-Case ('first-comment-' + $field + '-weekend-skipped') ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'skipped' -and
                (Read-Queue $case)[0].note.Contains($weekend) -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()
        }
        foreach ($mode in @('other-slot', 'metadata-only', 'empty')) {
            $case = New-Case ('first-comment-' + $mode) -Single
            $rows = @()
            if ($mode -ne 'empty') {
                $row = [ordered]@{ date = '2026-10-26'; slot = 2; media_id = 'fake-2026-10-26'; comment_id = 'fake-comment'; created_at = '2026-10-26T03:30:31.438Z' }
                if ($mode -eq 'other-slot') { $row.slot = 1; $row.text = $weekend }
                else { $row.note = $weekend; $row.local_image_path = '2026-10-26.png' }
                $rows = @($row)
            }
            Write-Json (Join-Path $case 'data\first-comments\2026-10-26.json') $rows
            $probe = Invoke-Probe $case
            Assert-Case ('first-comment-' + $mode + '-ignored') ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and
                @($probe.Calls).Count -eq 1 -and $probe.Text.Contains('date_check=pass')) $probe.Text.Trim()
        }
        $case = New-Case 'bad-first-comments' -Single
        Write-Fixture (Join-Path $case 'data\first-comments\2026-10-26.json') '{bad json'
        $probe = Invoke-Probe $case
        Assert-Case 'bad-first-comments-no-publish' ($probe.Code -eq 1 -and (Read-Queue $case)[0].status -eq 'failed' -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()

        $case = New-Case 'dry-run'
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-DryRun')
        Assert-Case 'dry-run-zero-writes' ($probe.Code -eq 0 -and $before -ceq (Get-Snapshot $case) -and
            $probe.Text.Contains('2026-10-26') -and $probe.Text.Contains('slot=2') -and $probe.Text.Contains('date_check=pass')) $probe.Text.Trim()
        $case = New-Case 'default-root-dry-run'
        Write-Fixture (Join-Path $case 'scripts\backfill-publish.ps1') ([IO.File]::ReadAllText($script:production))
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-DryRun') -DefaultRoot
        Assert-Case 'default-root-dry-run-zero-writes' ($probe.Code -eq 0 -and $before -ceq (Get-Snapshot $case) -and
            $probe.Text.Contains('date=2026-10-26 slot=2 date_check=pass')) $probe.Text.Trim()
        $case = New-Case 'dry-run-date' '10/27'
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-DryRun')
        Assert-Case 'dry-run-date-skip-zero-writes' ($probe.Code -eq 0 -and $before -ceq (Get-Snapshot $case) -and
            $probe.Text.Contains('date_check=skip') -and $probe.Text.Contains('10/27')) $probe.Text.Trim()

        $case = New-Case 'npm-failure' 'Care tips.' 'failure'
        $first = Invoke-Probe $case
        $entry = (Read-Queue $case)[0]
        $second = Invoke-Probe $case
        Assert-Case 'npm-failure-failed-no-retry' ($first.Code -eq 1 -and $entry.status -eq 'failed' -and
            $entry.result.exit_code -eq 9 -and $entry.note.Contains('failed') -and $second.Code -eq 0 -and @($second.Calls).Count -eq 1) $first.Text.Trim()
        foreach ($mode in @('uncertain', 'missing', 'partial')) {
            $case = New-Case ('result-' + $mode) 'Care tips.' $mode
            $probe = Invoke-Probe $case
            Assert-Case ('posted-log-required-' + $mode) ($probe.Code -eq 1 -and
                (Read-Queue $case)[0].status -eq 'failed' -and @($probe.Calls).Count -eq 1) $probe.Text.Trim()
        }
        $case = New-Case 'existing-uncertain'
        Set-Posted $case 'success' 'uncertain'
        $probe = Invoke-Probe $case
        Assert-Case 'existing-uncertain-needs-human' ($probe.Code -eq 1 -and
            (Read-Queue $case)[0].status -eq 'failed' -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()
        $case = New-Case 'dry-run-success-not-live'
        Set-Posted $case 'success' 'success' $true
        $probe = Invoke-Probe $case
        Assert-Case 'dry-records-do-not-count' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 1) $probe.Text.Trim()
        foreach ($mode in @('stderr', 'nonzero-success')) {
            $case = New-Case ('output-' + $mode) 'Care tips.' $mode
            $probe = Invoke-Probe $case
            Assert-Case ('posted-log-verdict-' + $mode) ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and
                ($mode -ne 'stderr' -or $probe.Log.Contains('fake stderr diagnostic'))) $probe.Text.Trim()
        }

        $case = New-Case 'empty'
        Write-Json (Join-Path $case 'output\backfill\queue.json') @()
        $probe = Invoke-Probe $case
        Assert-Case 'empty-queue-exit-zero' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 0 -and
            $probe.Log.Contains('No pending')) $probe.Text.Trim()
        $case = New-Case 'owner-stop'
        $queue = Read-Queue $case
        $queue += [pscustomobject]@{ date = '2026-10-28'; slot = 1; status = 'failed'; note = 'keep me'; attempted_at = $null; result = $null }
        Write-Json (Join-Path $case 'output\backfill\queue.json') $queue
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-Stop', '-DryRun')
        Assert-Case 'stop-preview-zero-writes' ($probe.Code -eq 0 -and $before -ceq (Get-Snapshot $case)) $probe.Text.Trim()
        $probe = Invoke-Probe $case @('-Stop')
        $queue = Read-Queue $case
        Assert-Case 'stop-all-pending-only' ($probe.Code -eq 0 -and $queue[0].status -eq 'skipped' -and $queue[1].status -eq 'skipped' -and
            $queue[0].note -ceq 'owner stop' -and $queue[1].note -ceq 'owner stop' -and $queue[2].note -ceq 'keep me' -and
            $queue[2].status -eq 'failed' -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()
        $probe = Invoke-Probe $case
        Assert-Case 'stopped-queue-no-publish' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()

        $case = New-Case 'stop-before-claim'
        # Interleave Stop after the final posted-log read and before claim.
        # The real posted-log reader still runs; only the timing is controlled.
        $quotedSource = $script:production.Replace("'", "''")
        $quotedWrapper = (Join-Path $fixture 'probe-wrapper.ps1').Replace("'", "''")
        $quotedCase = $case.Replace("'", "''")
        $quotedNpm = (Join-Path $fixture 'fake npm.ps1').Replace("'", "''")
        Write-Fixture (Join-Path $case 'scripts\_pipeline-lock.ps1') @"
`$script:realPostedReader = (Get-Item Function:\Get-PostedState).ScriptBlock
function Get-PostedState(`$Entry) {
    `$state = & `$script:realPostedReader `$Entry
    & (Join-Path `$PSHOME 'powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '$quotedWrapper' -Script '$quotedSource' -RootPath '$quotedCase' -NpmCommand '$quotedNpm' -Stop | Out-Null
    if (`$LASTEXITCODE -ne 0) { throw 'Fixture Stop failed.' }
    return `$state
}
function Enter-PipelineMutex { param(`$Name, `$TimeoutSec); return 'fixture-owned-mutex' }
function Exit-PipelineMutex { param(`$Mutex) }
"@
        $probe = Invoke-Probe $case
        $queue = Read-Queue $case
        Assert-Case 'stop-before-claim-prevents-publish' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 0 -and
            $queue[0].status -ceq 'skipped' -and $queue[0].note -ceq 'owner stop' -and $queue[1].status -ceq 'skipped') $probe.Text.Trim()
        $case = New-Case 'stop-during-attempt' 'Care tips.' 'stop-during-attempt'
        $probe = Invoke-Probe $case
        $queue = Read-Queue $case
        Assert-Case 'stop-preserved-when-attempt-completes' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 1 -and
            $queue[0].status -ceq 'done' -and $queue[0].result.facebook -ceq 'success' -and
            $queue[1].status -ceq 'skipped' -and $queue[1].note -ceq 'owner stop') $probe.Text.Trim()

        $case = New-Case 'mutex-busy'
        Write-Fixture (Join-Path $case 'scripts\_pipeline-lock.ps1') @'
function Enter-PipelineMutex { param($Name, $TimeoutSec); Write-Log ("mutex busy: " + $Name); exit 75 }
function Exit-PipelineMutex { param($Mutex); throw 'Must not release an unowned mutex.' }
'@
        $queueBefore = Get-Content -LiteralPath (Join-Path $case 'output\backfill\queue.json') -Raw -Encoding UTF8
        $probe = Invoke-Probe $case
        Assert-Case 'mutex-unavailable-exit-75' ($probe.Code -eq 75 -and @($probe.Calls).Count -eq 0 -and
            $probe.Log.Contains('sxj-publish') -and $queueBefore -ceq (Get-Content -LiteralPath (Join-Path $case 'output\backfill\queue.json') -Raw -Encoding UTF8)) $probe.Text.Trim()
        $case = New-Case 'mutex-release' 'Care tips.' 'failure'
        Write-Fixture (Join-Path $case 'scripts\_pipeline-lock.ps1') @'
function Enter-PipelineMutex { param($Name, $TimeoutSec); Write-Log ("mutex enter: " + $Name); return 'fixture-owned-mutex' }
function Exit-PipelineMutex { param($Mutex); Write-Log ("mutex exit: " + $Mutex) }
'@
        $probe = Invoke-Probe $case
        Assert-Case 'mutex-released-after-failure' ($probe.Code -eq 1 -and @($probe.Calls).Count -eq 1 -and $probe.Log.Contains('mutex enter: sxj-publish') -and
            $probe.Log.Contains('mutex exit: fixture-owned-mutex')) $probe.Text.Trim()

        foreach ($mode in @('false', 'true', 'null', 'throw', 'missing-timeout', 'missing-enter', 'load-throw', 'syntax-error', 'missing-exit')) {
            $case = New-Case ('mutex-' + $mode)
            $body = switch ($mode) {
                'false' { 'function Enter-PipelineMutex { param($Name, $TimeoutSec); return $false }' }
                'true' { 'function Enter-PipelineMutex { param($Name, $TimeoutSec); return $true }' }
                'null' { 'function Enter-PipelineMutex { param($Name, $TimeoutSec); return $null }' }
                'throw' { 'function Enter-PipelineMutex { param($Name, $TimeoutSec); throw "fixture unavailable" }' }
                'missing-timeout' { 'function Enter-PipelineMutex { param($Name); return "fixture-owned" }' }
                'missing-enter' { '# No enter function.' }
                'load-throw' { 'throw "fixture load failed"' }
                'syntax-error' { 'function Enter-PipelineMutex { param(' }
                'missing-exit' { 'function Enter-PipelineMutex { param($Name, $TimeoutSec); return "fixture-owned" }' }
            }
            if ($mode -ne 'missing-exit') { $body += "`n" + 'function Exit-PipelineMutex { param($Mutex); throw "Unowned release" }' }
            Write-Fixture (Join-Path $case 'scripts\_pipeline-lock.ps1') $body
            $before = [IO.File]::ReadAllText((Join-Path $case 'output\backfill\queue.json'))
            $probe = Invoke-Probe $case
            $expected = if ($mode -in @('false', 'true', 'null', 'throw')) { 75 } else { 1 }
            Assert-Case ('mutex-contract-' + $mode) ($probe.Code -eq $expected -and @($probe.Calls).Count -eq 0 -and
                $before -ceq [IO.File]::ReadAllText((Join-Path $case 'output\backfill\queue.json'))) $probe.Text.Trim()
        }
        $case = New-Case 'daily-recheck-after-mutex'
        Write-Fixture (Join-Path $case 'scripts\_pipeline-lock.ps1') @'
function Enter-PipelineMutex {
    param($Name, $TimeoutSec)
    $path = Join-Path $root 'output\backfill\queue.json'
    $q = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    $q[1].status = 'failed'; $q[1].attempted_at = (Get-Date).ToString('yyyy-MM-dd') + 'T00:01:00+08:00'
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject @($q) -Depth 20))
    return 'fixture-owned'
}
function Exit-PipelineMutex { param($Mutex); Write-Log 'fixture released' }
'@
        $probe = Invoke-Probe $case
        Assert-Case 'daily-budget-rechecked-after-mutex' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 0 -and
            (Read-Queue $case)[0].status -eq 'pending' -and $probe.Log.Contains('after mutex') -and $probe.Log.Contains('fixture released')) $probe.Text.Trim()

        foreach ($status in @('done', 'failed')) {
            $case = New-Case ('daily-existing-' + $status)
            $q = Read-Queue $case
            $q[0].status = $status; $q[0].attempted_at = (Get-Date).ToString('yyyy-MM-dd') + 'T16:00:00+08:00'
            Write-Json (Join-Path $case 'output\backfill\queue.json') $q
            $before = [IO.File]::ReadAllText((Join-Path $case 'output\backfill\queue.json'))
            $probe = Invoke-Probe $case
            Assert-Case ('daily-' + $status + '-blocks-without-queue-change') ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 0 -and
                $before -ceq [IO.File]::ReadAllText((Join-Path $case 'output\backfill\queue.json'))) $probe.Text.Trim()
        }
        foreach ($outcome in @('skip', 'already-done')) {
            $case = New-Case ('continue-' + $outcome)
            if ($outcome -eq 'skip') {
                $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
                $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
                $calendar.slots[1].facebook_caption = '10/26'
                Write-Json $path $calendar
            } else { Set-Posted $case 'success' 'success' }
            $probe = Invoke-Probe $case
            $q = Read-Queue $case
            Assert-Case ($outcome + '-does-not-consume-day') ($probe.Code -eq 0 -and [string]::IsNullOrEmpty($q[0].attempted_at) -and
                $q[1].status -eq 'done' -and @($probe.Calls).Count -eq 1 -and $probe.Calls[0] -eq '2026-10-27|1') $probe.Text.Trim()
        }
        foreach ($field in @('hashtags', 'title', 'cta', 'body', 'text', 'comment', 'pinned_comment', 'nested', 'local_image_path', 'video_prompt', 'media_package')) {
            $case = New-Case ('text-field-' + $field) -Single
            $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
            $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
            $value = if ($field -eq 'hashtags') { @('#' + [char]0x9031 + [char]0x672b + 'care') }
                elseif ($field -eq 'nested') { [pscustomobject]@{ arbitrary = @('safe', [pscustomobject]@{ arbitrary_text = '10/26' }) } }
                elseif ($field -eq 'media_package') { [pscustomobject]@{ effective_date = '2026-10-26' } }
                else { '10/26' }
            $calendar.slots[1] | Add-Member NoteProperty $field $value -Force
            Write-Json $path $calendar
            $probe = Invoke-Probe $case
            Assert-Case ('internal-field-' + $field + '-not-scanned') ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and
                @($probe.Calls).Count -eq 1 -and $probe.Text.Contains('date_check=pass')) $probe.Text.Trim()
        }
        $case = New-Case 'internal-dates-clean-captions' -Single
        $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
        $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $calendar.slots[1].local_image_path = 'docs/assets/2026-10-26/slot-02.png'
        $calendar.slots[1] | Add-Member NoteProperty video_prompt 'Shot reference 2026-08-05.'
        $calendar.slots[1] | Add-Member NoteProperty media_package ([pscustomobject]@{ effective_date = '2026-07-29' })
        Write-Json $path $calendar
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-DryRun')
        Assert-Case 'internal-dates-clean-captions-pass-zero-writes' ($probe.Code -eq 0 -and $before -ceq (Get-Snapshot $case) -and
            $probe.Text.Contains('date_check=pass') -and $probe.Text.Contains('DryRun action=publish')) $probe.Text.Trim()
        foreach ($field in @('facebook_caption', 'instagram_caption')) {
            foreach ($kind in @('iso', 'hashtag')) {
                $case = New-Case ($field + '-' + $kind) -Single
                $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
                $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
                $word = if ($kind -eq 'iso') { '2026-10-27' } else { $weekend }
                $calendar.slots[1].$field = 'Care #' + $word
                Write-Json $path $calendar
                $probe = Invoke-Probe $case
                Assert-Case ($field + '-' + $kind + '-skipped') ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'skipped' -and
                    (Read-Queue $case)[0].note.Contains($word) -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()
            }
        }
        $case = New-Case 'excluded-metadata' -Single
        $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
        $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($field in @('date', 'time', 'id', 'some_url_hint', 'image_prompt', 'asset_reference')) {
            $calendar.slots[1] | Add-Member NoteProperty $field '10/26' -Force
        }
        Write-Json $path $calendar
        $probe = Invoke-Probe $case
        Assert-Case 'excluded-metadata-not-scanned' ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and @($probe.Calls).Count -eq 1) $probe.Text.Trim()
        $case = New-Case 'internal-text-cannot-replace-captions' -Single
        $path = Join-Path $case 'data\content-calendar\2026-10-26.json'
        $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $calendar.slots[1].facebook_caption = ''; $calendar.slots[1].instagram_caption = ''
        Write-Json $path $calendar
        $probe = Invoke-Probe $case
        Assert-Case 'internal-text-cannot-replace-missing-captions' ($probe.Code -eq 1 -and (Read-Queue $case)[0].status -eq 'failed' -and @($probe.Calls).Count -eq 0) $probe.Text.Trim()

        foreach ($dry in @('false', 'true')) {
            $case = New-Case ('dry-run-string-' + $dry) -Single
            Set-Posted $case 'success' 'success' $dry
            $probe = Invoke-Probe $case
            $expectedCalls = if ($dry -eq 'false') { 0 } else { 1 }
            Assert-Case ('dry-run-string-' + $dry) ($probe.Code -eq 0 -and @($probe.Calls).Count -eq $expectedCalls -and (Read-Queue $case)[0].status -eq 'done') $probe.Text.Trim()
        }
        $case = New-Case 'old-failure-and-partial-success' -Single
        Set-Posted $case 'success' 'failed'
        $path = Join-Path $case 'data\posted-log\2026-10-26.json'
        $rows = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $rows = @([pscustomobject]@{ date = '2026-10-26'; slot = '2'; platform = 'facebook'; status = 'failed'; dry_run = $false; attempts = 3; error = 'fixture 404'; created_at = '2026-10-26T03:00:00Z' }) + $rows
        Write-Json $path $rows
        $probe = Invoke-Probe $case
        $platformCalls = @(Get-Content -LiteralPath (Join-Path $case 'platform-calls.txt') -Encoding UTF8)
        Assert-Case 'partial-success-invokes-once-stub-skips-recorded-facebook' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 1 -and
            $platformCalls.Count -eq 1 -and $platformCalls[0] -eq 'instagram' -and (Read-Queue $case)[0].status -eq 'done') $probe.Text.Trim()

        foreach ($raw in @('{bad json', '[{"date":', '{}')) {
            $case = New-Case ('bad-queue-' + [guid]::NewGuid().ToString('n'))
            $path = Join-Path $case 'output\backfill\queue.json'
            Write-Fixture $path $raw
            $probe = Invoke-Probe $case
            Assert-Case ('corrupt-queue-' + $script:cases) ($probe.Code -eq 1 -and @($probe.Calls).Count -eq 0 -and
                $raw -ceq [IO.File]::ReadAllText($path) -and $probe.Log.Contains('Backfill error:')) $probe.Text.Trim()
        }
        $case = New-Case 'seed-initialization' -Single
        $path = Join-Path $case 'output\backfill\queue.json'
        [IO.File]::Delete($path)
        $before = Get-Snapshot $case
        $probe = Invoke-Probe $case @('-DryRun')
        Assert-Case 'dry-run-seed-fallback-zero-writes' ($probe.Code -eq 0 -and -not [IO.File]::Exists($path) -and $before -ceq (Get-Snapshot $case)) $probe.Text.Trim()
        $seedBefore = [IO.File]::ReadAllText((Join-Path $case 'data\backfill-seed.json'))
        $probe = Invoke-Probe $case
        Assert-Case 'first-run-copies-seed-runtime-only' ($probe.Code -eq 0 -and (Read-Queue $case)[0].status -eq 'done' -and
            $seedBefore -ceq [IO.File]::ReadAllText((Join-Path $case 'data\backfill-seed.json'))) $probe.Text.Trim()
        Assert-Case 'stop-disables-only-named-task' ([IO.File]::ReadAllText((Join-Path (Join-Path $fixture 'owner-stop') 'disabled-task.txt')) -ceq 'Laundry-Backfill-1600')
        $case = New-Case 'disable-failure'
        Write-Fixture (Join-Path $case 'disable-throws.txt') 'yes'
        $probe = Invoke-Probe $case @('-Stop')
        Assert-Case 'disable-failure-logged-stop-persists' ($probe.Code -eq 0 -and (Read-Queue $case)[0].note -ceq 'owner stop' -and
            $probe.Log.Contains('Scheduled task disable failed: fixture disable failure')) $probe.Text.Trim()

        if (-not $MutateDateGuard -and -not $MutateWeekRegex -and -not $MutateFirstCommentGuard) {
            $case = New-Case 'npm-timeout' 'Care tips.' 'timeout'
            $watch = [Diagnostics.Stopwatch]::StartNew()
            $probe = Invoke-Probe $case @('-NpmTimeoutSec', '5') -CmdStub
            $q = Read-Queue $case
            Assert-Case 'timeout-fails-minus-one-and-preserves-partial-output' ($probe.Code -eq 1 -and $q[0].status -eq 'failed' -and
                $q[0].result.exit_code -eq -1 -and $q[1].status -eq 'pending' -and $watch.Elapsed.TotalSeconds -lt 90 -and
                $probe.Log.Contains('partial stdout before timeout') -and $probe.Log.Contains('partial stderr before timeout')) $probe.Text.Trim()
            $childPids = Get-Content -LiteralPath (Join-Path $case 'child-pids.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $alive = @($childPids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
            if ($probe.Log.Contains('tree kill unconfirmed')) {
                $script:blocked++
                Write-Output 'CASE_BLOCKED name=timeout-kills-publisher-and-grandchild-tree native taskkill denied; natural exit is not kill proof.'
            } else {
                Assert-Case 'timeout-kills-publisher-and-grandchild-tree' ($alive.Count -eq 0 -and $watch.Elapsed.TotalSeconds -lt 20 -and
                    -not (Test-Path -LiteralPath (Join-Path $case 'grandchild-survived.txt'))) ('alive=' + $alive.Count)
            }
            $probe = Invoke-Probe $case
            Assert-Case 'timeout-no-same-day-retry' ($probe.Code -eq 0 -and @($probe.Calls).Count -eq 1 -and (Read-Queue $case)[0].result.exit_code -eq -1) $probe.Text.Trim()
            $case = New-Case 'inherited-output-pipe' 'Care tips.' 'pipe-held' -Single
            $watch = [Diagnostics.Stopwatch]::StartNew()
            $probe = Invoke-Probe $case
            Assert-Case 'inherited-stdout-pipe-bounded' ($probe.Code -eq 1 -and $watch.Elapsed.TotalSeconds -lt 70 -and
                $probe.Log.Contains('[stdout not closed]') -and (Read-Queue $case)[0].status -eq 'failed') $probe.Text.Trim()
        }

        $case = New-Case 'bad-calendar'
        Write-Fixture (Join-Path $case 'data\content-calendar\2026-10-26.json') '{bad json'
        $probe = Invoke-Probe $case
        Assert-Case 'bad-calendar-no-publish' ($probe.Code -eq 1 -and (Read-Queue $case)[0].status -eq 'failed' -and
            @($probe.Calls).Count -eq 0) $probe.Text.Trim()
        $case = New-Case 'bad-posted'
        Write-Fixture (Join-Path $case 'data\posted-log\2026-10-26.json') '{bad json'
        $probe = Invoke-Probe $case
        Assert-Case 'bad-posted-no-publish' ($probe.Code -eq 1 -and (Read-Queue $case)[0].status -eq 'failed' -and
            @($probe.Calls).Count -eq 0) $probe.Text.Trim()

        # Every scheduler command is shadowed in a child process. These probes
        # never invoke the real ScheduledTasks provider or register a task.
        $registrarHarness = Join-Path $fixture 'registrar-harness.ps1'
        Write-Fixture $registrarHarness @'
param([string]$Script, [string]$RootPath, [string]$Mode)
$ErrorActionPreference = 'Stop'
function Get-ScheduledTask {
    [CmdletBinding()]param()
    if ($Mode -eq 'existing') { [pscustomobject]@{ TaskName = 'Laundry-Backfill-1600' } }
}
function New-ScheduledTaskAction {
    param($Execute, $Argument, $WorkingDirectory)
    [pscustomobject]@{ execute = $Execute; argument = $Argument; working_directory = $WorkingDirectory }
}
function New-ScheduledTaskTrigger {
    param([switch]$Daily, [DateTime]$At)
    [pscustomobject]@{ daily = [bool]$Daily; at = $At.ToString('yyyy-MM-ddTHH:mm:ss'); EndBoundary = '' }
}
function New-ScheduledTaskPrincipal {
    param($UserId, $LogonType, $RunLevel)
    [pscustomobject]@{ user = $UserId; logon_type = $LogonType; run_level = $RunLevel }
}
function New-ScheduledTaskSettingsSet {
    param([TimeSpan]$ExecutionTimeLimit, $MultipleInstances, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
    [pscustomobject]@{ limit_minutes = $ExecutionTimeLimit.TotalMinutes; multiple = $MultipleInstances; battery_start = [bool]$AllowStartIfOnBatteries; battery_continue = [bool]$DontStopIfGoingOnBatteries }
}
function Get-Date {
    if ($Mode -eq 'late') { [datetime]'2026-11-01T12:00:00' }
    elseif ($Mode -eq 'expired') { [datetime]'2026-11-07T00:00:00' }
    else { [datetime]'2026-10-30T12:00:00' }
}
function Register-ScheduledTask {
    [CmdletBinding()]param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Settings, $Description)
    $result = [ordered]@{ name = $TaskName; path = $TaskPath; action = $Action; trigger = $Trigger; principal = $Principal; settings = $Settings }
    [IO.File]::WriteAllText((Join-Path $RootPath 'mock-registration.json'), (ConvertTo-Json -InputObject $result -Depth 10))
}
try {
    if ($Mode -eq 'default-root') { & $Script }
    else { & $Script -RootPath $RootPath -WhatIf:($Mode -eq 'whatif') }
}
catch { Write-Output ('REGISTRAR_ERROR: ' + $_.Exception.Message); exit 1 }
exit 0
'@
        foreach ($mode in @('whatif', 'existing', 'capture', 'default-root', 'late', 'expired')) {
            $case = New-Case ('registrar-' + $mode)
            Write-Fixture (Join-Path $case 'scripts\backfill-publish.ps1') '# Not executed by scheduler mocks.'
            $registerSource = Join-Path $root 'scripts\register-backfill-task.ps1'
            if ($mode -eq 'default-root') {
                $localRegistrar = Join-Path $case 'scripts\register-backfill-task.ps1'
                Write-Fixture $localRegistrar ([IO.File]::ReadAllText($registerSource))
                $registerSource = $localRegistrar
            }
            $text = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $registrarHarness `
                -Script $registerSource -RootPath $case -Mode $mode 2>&1 | Out-String
            $code = $LASTEXITCODE
            $capture = Join-Path $case 'mock-registration.json'
            if ($mode -eq 'whatif') {
                Assert-Case 'registrar-whatif-no-registration' ($code -eq 0 -and -not (Test-Path -LiteralPath $capture)) $text.Trim()
            } elseif ($mode -eq 'existing') {
                Assert-Case 'registrar-existing-refused' ($code -eq 1 -and -not (Test-Path -LiteralPath $capture) -and $text.Contains('already exists')) $text.Trim()
            } elseif ($mode -eq 'expired') {
                Assert-Case 'registrar-expired-refused' ($code -eq 1 -and -not (Test-Path -LiteralPath $capture) -and $text.Contains('window has ended')) $text.Trim()
            } else {
                $registered = Get-Content -LiteralPath $capture -Raw -Encoding UTF8 | ConvertFrom-Json
                Assert-Case ('registrar-mocked-contract-' + $mode) ($code -eq 0 -and $registered.name -ceq 'Laundry-Backfill-1600' -and
                    $registered.principal.logon_type -ceq 'Interactive' -and $registered.principal.run_level -ceq 'Limited' -and
                    $registered.principal.user -ceq [Security.Principal.WindowsIdentity]::GetCurrent().Name -and
                    $registered.settings.limit_minutes -eq 15 -and $registered.settings.multiple -ceq 'IgnoreNew' -and
                    $registered.settings.battery_start -and $registered.settings.battery_continue -and
                    $registered.trigger.daily -and $registered.trigger.at -ceq '2026-10-31T16:00:00' -and
                    $registered.trigger.EndBoundary -ceq '2026-11-07T00:00:00' -and
                    $registered.action.working_directory -ceq $case -and $registered.action.argument.Contains('backfill-publish.ps1') -and
                    ($mode -ne 'late' -or $text.Contains('fewer than 7 runs remain'))) $text.Trim()
            }
        }
    }
} catch {
    Assert-Case 'smoke-unhandled-error' $false $_.Exception.Message
} finally {
    # Remove only this test's verified, non-reparse temporary tree.
    if (Test-Path -LiteralPath $fixture) {
        $resolved = [IO.Path]::GetFullPath($fixture)
        $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        $links = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
        if ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolved) -like 'a9-backfill-*' -and $links.Count -eq 0 -and
            -not ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        } else { Assert-Case 'safe-fixture-cleanup' $false 'Temporary tree retained because its boundary check failed.' }
    }
}
if ($script:failures -gt 0) { Write-Output "SMOKE_FAIL cases=$script:cases failures=$script:failures"; exit 1 }
if ($script:blocked -gt 0) { Write-Output "SMOKE_BEHAVIOR_PARTIAL cases=$script:cases failures=0 blocked=$script:blocked native_atomic_replace=NOT_VALIDATED"; exit 2 }
if ($UseAtomicReplaceShim) { Write-Output "SMOKE_BEHAVIOR_OK cases=$script:cases failures=0 native_atomic_replace=NOT_VALIDATED" }
else { Write-Output "SMOKE_OK cases=$script:cases failures=0" }
exit 0
