[CmdletBinding()]
param(
    [string]$RootPath = '',
    [string]$NpmCommand = 'npm.cmd',
    [ValidateRange(1, 600)][int]$NpmTimeoutSec = 600,
    [switch]$DryRun,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
if ([string]::IsNullOrWhiteSpace($RootPath)) { $RootPath = Split-Path -Parent $PSScriptRoot }
$root = (Resolve-Path -LiteralPath $RootPath -ErrorAction Stop).ProviderPath
$queuePath = Join-Path $root 'output\backfill\queue.json'
$seedPath = Join-Path $root 'data\backfill-seed.json'
$logFile = Join-Path $root ('output\backfill-logs\' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
$utf8 = [Text.UTF8Encoding]::new($false)

function Protect-LogText([string]$Text) {
    # Do not read any secret files or environment secrets to build this filter.
    # Drop entire sensitive lines, including JSON/URL/header representations.
    $lines = foreach ($line in ($Text -split '\r?\n')) {
        if ($line -match '(?i)(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|authorization|cookie|\btoken\b|\bBearer\b)\s*["\x27]?\s*[:=\s]') {
            '[REDACTED]'
        } else {
            $clean = [regex]::Replace($line, '(?i)\bEA[A-Za-z0-9_-]{20,}\b|\bIG[A-Z]{2}[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9_-]{12,}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED]')
            $clean
        }
    }
    return ($lines -join [Environment]::NewLine)
}

function Write-Log([string]$Message) {
    $safe = Protect-LogText $Message
    Write-Host $safe
    if (-not $DryRun) {
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $logFile))
        $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}{2}' -f (Get-Date), $safe, [Environment]::NewLine
        [IO.File]::AppendAllText($logFile, $line, $utf8)
    }
}

function Read-Queue {
    # DryRun uses the seed in memory when no runtime queue exists.
    $readPath = $queuePath
    if ($DryRun -and -not [IO.File]::Exists($readPath)) { $readPath = $seedPath }
    $raw = Get-Content -LiteralPath $readPath -Raw -Encoding UTF8
    if (-not $raw.TrimStart().StartsWith('[')) { throw 'Queue must be a JSON array.' }
    # PS 5.1 emits a parsed JSON array as one pipeline object. Assign first,
    # then enumerate the variable (also handles an empty array correctly).
    $decoded = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
    $queue = @($decoded)
    $seen = @{}
    foreach ($entry in $queue) {
        if ($null -eq $entry -or $entry.date -notmatch '^\d{4}-\d{2}-\d{2}$' -or
            [string]$entry.slot -notmatch '^[1-3]$' -or
            [string]$entry.status -cnotin @('pending', 'done', 'skipped', 'failed')) { throw 'Invalid backfill queue entry.' }
        [void][DateTime]::ParseExact($entry.date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
        foreach ($name in @('note', 'attempted_at', 'result')) {
            if ($null -eq $entry.PSObject.Properties[$name]) { throw "Queue field missing: $name" }
        }
        $key = '{0}/{1}' -f $entry.date, $entry.slot
        if ($seen.ContainsKey($key)) { throw 'Duplicate date/slot in queue.' }
        $seen[$key] = $true
    }
    return $queue
}

function Save-Queue([AllowEmptyCollection()][object[]]$Queue) {
    $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject @($Queue) -Depth 30) + [Environment]::NewLine)
    # Caller holds the queue sidecar lock. Never fall back to an in-place write.
    $tmp = $queuePath + '.tmp'
    [IO.File]::WriteAllBytes($tmp, $bytes)
    [void](ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($tmp, $utf8)) -ErrorAction Stop)
    [IO.File]::Replace($tmp, $queuePath, $queuePath + '.bak')
}

function Enter-QueueLock {
    # This sidecar stays on disk; ownership is the OS handle, never its age.
    # File sharing also serializes callers using different junction aliases.
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        try { return [IO.File]::Open(($queuePath + '.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
        catch [IO.IOException] {
            if ($timer.Elapsed.TotalSeconds -ge 5) { throw 'Backfill queue is busy; no publish.' }
            Start-Sleep -Milliseconds 25
        }
    }
}

function Initialize-Queue {
    if ($DryRun) { return }
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $queuePath))
    $queueLock = Enter-QueueLock
    try {
        if (-not [IO.File]::Exists($queuePath)) {
            # First creation also validates before the same-directory rename.
            $tmp = $queuePath + '.tmp'
            [IO.File]::Copy($seedPath, $tmp, $true)
            [void](ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($tmp, $utf8)) -ErrorAction Stop)
            [IO.File]::Move($tmp, $queuePath)
        }
    } finally { $queueLock.Dispose() }
}

