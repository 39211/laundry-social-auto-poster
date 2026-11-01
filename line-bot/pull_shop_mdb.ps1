#requires -Version 5.1
<#
Pull the shop's password-protected Jet MDB without changing its reader/password.
-DryRun reads remote metadata only. -WhatIf performs no connection or writes.
Exit: 0 success/dry-run, 1 local/validation error, 2 locked, 3 remote failure.
A2-c: a scheduled run retries only transient results (REMOTE_UNAVAILABLE,
SOURCE_CHANGED, SCP_FAILED_OR_TIMEOUT): at most 3 attempts, 20 s apart, every
MDB ssh/scp step ending within 140 s of the run start. Each attempt writes its
own log line; the exit code is the last attempt's. -DryRun never retries.
N1: afterwards, regardless of the MDB result, fetch the shop's read-only daily
arrival-notify counts (runtime\notify_report.py, today and yesterday) and write
data\gates\notify-<date>.json. That step never changes the exit code above and
logs one JSON line {"logged_at","notify_report"} (no "ts") to the same log.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DryRun,
    [string]$Destination = 'C:\FXwash\eHank.mdb',
    [string]$LogPath = (Join-Path $env:LOCALAPPDATA 'line-bot\mdb_pull.jsonl'),
    [ValidateRange(1, 60)][int]$TimeoutSeconds = 60,
    [string]$GatesDir = '',
    [string]$ShopRoot = 'C:/LaundryStores/fxwash',
    # Shop embedded Python (same path the B2-7 deploy and tests use).
    [string]$ShopPython = 'C:\LaundryStores\python-portable\python.exe'
)

function ConvertTo-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting, including spaces and trailing slashes.
    '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Invoke-ShopProcess([string]$Program, [string[]]$Arguments, [int]$TimeoutSeconds) {
    $process = New-Object System.Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Program
        $process.StartInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Only this invocation's process object/PID, never an image-name kill.
            $process.Kill()
            $process.WaitForExit()
            return [pscustomobject]@{ Exit = 3; TimedOut = $true; Output = '' }
        }
        return [pscustomobject]@{ Exit = $process.ExitCode; TimedOut = $false; Output = $stdout.GetAwaiter().GetResult() }
    }
    finally { $process.Dispose() }
}

function Get-ShopMdbMetadata([int]$TimeoutSeconds) {
    $command = @'
$ErrorActionPreference = 'Stop'
$f = Get-Item -LiteralPath 'C:/FXwash/eHank.mdb'
if ($f.PSIsContainer) { throw 'Not a file' }
@{ bytes = $f.Length; mtime = $f.LastWriteTimeUtc.ToString('o') } | ConvertTo-Json -Compress
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $arguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
        'shop-pc', ('powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encoded))
    $reply = Invoke-ShopProcess 'ssh.exe' $arguments $TimeoutSeconds
    if ($reply.TimedOut -or $reply.Exit -ne 0) { throw 'Remote metadata unavailable' }
    $metadata = $reply.Output | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $metadata.bytes -or -not $metadata.mtime) { throw 'Missing remote metadata' }
    [pscustomobject]@{
        Bytes = [long]$metadata.bytes
        Mtime = [DateTimeOffset]::Parse($metadata.mtime).UtcDateTime
    }
}

function Test-JetMdb([string]$Path) {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        if ($stream.Length -le 10MB) { return $false }
        $header = New-Object byte[] 21
        if ($stream.Read($header, 0, $header.Length) -ne $header.Length) { return $false }
        if ([BitConverter]::ToUInt32($header, 0) -ne 256) { return $false }
        if ([Text.Encoding]::ASCII.GetString($header, 4, 16) -cne "Standard Jet DB`0") { return $false }
        if ($header[20] -notin @(0, 1)) { return $false }
        $pageSize = if ($header[20] -eq 0) { 2048 } else { 4096 }
        return ($stream.Length % $pageSize) -eq 0
    }
    finally { $stream.Dispose() }
}

