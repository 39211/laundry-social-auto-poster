#requires -Version 5.1
<# A8 preparation artifact, revised by A8-2. Running this file without -DryRun performs a deployment.
   Dot-sourcing only defines functions. No service or scheduler action occurs on import.
   DryRun writes nothing (including no log). Task registration is opt-in.
   A8-2 changes (2026-10-30 production failures):
   - Target normalization: the live tree is always operated through the junction
     C:\Users\cyc39\laundry-repo. Any other Target containing whitespace is refused.
   - Start goes through Start-ScheduledTask Laundry-LINE-Bot (detached, production path);
     readiness is polled with run_line_bot.ps1 -Probe every 10 s for up to 180 s.
   - Invoke-AiNative never blocks on grandchildren holding inherited pipe handles.
   - Stop waits for a tick-safe window of the Laundry-LINE-Bot task (never disables it).
   - Each offline test command gets one automatic retry.
   - Rollback logs a WARNING about old tunnel_manager daytime webhook PUTs.
   - Time budget raised from 210 s to 480 s (Start via the task takes ~30-40 s for the
     processes plus ~60-90 s for healthz). The budget is re-armed after each tick-safe
     wait, which is bounded separately (300 s max). #>
[CmdletBinding()]
param(
    [string]$Source,
    [string]$Target,
    [switch]$DryRun,
    [string]$Rollback,
    [switch]$RegisterTasks
)

function ConvertTo-AiNativeArgument {
    param([AllowEmptyString()][string]$Value)
    # Windows argv quoting, not shell quoting; no cmd.exe or expression evaluation.
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
    return '"' + $escaped + '"'
}

function Invoke-AiNative {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 90, [int]$DrainSeconds = 5)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $FilePath
    $info.Arguments = (@($Arguments | ForEach-Object { ConvertTo-AiNativeArgument $_ }) -join ' ')
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'Native helper did not start.' }
        $hardUntil = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        # A8-2: chunked reads pumped from this thread with bounded waits. A grandchild that
        # inherited the pipe handles can keep the pipe open forever; after the direct child
        # exits we drain for at most $DrainSeconds and then return what was read so far.
        $readers = @($process.StandardOutput, $process.StandardError)
        $buffers = @((New-Object char[] 4096), (New-Object char[] 4096))
        $text = @((New-Object Text.StringBuilder), (New-Object Text.StringBuilder))
        $pending = @($readers[0].ReadAsync($buffers[0], 0, 4096), $readers[1].ReadAsync($buffers[1], 0, 4096))
        $done = @($false, $false)
        $drainUntil = $null
        while (-not ($done[0] -and $done[1])) {
            $now = [DateTime]::UtcNow
            if ($null -eq $drainUntil -and $process.HasExited) { $drainUntil = $now.AddSeconds($DrainSeconds) }
            $until = $hardUntil
            if ($null -ne $drainUntil) { $until = $drainUntil }
            $left = ($until - $now).TotalMilliseconds
            if ($left -le 0) { break }
            $active = @()
            $waitTasks = @()
            for ($i = 0; $i -lt 2; $i++) {
                if (-not $done[$i]) { $active += $i; $waitTasks += $pending[$i] }
            }
            $index = [Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]$waitTasks, [int][Math]::Min($left, 250))
            if ($index -lt 0) { continue }
            $slot = $active[$index]
            $readTask = $pending[$slot]
            if ($readTask.IsFaulted -or $readTask.IsCanceled) { $done[$slot] = $true; continue }
            $count = [int]$readTask.Result
            if ($count -le 0) {
                $done[$slot] = $true
            } else {
                [void]$text[$slot].Append($buffers[$slot], 0, $count)
                $pending[$slot] = $readers[$slot].ReadAsync($buffers[$slot], 0, 4096)
            }
        }
        if (-not $process.HasExited) {
            $remaining = [int][Math]::Max(0, ($hardUntil - [DateTime]::UtcNow).TotalMilliseconds)
            if (-not $process.WaitForExit($remaining)) {
                # Only the exact child created here, never an image-name sweep.
                try { $process.Kill() } catch { }
                [void]$process.WaitForExit(5000)
                throw 'Native helper timed out; deployment cannot continue.'
            }
        }
        $truncated = -not ($done[0] -and $done[1])
        if (-not $truncated) {
            foreach ($reader in $readers) { try { $reader.Dispose() } catch { } }
        }
        # Pending reads on a truncated pipe are left to finish on the thread pool when the
        # grandchild exits; Process.Dispose does not close the redirected readers.
        if ($truncated) { Write-Host 'Native helper output truncated (inherited handles).' }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = ($text[0].ToString() + $text[1].ToString()).Trim(); Truncated = $truncated }
    } finally { $process.Dispose() }
}