function Test-AttemptedToday([AllowEmptyCollection()][object[]]$Queue) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    return @($Queue | Where-Object {
        $_.status -cin @('done', 'failed') -and ([string]$_.attempted_at).StartsWith($today)
    }).Count -gt 0
}

function Set-QueueEntry($Entry, [string]$Status, [string]$Note, $Result, [string]$AttemptedAt, [string]$ExpectedStatus = 'pending') {
    $queueLock = Enter-QueueLock
    try {
        $current = @(Read-Queue)
        $matches = @($current | Where-Object { $_.date -ceq $Entry.date -and $_.slot -eq $Entry.slot })
        if ($matches.Count -ne 1) { throw 'Attempted queue entry disappeared.' }
        if ($matches[0].status -cne $ExpectedStatus) { return $false }
        if ($ExpectedStatus -ceq 'failed' -and $matches[0].attempted_at -cne $AttemptedAt) { return $false }
        # Keep the daily check and claim in one critical section even without A7.
        if ($Status -ceq 'failed' -and $ExpectedStatus -ceq 'pending' -and (Test-AttemptedToday $current)) { return $false }
        $matches[0].status = $Status
        $matches[0].note = Protect-LogText $Note
        $matches[0].attempted_at = $AttemptedAt
        $matches[0].result = $Result
        Save-Queue $current
        return $true
    } finally { $queueLock.Dispose() }
}

function Get-PostedState($Entry) {
    $path = Join-Path $root ('data\posted-log\' + $Entry.date + '.json')
    $rows = @()
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
        if (-not $raw.TrimStart().StartsWith('[')) { throw 'posted-log must be a JSON array.' }
        $decoded = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        $rows = @($decoded)
        foreach ($row in $rows) {
            if ($null -eq $row -or $null -eq $row.slot -or $null -eq $row.platform -or $null -eq $row.status) {
                throw 'Invalid posted-log row.'
            }
        }
    }
    $state = [ordered]@{ facebook = 'missing'; instagram = 'missing' }
    foreach ($platform in @('facebook', 'instagram')) {
        $live = @($rows | Where-Object {
            $_.slot -eq $Entry.slot -and $_.platform -ceq $platform -and
            -not ($_.dry_run -eq $true -or [string]$_.dry_run -ieq 'true') -and
            ($null -eq $_.date -or $_.date -ceq $Entry.date)
        })
        # An older failure does not erase a later recorded success.
        foreach ($status in @('success', 'uncertain', 'failed', 'posted', 'missed')) {
            if (@($live | Where-Object { $_.status -ceq $status }).Count -gt 0) { $state[$platform] = $status; break }
        }
    }
    return [pscustomobject]$state
}

function Get-CaptionStrings($Slot) {
    # Only these two calendar fields are sent as publisher input.caption.
    foreach ($name in @('facebook_caption', 'instagram_caption')) {
        if ($Slot.$name -is [string]) { $Slot.$name }
    }
}