function Write-MdbPullLog([string]$Path, [string]$Result, [long]$Bytes, $SourceMtime, [int]$ExitCode) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)))
    $line = [ordered]@{
        ts = [DateTimeOffset]::Now.ToString('o'); result = $Result; bytes = $Bytes
        source_mtime = $SourceMtime; exit = $ExitCode
    } | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($Path, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}

function Get-PullStepTimeout([int]$TimeoutSeconds, [scriptblock]$Clock, [double]$DeadlineAt) {
    # Per-process timeout for one MDB ssh/scp step; never runs past the run's pull deadline.
    if ($null -eq $Clock) { return $TimeoutSeconds }
    $left = [Math]::Floor($DeadlineAt - [double](& $Clock))
    if ($left -lt 1) { throw 'Pull time budget exhausted' }
    return [int][Math]::Min([double]$TimeoutSeconds, $left)
}

function Invoke-MdbPull {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([switch]$DryRun, [string]$Destination, [string]$LogPath, [int]$TimeoutSeconds = 60,
        # Optional run deadline (A2-c): $Clock returns monotonic seconds and every
        # ssh/scp step ends by $DeadlineAt. Without $Clock each step gets $TimeoutSeconds.
        [scriptblock]$Clock = $null, [double]$DeadlineAt = 0)
    # The result string of this attempt is exposed as $script:MdbPullLastResult
    # (set in finally), so the scheduled retry loop never parses the log.
    $script:MdbPullLastResult = $null
    $action = if ($DryRun) { 'Read remote MDB metadata only' } else { 'Download, validate, backup and replace MDB' }
    if (-not $PSCmdlet.ShouldProcess('shop-pc -> ' + $Destination, $action)) { return 0 }
    $ErrorActionPreference = 'Stop'
    $result = 'LOCAL_ERROR'; $code = 1; $bytes = 0; $sourceMtime = $null
    $temp = $null; $targetHandle = $null
    try {
        try { $before = Get-ShopMdbMetadata (Get-PullStepTimeout $TimeoutSeconds $Clock $DeadlineAt) }
        catch { $result = 'REMOTE_UNAVAILABLE'; $code = 3; return $code }
        $sourceMtime = $before.Mtime.ToString('o')
        if ($DryRun) { $bytes = $before.Bytes; $result = 'DRY_RUN'; $code = 0; return $code }
        $Destination = [IO.Path]::GetFullPath($Destination)
        $directory = [IO.Path]::GetDirectoryName($Destination)
        [void][IO.Directory]::CreateDirectory($directory)
        $temp = Join-Path $directory ('eHank-' + [guid]::NewGuid().ToString('N') + '.tmp')
        try {
            $reply = Invoke-ShopProcess 'scp.exe' @('-p', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                '-o', 'StrictHostKeyChecking=yes', 'shop-pc:C:/FXwash/eHank.mdb', $temp) (Get-PullStepTimeout $TimeoutSeconds $Clock $DeadlineAt)
        }
        catch { $result = 'SCP_FAILED_OR_TIMEOUT'; $code = 3; return $code }
        if ($reply.TimedOut -or $reply.Exit -ne 0) { $result = 'SCP_FAILED_OR_TIMEOUT'; $code = 3; return $code }
        if (-not [IO.File]::Exists($temp)) { $result = 'SCP_MISSING_FILE'; $code = 3; return $code }
        $bytes = (Get-Item -LiteralPath $temp).Length
        if ($bytes -ne $before.Bytes -or -not (Test-JetMdb $temp)) { $result = 'INVALID_MDB'; return $code }
        try { $after = Get-ShopMdbMetadata (Get-PullStepTimeout $TimeoutSeconds $Clock $DeadlineAt) }
        catch { $result = 'REMOTE_UNAVAILABLE'; $code = 3; return $code }
        if ($after.Bytes -ne $before.Bytes -or $after.Mtime -ne $before.Mtime) {
            $result = 'SOURCE_CHANGED'; $code = 3; return $code
        }
        [IO.File]::SetLastWriteTimeUtc($temp, $before.Mtime)
        if ([IO.File]::Exists($Destination)) {
            try {
                # Exclusive probe and backup; ReplaceFile itself needs its own handle.
                $targetHandle = [IO.File]::Open($Destination, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            }
            catch { $result = 'LOCKED'; $code = 2; return $code }
            $oldMtime = [IO.File]::GetLastWriteTimeUtc($Destination)
            $backupDir = Join-Path $directory 'backups'
            [void][IO.Directory]::CreateDirectory($backupDir)
            $backup = Join-Path $backupDir ('eHank-' + (Get-Date -Format 'yyyyMMdd-HHmm') + '.mdb')
            # CreateNew refuses a second run in the same minute, preserving that backup.
            $backupHandle = [IO.File]::Open($backup, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $targetHandle.CopyTo($backupHandle); $backupHandle.Flush($true) }
            finally { $backupHandle.Dispose() }
            [IO.File]::SetLastWriteTimeUtc($backup, $oldMtime)
            $targetHandle.Dispose(); $targetHandle = $null
            # Move-Item -Force cannot guarantee atomic overwrite on Windows PS 5.1.
            # Both files share a directory. Preserve source mtime explicitly;
            # unsupported metadata merges must not require ACL changes.
            try { [IO.File]::Replace($temp, $Destination, [NullString]::Value, $true) }
            catch [IO.IOException] {
                if (($_.Exception.HResult -band 0xffff) -in @(32, 33)) {
                    $result = 'LOCKED'; $code = 2; return $code
                }
                throw
            }
        }
        else { Move-Item -LiteralPath $temp -Destination $Destination -ErrorAction Stop }
        $temp = $null
        [IO.File]::SetLastWriteTimeUtc($Destination, $before.Mtime)
        $result = 'REPLACED'; $code = 0
        if ($targetHandle) { $targetHandle.Dispose(); $targetHandle = $null }
        $backupDir = Join-Path $directory 'backups'
        if ([IO.Directory]::Exists($backupDir)) {
            Get-ChildItem -LiteralPath $backupDir -File |
                Where-Object { $_.Name -cmatch '^eHank-\d{8}-\d{4}\.mdb$' -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
                Sort-Object Name -Descending | Select-Object -Skip 7 |
                ForEach-Object { Remove-Item -LiteralPath $_.FullName -ErrorAction Stop }
        }
        return $code
    }
    catch { Write-Verbose $_.Exception.Message; $result = 'LOCAL_OR_VALIDATION_ERROR'; $code = 1; return $code }
    finally {
        if ($targetHandle) { $targetHandle.Dispose() }
        if ($temp -and [IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
        $script:MdbPullLastResult = $result
        Write-MdbPullLog $LogPath $result $bytes $sourceMtime $code
    }
}

# ---------------------------------------------------------------------------
# N1: daily arrival-notify counts for Level-1 condition 2. Runs after the MDB
# pull regardless of its result and never changes that result or exit code.
# The outcome is one JSON line {"logged_at", "notify_report"} in the same log;
# it has no "ts" field, so level1_gates.py never counts it as a pull.
# ---------------------------------------------------------------------------

function ConvertTo-PSSingleQuoted([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }

function Get-NotifyReportDates([DateTimeOffset]$Now) {
    # Asia/Taipei is a fixed UTC+08:00 zone (no DST).
    $local = $Now.ToOffset([TimeSpan]::FromHours(8))
    $culture = [Globalization.CultureInfo]::InvariantCulture
    @($local.ToString('yyyy-MM-dd', $culture), $local.AddDays(-1).ToString('yyyy-MM-dd', $culture))
}

function New-NotifyReportCommand([string]$ShopRoot, [string]$ShopPython, [string[]]$Dates) {
    $dateArgs = (@($Dates | ForEach-Object { '--date ' + (ConvertTo-PSSingleQuoted $_) })) -join ' '
    @(
        '$ErrorActionPreference = ''Stop'''
        ('Set-Location -LiteralPath ' + (ConvertTo-PSSingleQuoted $ShopRoot))
        ('& ' + (ConvertTo-PSSingleQuoted $ShopPython) + ' -I -S -B ''runtime\notify_report.py'' --root . ' + $dateArgs)
        'exit $LASTEXITCODE'
    ) -join "`n"
}

function Invoke-NotifyReportRemote([string]$ShopRoot, [string]$ShopPython, [string[]]$Dates, [int]$TimeoutSeconds) {
    $command = New-NotifyReportCommand $ShopRoot $ShopPython $Dates
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $arguments = @('-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
        'shop-pc', ('powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encoded))
    try { $reply = Invoke-ShopProcess 'ssh.exe' $arguments $TimeoutSeconds }
    catch { throw 'notify:ssh_start_failed' }
    if ($reply.TimedOut) { throw 'notify:ssh_timeout' }
    if ($reply.Exit -ne 0) { throw ('notify:ssh_exit_' + $reply.Exit) }
    return [string]$reply.Output
}

function Get-NotifyField($Object, [string]$Name) {
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { throw ('notify:missing_' + $Name) }
    return $property.Value
}

function Get-NotifyCount($Object, [string]$Name) {
    $value = Get-NotifyField $Object $Name
    if (-not (($value -is [int] -or $value -is [long]) -and $value -ge 0)) { throw ('notify:count_' + $Name) }
    return $value
}

function Test-IsJsonObject($Value) {
    ($null -ne $Value) -and ($Value.GetType().FullName -eq 'System.Management.Automation.PSCustomObject')
}

function Test-ForbiddenNotifyContent($Node) {
    if ($null -eq $Node) { return $false }
    if ($Node -is [string]) { return ($Node -cmatch 'U[0-9a-f]{32}') }
    if ($Node -is [array]) {
        foreach ($item in $Node) { if (Test-ForbiddenNotifyContent $item) { return $true } }
        return $false
    }
    if (Test-IsJsonObject $Node) {
        foreach ($property in $Node.PSObject.Properties) {
            if (@('uid', 'dno', 'did', 'messages', 'text') -contains $property.Name) { return $true }
            if ($property.Name -cmatch 'U[0-9a-f]{32}') { return $true }
            if (Test-ForbiddenNotifyContent $property.Value) { return $true }
        }
    }
    return $false
}

function Get-ValidatedNotifyDays([string]$Text, [string[]]$Dates) {
    $text = $Text.Trim()
    if (-not $text) { throw 'notify:empty_output' }
    if ($text -cmatch 'U[0-9a-f]{32}') { throw 'notify:line_user_id_like_value' }
    try { $report = $text | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'notify:invalid_json' }
    if (-not (Test-IsJsonObject $report)) { throw 'notify:not_an_object' }
    if (Test-ForbiddenNotifyContent $report) { throw 'notify:forbidden_content' }
    if ((Get-NotifyField $report 'schema') -cne 'notify-report/v1') { throw 'notify:schema' }
    $outbox = Get-NotifyField $report 'outbox'
    # A missing outbox or skipped corrupt lines would make an unknown day look
    # like "0 wrong sends"; write nothing so Level 1 stays no_data.
    if ($outbox -ceq 'missing') { throw 'notify:outbox_missing' }
    if ($outbox -cne 'ok') { throw 'notify:outbox_state' }
    if ((Get-NotifyCount $report 'corrupt_lines') -gt 0) { throw 'notify:corrupt_lines' }
    $daysProperty = $report.PSObject.Properties['days']
    if ($null -eq $daysProperty -or $daysProperty.Value -isnot [array]) { throw 'notify:days' }
    $days = $daysProperty.Value
    if ($days.Count -ne $Dates.Count) { throw 'notify:day_count' }
    $seen = @{}
    $out = New-Object Collections.ArrayList
    foreach ($day in $days) {
        if (-not (Test-IsJsonObject $day)) { throw 'notify:day_not_object' }
        $date = Get-NotifyField $day 'date'
        if ($date -isnot [string] -or $Dates -cnotcontains $date -or $seen.ContainsKey($date)) { throw 'notify:date_mismatch' }
        $seen[$date] = $true
        $sent = Get-NotifyCount $day 'sent'
        $wrong = Get-NotifyCount $day 'wrong_sends'
        $duplicates = Get-NotifyCount $day 'duplicates'
        $abandoned = Get-NotifyCount $day 'abandoned'
        $noBinding = Get-NotifyCount $day 'no_binding'
        $pending = Get-NotifyCount $day 'pending'
        $reportedBy = Get-NotifyField $day 'reported_by'
        if ($reportedBy -isnot [string] -or -not $reportedBy.Trim()) { throw 'notify:reported_by' }
        $basis = Get-NotifyField $day 'wrong_sends_basis'
        if ($basis -isnot [string] -or -not $basis.Trim()) { throw 'notify:wrong_sends_basis' }
        $record = [ordered]@{
            date = $date; sent = $sent; wrong_sends = $wrong; reported_by = $reportedBy
            wrong_sends_basis = $basis; duplicates = $duplicates; abandoned = $abandoned
            no_binding = $noBinding; pending = $pending; fetched_at = ''
        }
        [void]$out.Add($record)
    }
    return , $out
}

function Write-NotifyGateFile([string]$Directory, [string]$Date, [string]$Json) {
    [void][IO.Directory]::CreateDirectory($Directory)
    $target = Join-Path $Directory ('notify-' + $Date + '.json')
    $temp = Join-Path $Directory ('notify-' + $Date + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temp, $Json + "`n", (New-Object Text.UTF8Encoding $false))
        if ([IO.File]::Exists($target)) { [IO.File]::Replace($temp, $target, [NullString]::Value, $true) }
        else { [IO.File]::Move($temp, $target) }
        $temp = $null
    }
    finally {
        if ($temp -and [IO.File]::Exists($temp)) { [IO.File]::Delete($temp) }
    }
}

function Write-NotifyPullLog([string]$Path, [string]$Status) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)))
    $line = [ordered]@{ logged_at = [DateTimeOffset]::Now.ToString('o'); notify_report = $Status } | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($Path, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}

function Invoke-NotifyPull {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([switch]$DryRun, [string]$LogPath, [string]$GatesDir, [string]$ShopRoot = 'C:/LaundryStores/fxwash',
        [string]$ShopPython = 'python', [int]$TimeoutSeconds = 60, [string[]]$Dates)
    if (-not $PSCmdlet.ShouldProcess('shop-pc notify_report -> ' + $GatesDir, 'Fetch daily notify counts')) { return 'SKIPPED' }
    $status = 'FAILED:error'
    try {
        $ErrorActionPreference = 'Stop'
        if ($DryRun) { $status = 'SKIPPED'; return $status }
        if (-not $Dates) { $Dates = Get-NotifyReportDates ([DateTimeOffset]::Now) }
        foreach ($d in $Dates) { if ($d -notmatch '^\d{4}-\d{2}-\d{2}\z') { throw 'notify:bad_date' } }
        if (-not $GatesDir) { throw 'notify:no_gates_dir' }
        $output = Invoke-NotifyReportRemote $ShopRoot $ShopPython $Dates $TimeoutSeconds
        $records = Get-ValidatedNotifyDays $output $Dates
        $fetchedAt = [DateTimeOffset]::Now.ToString('o')
        foreach ($record in $records) {
            $record['fetched_at'] = $fetchedAt
            Write-NotifyGateFile $GatesDir $record['date'] (ConvertTo-Json -InputObject $record -Compress)
        }
        $status = 'OK'
        return $status
    }
    catch {
        $message = [string]$_.Exception.Message
        if ($message.StartsWith('notify:')) { $reason = $message.Substring(7) }
        else { $reason = $_.Exception.GetType().Name }
        $status = 'FAILED:' + ($reason -replace '[^A-Za-z0-9_.-]', '_')
        return $status
    }
    finally {
        try { Write-NotifyPullLog $LogPath $status }
        catch { Write-Verbose ('notify_report log unavailable: ' + $_.Exception.GetType().Name) }
    }
}

# A2-c: only these results are transient (tailscale hiccup, staff writing to the
# POS database during the copy, scp failure/timeout) and worth another attempt.
function Test-TransientPullResult([string]$Result) {
    @('REMOTE_UNAVAILABLE', 'SOURCE_CHANGED', 'SCP_FAILED_OR_TIMEOUT') -ccontains $Result
}

function Invoke-ScheduledPull {
    # A2-c retry and time budget. Task Scheduler kills the run at PT4M = 240 s.
    #  - PullBudgetSeconds 140: every MDB ssh/scp step gets min(TimeoutSeconds,
    #    seconds left until start+140) and is killed at that timeout, so no MDB
    #    remote step outlives start+140 s, however many attempts ran.
    #  - After that only local validate/backup/replace (<= ~10 s) and the N1
    #    notify ssh (TimeoutSeconds 60 + ~2 s) remain, plus ~2 s of powershell
    #    start-up before $Clock starts: ~2 + 140 + 10 + 62 = 214 s < 240 s.
    #  - RetryDelaySeconds 20: lets a tailscale hiccup or a POS write burst pass.
    #  - MinAttemptSeconds 70 (slowest observed successful run): another attempt
    #    starts only if elapsed + 20 + 70 <= 140, i.e. elapsed <= 50 s.
    #  - MaxAttempts 3. Typical: REMOTE_UNAVAILABLE at ~13 s -> attempt 2 at ~33 s
    #    -> if unreachable again at ~46 s -> attempt 3 at ~66 s with 74 s left.
    # Tests inject $Clock (seconds) and $Sleep so nothing sleeps for real.
    param([switch]$DryRun, [string]$Destination, [string]$LogPath, [int]$TimeoutSeconds = 60,
        [string]$GatesDir, [string]$ShopRoot, [string]$ShopPython, [string[]]$NotifyDates,
        [ValidateRange(1, 5)][int]$MaxAttempts = 3, [ValidateRange(0, 60)][int]$RetryDelaySeconds = 20,
        [ValidateRange(1, 150)][int]$PullBudgetSeconds = 140, [ValidateRange(0, 150)][int]$MinAttemptSeconds = 70,
        [scriptblock]$Clock = $null, [scriptblock]$Sleep = $null)
    if ($null -eq $Clock) {
        $Clock = { [Diagnostics.Stopwatch]::GetTimestamp() / [double][Diagnostics.Stopwatch]::Frequency }
    }
    $startedAt = [double](& $Clock)
    $deadlineAt = $startedAt + $PullBudgetSeconds
    $code = $null
    try {
        $attempt = 0
        while ($true) {
            $attempt++
            $script:MdbPullLastResult = $null
            $code = Invoke-MdbPull -DryRun:$DryRun -Destination $Destination -LogPath $LogPath -TimeoutSeconds $TimeoutSeconds -Clock $Clock -DeadlineAt $deadlineAt
            $lastResult = $script:MdbPullLastResult
            if ($DryRun -or $attempt -ge $MaxAttempts -or -not (Test-TransientPullResult $lastResult)) { break }
            $elapsed = [double](& $Clock) - $startedAt
            if ($elapsed + $RetryDelaySeconds + $MinAttemptSeconds -gt $PullBudgetSeconds) { break }
            Write-Verbose ('MDB pull attempt ' + $attempt + ' result ' + $lastResult + '; retrying in ' + $RetryDelaySeconds + ' s')
            if ($RetryDelaySeconds -gt 0) {
                if ($null -ne $Sleep) { $null = & $Sleep $RetryDelaySeconds }
                else { Start-Sleep -Seconds $RetryDelaySeconds }
            }
        }
    }
    finally {
        $notifyArgs = @{
            DryRun = [bool]$DryRun; LogPath = $LogPath; GatesDir = $GatesDir; ShopRoot = $ShopRoot
            ShopPython = $ShopPython; TimeoutSeconds = $TimeoutSeconds; Dates = $NotifyDates
        }
        try { $null = Invoke-NotifyPull @notifyArgs }
        catch { Write-Verbose ('notify_report step error: ' + $_.Exception.GetType().Name) }
    }
    return $code
}

if (-not $GatesDir) { $GatesDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'data\gates' }
exit (Invoke-ScheduledPull -DryRun:$DryRun -Destination $Destination -LogPath $LogPath -TimeoutSeconds $TimeoutSeconds -GatesDir $GatesDir -ShopRoot $ShopRoot -ShopPython $ShopPython)
