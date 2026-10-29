#requires -Version 5.1
<# A8 preparation artifact. Running this file without -DryRun performs a deployment.
   Dot-sourcing only defines functions. No service or scheduler action occurs on import.
   DryRun writes nothing (including no log). Task registration is opt-in. #>
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
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 90)
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
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Only the exact child created here, never an image-name sweep.
            $process.Kill()
            $process.WaitForExit()
            throw 'Native helper timed out; deployment cannot continue.'
        }
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = ($stdout.Result + $stderr.Result).Trim() }
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

function Get-AiRoot {
    param([string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) { throw ('Directory does not exist: ' + $Path) }
    return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).ProviderPath).TrimEnd('\', '/')
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
    if ($SourceRoot -eq $TargetRoot) { throw 'Source and Target must be different trees.' }
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

function Invoke-AiCheckedNative {
    param([hashtable]$Context, [string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$Label)
    $seconds = [int][Math]::Floor(($Context.Deadline - [DateTimeOffset]::UtcNow).TotalSeconds)
    if ($seconds -lt 1) { throw 'Deployment time budget exhausted; recovery is required.' }
    Write-AiDeployLog $Context ('RUN ' + $Label)
    $result = Invoke-AiNative -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory -TimeoutSeconds ([Math]::Min(90, $seconds))
    Write-AiDeployLog $Context ($Label + ' exit=' + $result.ExitCode)
    if ($result.Output) { Write-AiDeployLog $Context $result.Output }
    if ($result.ExitCode -ne 0) { throw ($Label + ' failed (exit ' + $result.ExitCode + ').') }
    return $result.Output
}

function Invoke-AiBotControl {
    param([hashtable]$Context, [string]$Mode)
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Context.Target 'line-bot/run_line_bot.ps1'))
    if ($Mode -ne 'Start') { $arguments += '-' + $Mode }
    $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    $null = Invoke-AiCheckedNative $Context $shell $arguments $Context.Target ('bot ' + $Mode)
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
    if ($manifest.Schema -ne 1 -or $manifest.Target -ne $Context.Target -or @($manifest.Files).Count -eq 0) { throw 'Backup manifest schema/target/files do not match.' }
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

function Start-AiBotAndProbe {
    param([hashtable]$Context)
    Invoke-AiBotControl $Context 'Start'
    Start-Sleep -Seconds 10
    Invoke-AiBotControl $Context 'Probe'
    $pidPath = Join-Path $env:LOCALAPPDATA 'line-bot/line_webhook.pid'
    $raw = (Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8 -ErrorAction Stop).Trim()
    $trackedId = 0
    if (-not [int]::TryParse($raw, [ref]$trackedId) -or $trackedId -le 0) { throw 'Invalid new line_webhook PID file.' }
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8791/healthz' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -ne 200 -or ([string]$response.Content).Trim() -notmatch '^ok ([0-9]+)$') { throw 'Invalid healthz status/body.' }
    if ([int]$Matches[1] -ne $trackedId) { throw 'healthz PID must exactly equal the new PID file (A8).' }
    Write-AiDeployLog $Context ('PROBE verified: healthz ok ' + $trackedId + ' equals PID file.')
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

function Invoke-AiLinebotDeployment {
    [CmdletBinding()]
    param([string]$Source, [string]$Target, [switch]$DryRun, [string]$Rollback, [switch]$RegisterTasks)
    $ErrorActionPreference = 'Stop'
    $context = @{ Log = $null; BackupRoot = $null; Target = $null; Backup = $null; Touched = $false;
        Deadline = [DateTimeOffset]::UtcNow.AddSeconds(210); Registered = @(); RegistrationAttempted = $false }
    try {
        if (-not $DryRun) {
            $context.BackupRoot = [IO.Path]::GetFullPath((Get-AiBackupRoot)).TrimEnd('\')
            if (-not (Test-Path -LiteralPath $context.BackupRoot)) { [void][IO.Directory]::CreateDirectory($context.BackupRoot) }
            $context.Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
            $context.Log = Join-Path $context.BackupRoot ('deploy-' + $context.Stamp + '.log')
            Write-AiDeployLog $context ('BEGIN target=' + $Target + ' rollback=' + [bool]$Rollback + ' register_tasks=' + [bool]$RegisterTasks)
        }
        if ($Rollback -and ($DryRun -or $RegisterTasks)) { throw 'Rollback cannot be combined with DryRun or RegisterTasks.' }
        $context.Target = Get-AiRoot $Target
        $control = Join-Path $context.Target 'line-bot/run_line_bot.ps1'
        if (-not (Test-Path -LiteralPath $control -PathType Leaf)) { throw 'Target run_line_bot.ps1 is missing.' }
        $plan = $null
        if (-not $Rollback) {
            $sourceRoot = Get-AiRoot $Source
            $plan = Get-AiDeployPlan $sourceRoot $context.Target $context
            Write-AiDeployLog $context ('PREFLIGHT source=' + $sourceRoot + ' target=' + $context.Target + ' HEAD=' + $plan.SourceHead + ' files=' + $plan.Files.Count)
            foreach ($file in $plan.Files) { Write-AiDeployLog $context ('PLAN ' + $file.Path + ' source_sha256=' + $file.SourceSha256 + ' existed=' + $file.Existed) }
            if ($DryRun) {
                Write-AiDeployLog $context 'DRYRUN: backup plan only; no copy, log file, service, Python, HTTP or task action.'
                foreach ($row in @(Get-AiTargetProcesses $context.Target)) {
                    Write-AiDeployLog $context ('WOULD STOP pid=' + $row.ProcessId + ' name=' + $row.Name + ' target=' + $context.Target)
                }
                Write-AiDeployLog $context 'WOULD BACKUP D:\AI-Lanes-work\_backups\ai-linebot\<timestamp>\ + MANIFEST.json'
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
        $context.Touched = $true
        Stop-AiBot $context
        Copy-AiPayload $context $plan
        $bot = Join-Path $context.Target 'line-bot'
        $null = Invoke-AiCheckedNative $context $context.Python @('-B', '-X', 'utf8', '-m', 'unittest', 'test_tunnel_manager', 'test_day_night_handover') $bot 'offline unittest tunnel + handover'
        $null = Invoke-AiCheckedNative $context $context.Python @('-B', '-X', 'utf8', 'run_a2b_tests.py', 'test_mdb_freshness') $bot 'offline MDB freshness'
        $null = Invoke-AiCheckedNative $context $context.Python @('-B', '-X', 'utf8', 'run_a2b_tests.py', 'test_arrival_notify') $bot 'offline arrival notify'
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
                $context.Deadline = [DateTimeOffset]::UtcNow.AddSeconds(120)
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