function Invoke-AiGit {
    param([string]$Root, [string[]]$Arguments)
    # status must not refresh/write the target's index during preflight/DryRun.
    $result = Invoke-AiNative -FilePath 'git.exe' -WorkingDirectory $Root `
        -Arguments (@('--no-optional-locks', '-c', 'core.quotepath=false', '-C', $Root) + $Arguments)
    if ($result.ExitCode -ne 0) { throw ('Git read failed: ' + ($Arguments -join ' ')) }
    return $result.Output
}

function Get-AiBackupRoot {
    foreach ($path in @('D:\C-moved', 'D:\AI-Lanes-work')) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw ('Required D: directory is missing: ' + $path) }
    }
    if ((New-Object IO.DriveInfo('C')).AvailableFreeSpace -lt 1GB) { throw 'C: has less than 1 GB free; deployment writes are blocked.' }
    return 'D:\AI-Lanes-work\_backups\ai-linebot'
}

function Get-AiPythonPath {
    return 'C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe'
}

function Get-AiLiveTargetMap {
    # The live checkout and its documented junction (same tree). Junction has no spaces.
    return [pscustomobject]@{
        Junction = 'C:\Users\cyc39\laundry-repo'
        Aliases  = @('C:\Users\cyc39\laundry-repo', 'C:\Users\cyc39\Documents\New project 5')
    }
}

function Get-AiRoot {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) { throw ('Directory does not exist: ' + $Path) }
    return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).ProviderPath).TrimEnd('\', '/')
}

function Resolve-AiTarget {
    param([string]$Path)
    # Detection: (1) the fully resolved Target equals one of the known live roots
    # (case-insensitive), or (2) it equals the link target read from the junction itself.
    $root = Get-AiRoot $Path
    $map = Get-AiLiveTargetMap
    $junction = ([string]$map.Junction).TrimEnd('\', '/')
    $aliases = @($map.Aliases | ForEach-Object { ([string]$_).TrimEnd('\', '/') })
    $isLive = $aliases -contains $root
    if (-not $isLive -and (Test-Path -LiteralPath $junction -PathType Container)) {
        try {
            $link = @((Get-Item -LiteralPath $junction -Force).Target)[0]
            if ($link) {
                $linkFull = [IO.Path]::GetFullPath([string]$link).TrimEnd('\', '/')
                if ($linkFull -eq $root) { $isLive = $true }
            }
        } catch { }
    }
    if ($isLive) {
        if (-not (Test-Path -LiteralPath $junction -PathType Container)) {
            throw ('Target is the live tree but the junction ' + $junction + ' is missing; refusing to operate on a path with spaces.')
        }
        return [pscustomobject]@{ Requested = $root; Root = $junction; Live = $true }
    }
    if ($root -match '\s') {
        throw ('Target contains whitespace and is not the live tree: ' + $root + '. run_line_bot.ps1 builds python command lines from this path; use a path without spaces or the junction ' + $junction + '.')
    }
    return [pscustomobject]@{ Requested = $root; Root = $root; Live = $false }
}

function Test-AiSameTarget {
    param([string]$First, [string]$Second)
    $a = ([string]$First).TrimEnd('\', '/')
    $b = ([string]$Second).TrimEnd('\', '/')
    if ([string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $aliases = @((Get-AiLiveTargetMap).Aliases | ForEach-Object { ([string]$_).TrimEnd('\', '/') })
    return (($aliases -contains $a) -and ($aliases -contains $b))
}

function Get-AiPayloadPath {
    param([string]$Root, [string]$Relative)
    if ($Relative -notmatch '^line-bot/' -or $Relative -match '[\\:*?"<>|]' -or
        @($Relative.Split('/') | Where-Object { $_ -in @('', '.', '..') -or $_ -ne $_.TrimEnd(' ', '.') }).Count -gt 0) {
        throw ('Unsafe payload path: ' + $Relative)
    }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $full.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Payload escapes its root.' }
    # Root may be the documented laundry-repo junction. No nested junction/link
    # may redirect a copy or an absent-before-deploy rollback deletion elsewhere.
    $current = $Root
    foreach ($part in $Relative.Split('/')) {
        $current = Join-Path $current $part
        if (Test-Path -LiteralPath $current) {
            if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw ('Nested reparse point is not allowed: ' + $current)
            }
        }
    }
    return $full
}

function Get-AiSha {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash
}

function Write-AiDeployLog {
    param([hashtable]$Context, [string]$Message)
    $safe = $Message -replace '(?i)(Bearer\s+)\S+', '$1[REDACTED]'
    $safe = $safe -replace '(?i)((?:--token|access_token|channel_token|password)\s*[=: ]\s*)\S+', '$1[REDACTED]'
    $line = [DateTimeOffset]::Now.ToString('o') + ' ' + $safe
    Write-Host $line
    if ($Context.Log) { Add-Content -LiteralPath $Context.Log -Value $line -Encoding UTF8 -ErrorAction Stop }
}

function Get-AiDeployPlan {
    param([string]$SourceRoot, [string]$TargetRoot, [hashtable]$Context)
    if (Test-AiSameTarget $SourceRoot $TargetRoot) { throw 'Source and Target must be different trees.' }
    $head = (Invoke-AiGit $SourceRoot @('rev-parse', 'HEAD')).Trim()
    if ($head -notmatch '^[0-9a-fA-F]{40}$') { throw 'Invalid source HEAD.' }
    Write-AiDeployLog $Context ('Source HEAD: ' + $head)
    $integration = (Invoke-AiGit $SourceRoot @('rev-parse', 'integration/20261030')).Trim()
    if ($head -ne $integration) { throw 'Source HEAD must match integration/20261030.' }
    # This exact revision diff is the authority for the payload, including docs,
    # tests and evidence. Deleted/missing source files fail rather than disappear.
    $raw = Invoke-AiGit $SourceRoot @('diff', '--name-only', 'release/sxj-live-2026-10..integration/20261030', '--', 'line-bot/')
    $paths = @($raw -split "`r?`n" | Where-Object { $_ })
    if ($paths.Count -eq 0) { throw 'The release-to-integration payload is empty.' }
    if (@($paths | Sort-Object -Unique).Count -ne $paths.Count) { throw 'Duplicate payload paths.' }
    $status = Invoke-AiGit $TargetRoot @('status', '--porcelain=v1', '--untracked-files=all', '--', 'line-bot/')
    $runtimeState = @('line-bot/public_base.txt', 'line-bot/richmenu-id.txt')  # tunnel/richmenu runtime state, always dirty on a live target
    $dirty = @($status -split "`r?`n" | Where-Object {
        if (-not $_) { return $false }
        $p = ($_ -replace '^\s*\S{1,2}\s+', '').Trim('"')   # native helper may trim the leading status column
        (-not ($runtimeState -contains $p)) -and (-not $_.TrimStart().StartsWith('?? ') -or $p -match '\.(py|ps1|psm1|psd1|vbs|json|cmd|bat|ya?ml|toml|ini|cfg|md)$' -or $paths -contains $p)
    })
    if ($dirty.Count -gt 0) { throw ("Target has uncommitted line-bot changes:`n" + ($dirty -join "`n")) }
    $files = @(foreach ($relative in $paths) {
        $from = Get-AiPayloadPath $SourceRoot $relative
        $to = Get-AiPayloadPath $TargetRoot $relative
        if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw ('Source payload is missing: ' + $relative) }
        if ((Test-Path -LiteralPath $to) -and -not (Test-Path -LiteralPath $to -PathType Leaf)) { throw ('Target payload is not a file: ' + $relative) }
        $existed = Test-Path -LiteralPath $to -PathType Leaf
        [pscustomobject]@{ Path = $relative; SourceSha256 = (Get-AiSha $from); Existed = $existed;
            BackupSha256 = $(if ($existed) { Get-AiSha $to } else { $null }) }
    })
    return [pscustomobject]@{ Schema = 1; SourceHead = $head; Source = $SourceRoot; Target = $TargetRoot; Files = $files }
}

function Get-AiTargetProcesses {
    param([string]$TargetRoot)
    $roots = @((Join-Path $TargetRoot 'line-bot').TrimEnd('\') + '\')
    if ($TargetRoot -in @('C:\Users\cyc39\laundry-repo', 'C:\Users\cyc39\Documents\New project 5')) {
        $roots += @('C:\Users\cyc39\laundry-repo\line-bot\', 'C:\Users\cyc39\Documents\New project 5\line-bot\')
    }
    return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Where-Object {
        $row = $_
        $cmd = ([string]$row.CommandLine).Replace('/', '\')
        $scoped = @($roots | Where-Object { $cmd.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
        $row.ProcessId -ne $PID -and $row.Name -match '^(python(?:w|[0-9.]*)?|cloudflared)\.exe$' -and $scoped
    })
}

function Get-AiRemainingSeconds {
    param([hashtable]$Context)
    $seconds = [int][Math]::Floor(($Context.Deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
    if ($seconds -lt 1) { throw 'Deployment time budget exhausted; recovery is required.' }
    return $seconds
}

function Write-AiNativeResult {
    param([hashtable]$Context, [string]$Label, $Result)
    Write-AiDeployLog $Context ($Label + ' exit=' + $Result.ExitCode)
    if ($Result.Truncated) { Write-AiDeployLog $Context ($Label + ': output truncated (inherited handles)') }
    if ($Result.Output) { Write-AiDeployLog $Context $Result.Output }
}

function Invoke-AiCheckedNative {
    param([hashtable]$Context, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Label)
    $seconds = Get-AiRemainingSeconds $Context
    Write-AiDeployLog $Context ('RUN ' + $Label)
    $result = Invoke-AiNative -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory -TimeoutSeconds ([Math]::Min(90, $seconds))
    Write-AiNativeResult $Context $Label $result
    if ($result.ExitCode -ne 0) { throw ($Label + ' failed (exit ' + $result.ExitCode + ').') }
    return $result.Output
}

function Invoke-AiOfflineTest {
    param([hashtable]$Context, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Label)
    # One automatic retry on non-zero exit (transient Windows PermissionError on os.replace).
    $lastExit = $null
    foreach ($attempt in 1..2) {
        $seconds = Get-AiRemainingSeconds $Context
        $attemptLabel = $Label + ' attempt ' + $attempt + '/2'
        Write-AiDeployLog $Context ('RUN ' + $attemptLabel)
        $result = Invoke-AiNative -FilePath $Context.Python -Arguments $Arguments -WorkingDirectory $WorkingDirectory -TimeoutSeconds ([Math]::Min(90, $seconds))
        Write-AiNativeResult $Context $attemptLabel $result
        if ($result.ExitCode -eq 0) {
            if ($attempt -gt 1) { Write-AiDeployLog $Context ($Label + ' passed on retry; first failure treated as transient.') }
            return $result.Output
        }
        $lastExit = $result.ExitCode
        if ($attempt -eq 1) { Write-AiDeployLog $Context ('RETRY ' + $Label + ': first attempt exit=' + $lastExit + '; one automatic retry.') }
    }
    throw ($Label + ' failed on both attempts (last exit ' + $lastExit + ').')
}

function Invoke-AiBotControl {
    param([hashtable]$Context, [ValidateSet('Stop', 'Probe')][string]$Mode)
    # Start never runs run_line_bot.ps1 directly (its daemons inherit pipe handles);
    # see Start-AiBotTask.
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Context.Target 'line-bot/run_line_bot.ps1'), ('-' + $Mode))
    $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $null = Invoke-AiCheckedNative $Context $shell $arguments $Context.Target ('bot ' + $Mode)
}

function Invoke-AiBotProbeOnce {
    param([hashtable]$Context, [int]$Attempt)
    $seconds = Get-AiRemainingSeconds $Context
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Context.Target 'line-bot/run_line_bot.ps1'), '-Probe')
    $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $label = 'bot Probe attempt ' + $Attempt
    Write-AiDeployLog $Context ('RUN ' + $label)
    $result = Invoke-AiNative -FilePath $shell -Arguments $arguments -WorkingDirectory $Context.Target -TimeoutSeconds ([Math]::Min(90, $seconds))
    Write-AiNativeResult $Context $label $result
    return [int]$result.ExitCode
}

function Get-AiTickWindowDecision {
    # Pure: no clock, scheduler or process access. All inputs are injected.
    param(
        [Parameter(Mandatory = $true)][DateTime]$Now,
        [object]$LastRunTime,
        [object]$NextRunTime,
        [string]$State,
        [bool]$ControlScriptRunning = $false,
        [int]$MinSinceLastSeconds = 20,
        [int]$MinUntilNextSeconds = 150,
        [int]$PollSeconds = 5
    )
    $since = $null
    if ($null -ne $LastRunTime -and ([DateTime]$LastRunTime) -gt [DateTime]::MinValue) { $since = ($Now - [DateTime]$LastRunTime).TotalSeconds }
    $until = $null
    if ($null -ne $NextRunTime -and ([DateTime]$NextRunTime) -gt [DateTime]::MinValue) { $until = ([DateTime]$NextRunTime - $Now).TotalSeconds }
    $action = 'Proceed'
    $wait = 0
    $reason = 'tick-safe window'
    if ($State -eq 'Running') {
        $action = 'WaitRunning'; $wait = $PollSeconds; $reason = 'a Laundry-LINE-Bot tick is running'
    } elseif ($State -ne 'Ready') {
        $action = 'WaitState'; $wait = $PollSeconds; $reason = ('task state is ' + $State + ', waiting for Ready')
    } elseif ($ControlScriptRunning) {
        $action = 'WaitScript'; $wait = $PollSeconds; $reason = 'a detached run_line_bot.ps1 start pass is still running'
    } elseif ($null -ne $since -and $since -lt $MinSinceLastSeconds) {
        $action = 'WaitLastRun'; $wait = [int][Math]::Ceiling($MinSinceLastSeconds - $since)
        $reason = ('last run only ' + [int][Math]::Floor($since) + ' s ago (< ' + $MinSinceLastSeconds + ' s)')
    } elseif ($null -ne $until -and $until -lt $MinUntilNextSeconds) {
        $action = 'WaitNextTick'
        if ($until -le 0) { $wait = $PollSeconds } else { $wait = [int][Math]::Ceiling($until) + 2 }
        $reason = ('next tick in ' + [int][Math]::Floor($until) + ' s (< ' + $MinUntilNextSeconds + ' s); sleeping until just after it starts')
    }
    if ($action -ne 'Proceed') { $wait = [int][Math]::Max(1, [Math]::Min($wait, $MinUntilNextSeconds + 10)) }
    return [pscustomobject]@{
        Action = $action
        WaitSeconds = [int]$wait
        State = $State
        SecondsSinceLast = $(if ($null -ne $since) { [int][Math]::Floor($since) } else { $null })
        SecondsUntilNext = $(if ($null -ne $until) { [int][Math]::Floor($until) } else { $null })
        Reason = $reason
    }
}

function Format-AiTickDecision {
    param($Decision)
    $sinceText = 'n/a'
    if ($null -ne $Decision.SecondsSinceLast) { $sinceText = [string]$Decision.SecondsSinceLast + 's' }
    $untilText = 'n/a'
    if ($null -ne $Decision.SecondsUntilNext) { $untilText = [string]$Decision.SecondsUntilNext + 's' }
    return ('state=' + $Decision.State + ' action=' + $Decision.Action + ' last_run_age=' + $sinceText +
        ' next_run_in=' + $untilText + ' wait=' + $Decision.WaitSeconds + 's reason=' + $Decision.Reason)
}

function Get-AiTickState {
    param([string]$TaskName = 'Laundry-LINE-Bot')
    # Read-only scheduler and process queries; safe in DryRun.
    $tasks = @(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
    if ($tasks.Count -eq 0) {
        return [pscustomobject]@{ Exists = $false; State = 'Missing'; LastRunTime = $null; NextRunTime = $null; ControlScriptRunning = $false }
    }
    if ($tasks.Count -gt 1) { throw ('More than one scheduled task is named ' + $TaskName + '.') }
    $info = Get-ScheduledTaskInfo -InputObject $tasks[0] -ErrorAction Stop
    # The vbs may return before the detached run_line_bot.ps1 finishes, so also look
    # for a start pass (not -Stop/-Probe) that is still running.
    $scriptRunning = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Where-Object {
        $cmd = [string]$_.CommandLine
        $_.ProcessId -ne $PID -and $_.Name -match '^(powershell|pwsh)\.exe$' -and
            $cmd.IndexOf('run_line_bot.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $cmd -notmatch '(?i)\s-(Stop|Probe)\b'
    }).Count -gt 0
    return [pscustomobject]@{ Exists = $true; State = [string]$tasks[0].State; LastRunTime = $info.LastRunTime;
        NextRunTime = $info.NextRunTime; ControlScriptRunning = $scriptRunning }
}

function Wait-AiTickWindow {
    param([hashtable]$Context, [int]$MaxWaitSeconds = 300)
    # Never disables the task (a watchdog re-enables Laundry-* tasks).
    $limit = [DateTimeOffset]::UtcNow.AddSeconds($MaxWaitSeconds)
    for ($i = 0; $i -lt 120; $i++) {
        $tick = Get-AiTickState
        if (-not $tick.Exists) { throw 'Scheduled task Laundry-LINE-Bot was not found; cannot choose a tick-safe window.' }
        $decision = Get-AiTickWindowDecision -Now (Get-Date) -LastRunTime $tick.LastRunTime -NextRunTime $tick.NextRunTime `
            -State $tick.State -ControlScriptRunning ([bool]$tick.ControlScriptRunning)
        if ($decision.Action -eq 'Proceed') {
            Write-AiDeployLog $Context ('TICK WINDOW chosen: ' + (Format-AiTickDecision $decision))
            # The deployment budget covers work after the window; the wait is bounded separately.
            $Context.Deadline = [DateTimeOffset]::UtcNow.AddSeconds($Context.BudgetSeconds)
            return $decision
        }
        if ([DateTimeOffset]::UtcNow.AddSeconds($decision.WaitSeconds) -gt $limit) {
            throw ('No tick-safe window within ' + $MaxWaitSeconds + ' s: ' + (Format-AiTickDecision $decision))
        }
        Write-AiDeployLog $Context ('TICK WAIT ' + (Format-AiTickDecision $decision))
        Start-Sleep -Seconds $decision.WaitSeconds
    }
    throw 'No tick-safe window after the maximum number of polls.'
}