function Get-FirstCommentStrings($Entry) {
    $path = Join-Path $root ('data\first-comments\' + $Entry.date + '.json')
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if (-not $raw.TrimStart().StartsWith('[')) { throw 'first-comments must be a JSON array.' }
    $decoded = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
    # The existing log is an array of slot/media_id/comment_id/created_at
    # records, often with no saved text. Never scan those metadata strings.
    foreach ($row in @($decoded)) {
        if ($null -eq $row -or $row.slot -ne $Entry.slot) { continue }
        foreach ($name in @('text', 'message', 'comment', 'comment_text')) {
            if ($row.$name -is [string]) { $row.$name }
        }
    }
}

function Get-CalendarSlot($Entry) {
    $path = Join-Path $root ('data\content-calendar\' + $Entry.date + '.json')
    $calendar = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    if ($calendar.date -cne $Entry.date) { throw 'Calendar date does not match queue.' }
    $slots = @($calendar.slots | Where-Object { $_.slot -eq $Entry.slot })
    if ($slots.Count -ne 1) { throw 'Calendar must contain exactly one matching slot.' }
    $text = @(Get-CaptionStrings $slots[0])
    if ($text.Count -eq 0 -or [string]::IsNullOrWhiteSpace(($text -join ''))) { throw 'Calendar caption text missing.' }
    return $slots[0]
}

function Get-DateTextHits($Slot, $Entry) {
    # Unicode escapes are intentional: PS 5.1 source remains ASCII only.
    $pattern = '\u4eca\u5929|\u4eca\u65e5|\u660e\u5929|\u6628\u5929|' +
        '[\u9031\u5468][\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]|' +
        '\u661f\u671f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|' +
        '[\u672c\u9019][\u9031\u5468]|' +
        '(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)|' +
        '(?<!\d)(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12]\d|3[01])(?!\d)|' +
        '(?<!\d)(?:0?[1-9]|1[0-2])\u6708(?:0?[1-9]|[12]\d|3[01])[\u65e5\u865f\u53f7]|' +
        '[\u79ae\u793c]\u62dc[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|' +
        '[\u9031\u5468]\u672b|[\u4e0a\u4e0b][\u9031\u5468]|' +
        '\u4eca[\u665a\u65e9]|\u660e[\u65e9\u665a]|[\u524d\u5f8c]\u5929|\u5341\u6708|\u842c\u8056|' +
        '(?<!\d)(?:0?[1-9]|1[0-2])\s*\uff0f\s*(?:0?[1-9]|[12]\d|3[01])(?!\d)'
    $hits = @()
    $texts = @(Get-CaptionStrings $Slot)
    $texts += @(Get-FirstCommentStrings $Entry)
    foreach ($text in $texts) {
        foreach ($match in [regex]::Matches($text, $pattern)) {
            if ($hits -cnotcontains $match.Value) { $hits += $match.Value }
        }
    }
    return $hits
}

function Invoke-BackfillNpm($Entry) {
    $command = Get-Command -Name $NpmCommand -CommandType Application, ExternalScript -ErrorAction Stop
    $path = $command.Source
    if ($path -match '["\r\n%!]' -or $path -notmatch '\.(cmd|ps1|exe)$') { throw 'Unsupported npm command path.' }
    $arguments = 'run post-current-slot -- --date {0} --slot {1} --live' -f $Entry.date, $Entry.slot
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.WorkingDirectory = $root
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.ps1' {
            $start.FileName = Join-Path $PSHOME 'powershell.exe'
            $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $path + '" ' + $arguments
        }
        '.cmd' {
            $start.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
            $start.Arguments = '/d /s /c ""' + $path + '" ' + $arguments + '"'
        }
        '.exe' { $start.FileName = $path; $start.Arguments = $arguments }
    }
    $previous = $env:ALLOW_OFF_SCHEDULE_PUBLISH
    $child = $null
    try {
        $env:ALLOW_OFF_SCHEDULE_PUBLISH = 'true'
        Write-Log ('Running npm ' + $arguments)
        $child = [Diagnostics.Process]::Start($start)
        $stdout = $child.StandardOutput.ReadToEndAsync()
        $stderr = $child.StandardError.ReadToEndAsync()
        $timedOut = -not $child.WaitForExit($NpmTimeoutSec * 1000)
        if ($timedOut) {
            # This PID was created above by this run; kill only its process tree.
            $killCode = -1
            try {
                $killOutput = & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $child.Id /T /F 2>&1 | Out-String
                $killCode = $LASTEXITCODE
            } catch { $killOutput = $_.Exception.Message }
            Write-Log ('taskkill exit_code={0}: {1}' -f $killCode, $killOutput)
            [void]$child.WaitForExit(30000)
        }
        $out = if ($stdout.Wait(30000)) { $stdout.Result } else { '[stdout not closed]' }
        $err = if ($stderr.Wait(30000)) { $stderr.Result } else { '[stderr not closed]' }
        Write-Log ('stdout:' + [Environment]::NewLine + $out)
        Write-Log ('stderr:' + [Environment]::NewLine + $err)
        if ($timedOut) {
            $killState = if ($killCode -eq 0) { 'tree killed' } else { 'tree kill unconfirmed; commander reconciliation required' }
            Write-Log ("npm timed out after ${NpmTimeoutSec}s; ${killState}; exit_code=-1.")
            return -1
        }
        Write-Log ('npm exit_code=' + $child.ExitCode)
        return $child.ExitCode
    } finally {
        $env:ALLOW_OFF_SCHEDULE_PUBLISH = $previous
        if ($null -ne $child) { $child.Dispose() }
    }
}