function Start-AiBotTask {
    param([hashtable]$Context)
    $junction = ([string](Get-AiLiveTargetMap).Junction).TrimEnd('\', '/')
    if (-not [string]::Equals($Context.Target, $junction, [StringComparison]::OrdinalIgnoreCase)) {
        throw ('Start via Laundry-LINE-Bot is only valid for the live junction target ' + $junction + '.')
    }
    Write-AiDeployLog $Context 'RUN bot Start via Start-ScheduledTask Laundry-LINE-Bot (detached production path)'
    Start-ScheduledTask -TaskName 'Laundry-LINE-Bot' -ErrorAction Stop
}

function Stop-AiBot {
    param([hashtable]$Context)
    Invoke-AiBotControl $Context 'Stop'
    $snapshot = @(Get-AiTargetProcesses $Context.Target)
    foreach ($row in $snapshot) {
        Write-AiDeployLog $Context ('STOP candidate pid=' + $row.ProcessId + ' name=' + $row.Name + ' target=' + $Context.Target)
        # Recheck identity immediately before stopping to avoid a recycled PID.
        $current = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [int]$row.ProcessId) -ErrorAction Stop)
        if ($current.Count -eq 0) { continue }
        if ($current.Count -ne 1 -or $current[0].CommandLine -ne $row.CommandLine -or $current[0].CreationDate -ne $row.CreationDate) {
            throw ('Process identity changed: ' + $row.ProcessId)
        }
        Stop-Process -Id ([int]$row.ProcessId) -Force -ErrorAction Stop
    }
    Start-Sleep -Seconds 3
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in @(8791, 8792) })
    if ($listeners.Count -gt 0) { throw ('Bot port still has a listener: ' + (($listeners | ForEach-Object { [string]$_.LocalPort + '/pid=' + $_.OwningProcess }) -join ', ')) }
    if (@(Get-AiTargetProcesses $Context.Target).Count -gt 0) { throw 'Scoped bot processes remain after stop.' }
    Write-AiDeployLog $Context 'STOP verified: ports 8791/8792 free and scoped processes absent.'
}

function New-AiBackup {
    param([hashtable]$Context, $Plan)
    $backup = Join-Path $Context.BackupRoot $Context.Stamp
    if (Test-Path -LiteralPath $backup) { throw 'Backup directory already exists.' }
    [void](New-Item -ItemType Directory -Path $backup -ErrorAction Stop)
    foreach ($file in $Plan.Files) {
        if (-not $file.Existed) { continue }
        $original = Get-AiPayloadPath $Context.Target $file.Path
        if ((Get-AiSha $original) -ne $file.BackupSha256) { throw ('Target changed after preflight: ' + $file.Path) }
        $saved = Get-AiPayloadPath (Join-Path $backup 'payload') $file.Path
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $saved))
        Copy-Item -LiteralPath $original -Destination $saved -ErrorAction Stop
        if ((Get-AiSha $saved) -ne $file.BackupSha256) { throw ('Backup SHA mismatch: ' + $file.Path) }
        Write-AiDeployLog $Context ('BACKUP ' + $file.Path + ' sha256=' + $file.BackupSha256)
    }
    $Plan | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $backup 'MANIFEST.json') -Encoding UTF8 -ErrorAction Stop
    Write-AiDeployLog $Context ('MANIFEST ' + (Join-Path $backup 'MANIFEST.json'))
    return $backup
}