$entry = $null
$attemptedAt = $null
$claimed = $false
try {
    if ($Stop) {
        $queueLock = $null
        try {
            Initialize-Queue
            if (-not $DryRun) { $queueLock = Enter-QueueLock }
            $queue = @(Read-Queue)
            $pending = @($queue | Where-Object { $_.status -ceq 'pending' })
            if (-not $DryRun) {
                foreach ($item in $pending) { $item.status = 'skipped'; $item.note = 'owner stop' }
                if ($pending.Count -gt 0) { Save-Queue $queue }
            }
        } finally {
            if ($null -ne $queueLock) { $queueLock.Dispose() }
            if (-not $DryRun) {
                try {
                    Disable-ScheduledTask -TaskName 'Laundry-Backfill-1600' -ErrorAction Stop | Out-Null
                    Write-Log 'Disabled scheduled task Laundry-Backfill-1600.'
                } catch { Write-Log ('Scheduled task disable failed: ' + $_.Exception.Message) }
            }
        }
        Write-Log ('Owner stop: pending={0}; dry_run={1}' -f $pending.Count, [bool]$DryRun)
        exit 0
    }
    Initialize-Queue
    while ($true) {
        $entry = $null
        $attemptedAt = $null
        $claimed = $false
        $queue = @(Read-Queue)
        if (Test-AttemptedToday $queue) { Write-Log 'An entry was already attempted today; no action.'; exit 0 }
        $pending = @($queue | Where-Object { $_.status -ceq 'pending' })
        if ($pending.Count -eq 0) { Write-Log 'No pending backfill entries; no action.'; exit 0 }
        $entry = $pending[0]
        $state = Get-PostedState $entry
        if ($state.facebook -ceq 'success' -and $state.instagram -ceq 'success') {
            if ($DryRun) { Write-Log ('date={0} slot={1} already_success=true; no publish.' -f $entry.date, $entry.slot); exit 0 }
            # Reconciliation is not an attempt: do not consume today's allowance.
            [void](Set-QueueEntry $entry 'done' 'Both platforms already success; no publish.' $state '')
            Write-Log ('date={0} slot={1} already_success=true; continue.' -f $entry.date, $entry.slot)
            continue
        }
        $calendarSlot = Get-CalendarSlot $entry
        $dateHits = @(Get-DateTextHits -Slot $calendarSlot -Entry $entry)
        $check = if ($dateHits.Count -gt 0) { 'skip' } else { 'pass' }
        Write-Log ('date={0} slot={1} date_check={2} hits={3}' -f $entry.date, $entry.slot, $check, ($dateHits -join ', '))
        if ($DryRun) { Write-Log ('DryRun action=' + $(if ($dateHits.Count -gt 0) { 'skip' } else { 'publish' })); exit 0 }
        if ($dateHits.Count -gt 0) {
            [void](Set-QueueEntry $entry 'skipped' ('Date text: ' + ($dateHits -join ', ')) $null '')
            continue
        }
        $attemptedAt = [DateTimeOffset]::Now.ToString('o')
        if ($state.facebook -ceq 'uncertain' -or $state.instagram -ceq 'uncertain') {
            [void](Set-QueueEntry $entry 'failed' 'Existing uncertain posted-log requires commander reconciliation; no publish.' $state $attemptedAt)
            Write-Log 'Existing uncertain posted-log; no publish, no automatic retry.'
            exit 1
        }
        $mutex = $null
        $lockOwned = $false
        try {
            $library = Join-Path $root 'scripts\_pipeline-lock.ps1'
            if (Test-Path -LiteralPath $library -PathType Leaf) {
                try { . $library }
                catch { Write-Log ('Lock library load failed: ' + $_.Exception.Message); exit 1 }
                $em = Get-Command Enter-PipelineMutex -CommandType Function -ErrorAction SilentlyContinue
                $xm = Get-Command Exit-PipelineMutex -CommandType Function -ErrorAction SilentlyContinue
                if ($null -eq $em -or -not $em.Parameters.ContainsKey('TimeoutSec') -or
                    -not $em.Parameters.ContainsKey('Name') -or $null -eq $xm -or -not $xm.Parameters.ContainsKey('Mutex')) {
                    Write-Log 'A7 lock contract mismatch; no publish.'; exit 1
                }
                try { $mutex = Enter-PipelineMutex -Name 'sxj-publish' -TimeoutSec 0 }
                catch { Write-Log ('Pipeline mutex unavailable: ' + $_.Exception.Message); exit 75 }
                if ($null -eq $mutex -or $mutex -is [bool]) { Write-Log 'Pipeline mutex unavailable; exit 75, no publish.'; exit 75 }
                $lockOwned = $true
            }
            # Recheck the entire daily budget after A7 acquisition, then claim.
            $queue = @(Read-Queue)
            if (Test-AttemptedToday $queue) { Write-Log 'An entry was already attempted today after mutex; no action.'; exit 0 }
            $fresh = @($queue | Where-Object { $_.date -ceq $entry.date -and $_.slot -eq $entry.slot })
            if ($fresh.Count -ne 1 -or $fresh[0].status -cne 'pending') { Write-Log 'Selected entry no longer pending; no publish.'; exit 0 }
            $state = Get-PostedState $entry
            if ($state.facebook -ceq 'success' -and $state.instagram -ceq 'success') {
                [void](Set-QueueEntry $entry 'done' 'Both platforms already success after mutex; no publish.' $state '')
                continue
            }
            if ($state.facebook -ceq 'uncertain' -or $state.instagram -ceq 'uncertain') { throw 'posted-log became uncertain before publish.' }
            # Persist before spawning: an interrupted attempt never auto-retries.
            $attemptedAt = [DateTimeOffset]::Now.ToString('o')
            $claimed = Set-QueueEntry $entry 'failed' 'Attempt started; reconcile posted-log if interrupted. No automatic retry.' $null $attemptedAt
            if (-not $claimed) { Write-Log 'Selected entry stopped, claimed, or daily budget consumed; no publish.'; exit 0 }
            $exitCode = Invoke-BackfillNpm $entry
            $state = Get-PostedState $entry
            $result = [ordered]@{ exit_code = $exitCode; facebook = $state.facebook; instagram = $state.instagram }
            if ($exitCode -ne -1 -and $state.facebook -ceq 'success' -and $state.instagram -ceq 'success') {
                if (-not (Set-QueueEntry $entry 'done' 'Both platforms success in posted-log.' $result $attemptedAt -ExpectedStatus 'failed')) { throw 'Attempt claim changed; reconcile posted-log.' }
                Write-Log 'Backfill done: facebook=success instagram=success.'
                exit 0
            }
            $reason = 'Backfill failed: npm exit={0}; facebook={1}; instagram={2}; no automatic retry.' -f $exitCode, $state.facebook, $state.instagram
            if (-not (Set-QueueEntry $entry 'failed' $reason $result $attemptedAt -ExpectedStatus 'failed')) { throw 'Attempt claim changed; reconcile posted-log.' }
            Write-Log $reason
            exit 1
        } finally {
            if ($lockOwned) { Exit-PipelineMutex -Mutex $mutex }
        }
    }
} catch {
    $reason = Protect-LogText ('Backfill error: ' + $_.Exception.Message)
    if (-not $DryRun -and $null -ne $entry) {
        try {
            $expected = if ($claimed) { 'failed' } else { 'pending' }
            if ([string]::IsNullOrEmpty($attemptedAt)) { $attemptedAt = [DateTimeOffset]::Now.ToString('o') }
            [void](Set-QueueEntry $entry 'failed' $reason $null $attemptedAt -ExpectedStatus $expected)
        }
        catch { Write-Log ('Queue update failed: ' + $_.Exception.Message) }
    }
    Write-Log $reason
    exit 1
}