function Read-AiBackup {
    param([hashtable]$Context, [string]$Backup)
    $root = Get-AiRoot $Backup
    if (-not $root.StartsWith($Context.BackupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback directory must be inside the ai-linebot backup root.' }
    if (((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Backup directory is a reparse point.' }
    $manifest = Get-Content -LiteralPath (Join-Path $root 'MANIFEST.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    # A manifest written against either live alias binds to the same live tree.
    if ($manifest.Schema -ne 1 -or -not (Test-AiSameTarget ([string]$manifest.Target) $Context.Target) -or @($manifest.Files).Count -eq 0) { throw 'Backup manifest schema/target/files do not match.' }
    $seen = @{}
    foreach ($file in $manifest.Files) {
        $null = Get-AiPayloadPath $Context.Target $file.Path
        $saved = Get-AiPayloadPath (Join-Path $root 'payload') $file.Path
        if ($seen.ContainsKey($file.Path) -or $file.Existed -isnot [bool] -or $file.SourceSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid or duplicate backup entry.' }
        $seen[$file.Path] = $true
        if ($file.Existed) {
            if ($file.BackupSha256 -notmatch '^[A-Fa-f0-9]{64}$' -or (Get-AiSha $saved) -ne $file.BackupSha256) { throw ('Backup SHA mismatch: ' + $file.Path) }
        } elseif ($file.BackupSha256) { throw 'Absent-before-deploy entry has an unexpected backup SHA.' }
    }
    return [pscustomobject]@{ Root = $root; Manifest = $manifest }
}

function Copy-AiPayload {
    param([hashtable]$Context, $Plan)
    foreach ($file in $Plan.Files) {
        $from = Get-AiPayloadPath $Plan.Source $file.Path
        $to = Get-AiPayloadPath $Context.Target $file.Path
        if ((Get-AiSha $from) -ne $file.SourceSha256) { throw ('Source changed after preflight: ' + $file.Path) }
        $exists = Test-Path -LiteralPath $to -PathType Leaf
        if ($exists -ne $file.Existed -or ($exists -and (Get-AiSha $to) -ne $file.BackupSha256)) { throw ('Target changed after backup: ' + $file.Path) }
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $to))
        Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop
        if ((Get-AiSha $to) -ne $file.SourceSha256) { throw ('Copied SHA mismatch: ' + $file.Path) }
        Write-AiDeployLog $Context ('COPY ' + $file.Path + ' sha256=' + $file.SourceSha256)
    }
}

# A8-3 (10/31): the PID file holds the venv launcher (python.exe in venv\Scripts) while /healthz
# reports the interpreter child it spawns, so exact equality failed every real Start. Accept the
# tracked pid itself or a process whose parent chain reaches it within 3 hops (run_line_bot.ps1 P1).
$script:AiParentOf = {
    param([int]$ProcessId)
    $row = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + $ProcessId) -ErrorAction SilentlyContinue)
    if ($row.Count -eq 1 -and $row[0].ParentProcessId) { return [int]$row[0].ParentProcessId }
    return 0
}

function Test-AiHealthzPidLineage {
    param([int]$ReportedPid, [int]$TrackedPid, [scriptblock]$ParentOf)
    if ($ReportedPid -le 0 -or $TrackedPid -le 0) { return $false }
    $current = $ReportedPid
    for ($hop = 0; $hop -le 3; $hop++) {
        if ($current -eq $TrackedPid) { return $true }
        $parent = [int](& $ParentOf $current)
        if ($parent -le 0 -or $parent -eq $current) { return $false }
        $current = $parent
    }
    return $false
}

function Start-AiBotAndProbe {
    param([hashtable]$Context, [int]$PollSeconds = 10, [int]$WindowSeconds = 180)
    Start-AiBotTask $Context
    $begun = [DateTimeOffset]::UtcNow
    $maxAttempts = [int][Math]::Ceiling($WindowSeconds / [double]$PollSeconds)
    $attempt = 0
    $ready = $false
    while ($attempt -lt $maxAttempts) {
        $attempt++
        Start-Sleep -Seconds $PollSeconds
        if ((Invoke-AiBotProbeOnce $Context $attempt) -eq 0) { $ready = $true; break }
        if (([DateTimeOffset]::UtcNow - $begun).TotalSeconds -ge $WindowSeconds) { break }
    }
    if (-not $ready) { throw ('bot Probe did not succeed within ' + $WindowSeconds + ' s after Start-ScheduledTask (' + $attempt + ' attempts).') }
    Write-AiDeployLog $Context ('bot Probe succeeded on attempt ' + $attempt + '.')
    $pidPath = Join-Path $env:LOCALAPPDATA 'line-bot/line_webhook.pid'
    $raw = (Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8 -ErrorAction Stop).Trim()
    $trackedId = 0
    if (-not [int]::TryParse($raw, [ref]$trackedId) -or $trackedId -le 0) { throw 'Invalid new line_webhook PID file.' }
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8791/healthz' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -ne 200 -or ([string]$response.Content).Trim() -notmatch '^ok ([0-9]+)$') { throw 'Invalid healthz status/body.' }
    $reportedId = [int]$Matches[1]
    if (-not (Test-AiHealthzPidLineage -ReportedPid $reportedId -TrackedPid $trackedId -ParentOf $script:AiParentOf)) {
        throw ('healthz PID ' + $reportedId + ' is neither the new PID file ' + $trackedId + ' nor its descendant (A8-3).')
    }
    Write-AiDeployLog $Context ('PROBE verified: healthz ok ' + $reportedId + ' is PID file ' + $trackedId + ' or its descendant.')
}

function Restore-AiBackup {
    param([hashtable]$Context, [string]$Backup, [switch]$ProtectCurrent)
    # Validate every backup byte and every destination before the first stop.
    $checked = Read-AiBackup $Context $Backup
    if ($ProtectCurrent) {
        foreach ($file in $checked.Manifest.Files) {
            $current = Get-AiPayloadPath $Context.Target $file.Path
            if (Test-Path -LiteralPath $current -PathType Leaf) {
                $currentSha = Get-AiSha $current
                if ($currentSha -ne $file.SourceSha256 -and $currentSha -ne $file.BackupSha256) {
                    throw ('Rollback would overwrite a later local edit: ' + $file.Path)
                }
            } elseif ($file.Existed -or (Test-Path -LiteralPath $current)) {
                throw ('Rollback target changed unexpectedly: ' + $file.Path)
            }
        }
    }
    Write-AiDeployLog $Context 'WARNING rollback: an old tunnel_manager restarted during the day may PUT its own URL to the LINE webhook endpoint and take it from the shop PC; check the LINE webhook endpoint manually. No automatic endpoint change is attempted.'
    $null = Wait-AiTickWindow $Context
    Stop-AiBot $Context
    foreach ($file in $checked.Manifest.Files) {
        $to = Get-AiPayloadPath $Context.Target $file.Path
        if ($file.Existed) {
            $saved = Get-AiPayloadPath (Join-Path $checked.Root 'payload') $file.Path
            [void][IO.Directory]::CreateDirectory((Split-Path -Parent $to))
            Copy-Item -LiteralPath $saved -Destination $to -Force -ErrorAction Stop
            if ((Get-AiSha $to) -ne $file.BackupSha256) { throw ('Restored SHA mismatch: ' + $file.Path) }
        } elseif (Test-Path -LiteralPath $to) {
            if (-not (Test-Path -LiteralPath $to -PathType Leaf)) { throw 'Refusing to remove a non-file rollback destination.' }
            # An exact validated file only; never recursive deletion or a junction.
            Remove-Item -LiteralPath $to -Force -ErrorAction Stop
            if (Test-Path -LiteralPath $to) { throw ('New file could not be removed: ' + $file.Path) }
        }
        Write-AiDeployLog $Context ('RESTORE ' + $file.Path)
    }
    Start-AiBotAndProbe $Context
    Write-AiDeployLog $Context 'ROLLBACK verified: original file hashes/absence and Probe.'
}

function Get-AiEndpointState {
    param([hashtable]$Context)
    # The only LINE request here is GET through the existing stdlib client.
    # Credentials stay in the child process and are never printed or logged.
    $code = @'
import json, sys
sys.path.insert(0, sys.argv[1])
import tunnel_manager as tm
try:
    window = tm.registration_window()
    if window not in ('day', 'night'):
        raise ValueError('invalid window')
    base = tm.validate_tunnel_base(tm.PUBLIC_BASE.read_text(encoding='utf-8-sig'))
    token = tm._load_token()
    if not token:
        raise ValueError('missing token')
    state = tm.get_webhook_info(token)
    print(json.dumps(dict(window=window, endpoint=state['endpoint'], active=state['active'], ai_endpoint=base + '/line/webhook')))
except Exception as exc:
    print(json.dumps(dict(error=type(exc).__name__)))
    sys.exit(1)
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
    $bootstrap = "import base64;exec(base64.b64decode('" + $encoded + "'))"
    $bot = Join-Path $Context.Target 'line-bot'
    $json = Invoke-AiCheckedNative $Context $Context.Python @('-B', '-X', 'utf8', '-c', $bootstrap, $bot) $bot 'LINE GET endpoint and handover window'
    return ($json | ConvertFrom-Json -ErrorAction Stop)
}

function Test-AiHandover {
    param([hashtable]$Context)
    $state = Get-AiEndpointState $Context
    if ($state.active -ne $true) { throw 'LINE webhook is not active.' }
    if (-not (Test-Path -LiteralPath $Context.EventsPath -PathType Leaf)) { throw 'Fresh tunnel events are missing.' }
    $stream = New-Object IO.FileStream($Context.EventsPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        if ($stream.Length -lt $Context.EventOffset) { throw 'Event log was truncated during acceptance.' }
        [void]$stream.Seek($Context.EventOffset, [IO.SeekOrigin]::Begin)
        $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    $events = @($text -split "`r?`n" | Where-Object { $_.Trim() } | ForEach-Object {
        $row = $_ | ConvertFrom-Json -ErrorAction Stop
        $time = [DateTimeOffset]::Parse($row.ts)
        if ($time -ge $Context.Started -and $time -le [DateTimeOffset]::UtcNow.AddSeconds(5)) { $row }
    })
    if ($state.window -eq 'day') {
        $endpoint = $null
        if (-not [Uri]::TryCreate([string]$state.endpoint, [UriKind]::Absolute, [ref]$endpoint) -or
            $endpoint.Scheme -ne 'https' -or -not ($endpoint.Host -eq 'lhr.life' -or $endpoint.Host.EndsWith('.lhr.life', [StringComparison]::OrdinalIgnoreCase))) {
            throw 'Daytime LINE endpoint is not the lhr.life shop.'
        }
        if (@($events | Where-Object { $_.event -eq 'webhook_update' -and $_.put_status -ne 'not_attempted' }).Count -gt 0) { throw 'A daytime PUT attempt was observed.' }
        if (@($events | Where-Object { $_.event -eq 'skipped_day' -and $_.new_url -eq $state.ai_endpoint }).Count -eq 0) { throw 'Fresh skipped_day evidence is missing.' }
    } elseif ($state.window -eq 'night') {
        if ($state.endpoint -ne $state.ai_endpoint) { throw 'Nighttime LINE endpoint does not equal the AI endpoint.' }
        if (@($events | Where-Object { $_.event -eq 'webhook_update' -and $_.new_url -eq $state.ai_endpoint -and $_.verify_status -eq 'match' -and $_.put_status -eq 200 }).Count -eq 0) {
            throw 'Fresh verified night PUT/GET event is missing.'
        }
    } else { throw 'Unknown handover window.' }
    Write-AiDeployLog $Context ('HANDOVER verified: ' + $state.window + ', fresh event evidence and active LINE GET readback.')
}

function Write-AiDryRunTickWindow {
    param([hashtable]$Context)
    try {
        $tick = Get-AiTickState
        if (-not $tick.Exists) {
            Write-AiDeployLog $Context 'DRYRUN TICK WINDOW: scheduled task Laundry-LINE-Bot not found; a real run would refuse.'
            return
        }
        $decision = Get-AiTickWindowDecision -Now (Get-Date) -LastRunTime $tick.LastRunTime -NextRunTime $tick.NextRunTime `
            -State $tick.State -ControlScriptRunning ([bool]$tick.ControlScriptRunning)
        Write-AiDeployLog $Context ('DRYRUN TICK WINDOW (now): ' + (Format-AiTickDecision $decision))
    } catch {
        Write-AiDeployLog $Context ('DRYRUN TICK WINDOW unavailable: ' + $_.Exception.Message)
    }
}

function Invoke-AiLinebotDeployment {
    [CmdletBinding()]
    param([string]$Source, [string]$Target, [switch]$DryRun, [string]$Rollback, [switch]$RegisterTasks)
    $ErrorActionPreference = 'Stop'
    # A8-2: budget raised from 210 s to 480 s (Start via the task is slower).
    $budget = 480
    $context = @{ Log = $null; BackupRoot = $null; Target = $null; Backup = $null; Touched = $false; BudgetSeconds = $budget;
        Deadline = [DateTimeOffset]::UtcNow.AddSeconds($budget); Registered = @(); RegistrationAttempted = $false }
    try {
        if (-not $DryRun) {
            $context.BackupRoot = [IO.Path]::GetFullPath((Get-AiBackupRoot)).TrimEnd('\')
            if (-not (Test-Path -LiteralPath $context.BackupRoot)) { [void][IO.Directory]::CreateDirectory($context.BackupRoot) }
            $context.Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
            $context.Log = Join-Path $context.BackupRoot ('deploy-' + $context.Stamp + '.log')
            Write-AiDeployLog $context ('BEGIN target=' + $Target + ' rollback=' + [bool]$Rollback + ' register_tasks=' + [bool]$RegisterTasks)
        }
        if ($Rollback -and ($DryRun -or $RegisterTasks)) { throw 'Rollback cannot be combined with DryRun or RegisterTasks.' }
        $resolved = Resolve-AiTarget $Target
        $context.Target = $resolved.Root
        Write-AiDeployLog $context ('TARGET requested=' + $resolved.Requested + ' normalized=' + $resolved.Root + ' live=' + $resolved.Live)
        $control = Join-Path $context.Target 'line-bot/run_line_bot.ps1'
        if (-not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'Target run_line_bot.ps1 is missing.' }
        $junction = ([string](Get-AiLiveTargetMap).Junction).TrimEnd('\', '/')
        $isJunction = [string]::Equals($context.Target, $junction, [StringComparison]::OrdinalIgnoreCase)
        if (-not $DryRun) {
            # Start goes through Laundry-LINE-Bot, which only runs the junction tree.
            if (-not $isJunction) { throw ('A real deployment or rollback requires the live junction target ' + $junction + ' (Start goes through Laundry-LINE-Bot); got ' + $context.Target + '.') }
            if (-not (Get-AiTickState).Exists) { throw 'Scheduled task Laundry-LINE-Bot was not found; Start cannot run.' }
        }
        $plan = $null
        if (-not $Rollback) {
            $sourceRoot = Get-AiRoot $Source
            $plan = Get-AiDeployPlan $sourceRoot $context.Target $context
            Write-AiDeployLog $context ('PREFLIGHT source=' + $sourceRoot + ' target=' + $context.Target + ' HEAD=' + $plan.SourceHead + ' files=' + $plan.Files.Count)
            foreach ($file in $plan.Files) { Write-AiDeployLog $context ('PLAN ' + $file.Path + ' source_sha256=' + $file.SourceSha256 + ' existed=' + $file.Existed) }
            if ($DryRun) {
                Write-AiDeployLog $context 'DRYRUN: backup plan only; no copy, log file, service, Python, HTTP or task action.'
                Write-AiDeployLog $context ('DRYRUN normalized target=' + $context.Target + ' (requested ' + $resolved.Requested + ')')
                if (-not $isJunction) { Write-AiDeployLog $context ('DRYRUN NOTE: a real run would refuse this target; it must be the live junction ' + $junction + '.') }
                foreach ($row in @(Get-AiTargetProcesses $context.Target)) {
                    Write-AiDeployLog $context ('WOULD STOP pid=' + $row.ProcessId + ' name=' + $row.Name + ' target=' + $context.Target)
                }
                Write-AiDryRunTickWindow $context
                Write-AiDeployLog $context 'WOULD BACKUP D:\AI-Lanes-work\_backups\ai-linebot\<timestamp>\ + MANIFEST.json'
                Write-AiDeployLog $context ('WOULD wait for a tick-safe window, STOP, COPY, run offline tests (1 retry each), START via Start-ScheduledTask Laundry-LINE-Bot, poll -Probe every 10 s up to 180 s; budget ' + $budget + ' s.')
                return 0
            }
            $context.Python = Get-AiPythonPath
            if (-not (Test-Path -LiteralPath $context.Python -PathType Leaf)) { throw 'The production Python from README-OPS.md is missing.' }
        }
        if ($Rollback) {
            Restore-AiBackup $context $Rollback -ProtectCurrent
            return 0
        }
        Write-AiDeployLog $context ('SOURCE HEAD=' + $plan.SourceHead)
        $context.Backup = New-AiBackup $context $plan
        # Do not touch services until a full backup and SHA readback are verified.
        $null = Read-AiBackup $context $context.Backup
        $null = Wait-AiTickWindow $context
        $context.Touched = $true
        Stop-AiBot $context
        Copy-AiPayload $context $plan
        $bot = Join-Path $context.Target 'line-bot'
        $null = Invoke-AiOfflineTest $context @('-B', '-X', 'utf8', '-m', 'unittest', 'test_tunnel_manager', 'test_day_night_handover') $bot 'offline unittest tunnel + handover'
        $null = Invoke-AiOfflineTest $context @('-B', '-X', 'utf8', 'run_a2b_tests.py', 'test_mdb_freshness') $bot 'offline MDB freshness'
        $null = Invoke-AiOfflineTest $context @('-B', '-X', 'utf8', 'run_a2b_tests.py', 'test_arrival_notify') $bot 'offline arrival notify'
        $context.EventsPath = Join-Path $env:LOCALAPPDATA 'line-bot/tunnel_events.jsonl'
        $context.EventOffset = 0L
        if (Test-Path -LiteralPath $context.EventsPath) { $context.EventOffset = (Get-Item -LiteralPath $context.EventsPath).Length }
        $context.Started = [DateTimeOffset]::UtcNow
        Start-AiBotAndProbe $context
        Test-AiHandover $context
        if ($RegisterTasks) {
            $context.RegistrationAttempted = $true
            $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            $common = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File')
            $null = Invoke-AiCheckedNative $context $shell ($common + @((Join-Path $bot 'register-night-handover-task.ps1'), '-Python', $context.Python)) $bot 'register night handover task'
            $context.Registered += 'night-handover'
            $null = Invoke-AiCheckedNative $context $shell ($common + @((Join-Path $bot 'register-mdb-pull-task.ps1'))) $bot 'register MDB pull task'
            $context.Registered += 'mdb-pull'
        }
        Write-AiDeployLog $context ('SUCCESS backup=' + $context.Backup)
        return 0
    } catch {
        $failure = $_.Exception.Message
        # Logging failure must not prevent recovery after target/service mutation.
        try { Write-AiDeployLog $context ('FAILED ' + $failure) } catch { Write-Host ('FAILED (log unavailable): ' + $failure); $context.Log = $null }
        if ($context.Backup -and $context.Touched) {
            try {
                # Rollback also starts via the task and polls Probe; give it the full budget.
                $context.Deadline = [DateTimeOffset]::UtcNow.AddSeconds($context.BudgetSeconds)
                Restore-AiBackup $context $context.Backup
                Write-AiDeployLog $context 'Automatic rollback completed; original deployment still exits 1.'
            } catch {
                try { Write-AiDeployLog $context ('ROLLBACK FAILED: ' + $_.Exception.Message + '; backup=' + $context.Backup + '; commander intervention required.') } catch { Write-Host 'ROLLBACK FAILED and log unavailable; commander intervention required.' }
            }
        }
        if ($context.RegistrationAttempted) {
            try { Write-AiDeployLog $context ('Task registration was attempted; confirmed=' + ($context.Registered -join ', ') + '; task changes are not undone automatically; commander must inspect partial registration.') } catch { Write-Host 'Commander must inspect partial task registration.' }
        }
        return 1
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-AiLinebotDeployment -Source $Source -Target $Target -DryRun:$DryRun -Rollback $Rollback -RegisterTasks:$RegisterTasks)
}
