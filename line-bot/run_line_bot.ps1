# Launch LINE bot processes. ASCII only (PS 5.1 cp950).
param(
    [switch]$Probe,
    [switch]$Stop
)

$ErrorActionPreference = "Stop"

$Python = "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $env:LOCALAPPDATA "line-bot"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# F1: extra outer quotes so cmd.exe does not strip quotes around the redirect target
# Kept so F1 quoting still works; production Start-Tracked uses G5 Start-Process.
function Get-LaunchArg {
    param([string]$Py, [string]$Script, [string]$Log)
    return "/c `"`"$Py`" -u `"$Script`" >> `"$Log`" 2>&1`""
}

# F6: collect descendant pids (BFS), never by image name
function Get-DescendantIds {
    param([int]$RootId)
    $ids = New-Object System.Collections.Generic.List[int]
    $queue = New-Object System.Collections.Queue
    $seen = @{}
    $seen[$RootId] = $true
    $queue.Enqueue($RootId)
    while ($queue.Count -gt 0) {
        $cur = [int]$queue.Dequeue()
        Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId=$cur" -ErrorAction SilentlyContinue | ForEach-Object {
            $cid = [int]$_.ProcessId
            if (-not $seen.ContainsKey($cid)) {
                $seen[$cid] = $true
                [void]$ids.Add($cid)
                $queue.Enqueue($cid)
            }
        }
    }
    return ,$ids
}

# P1: healthz pid matches tracked pid or any descendant (venv launcher vs flask child)
function Test-HealthzPidMatch {
    param([int]$ReportedPid, [int]$TrackedPid)
    $matched = $false
    if (($ReportedPid -gt 0) -and ($TrackedPid -gt 0)) {
        if ($ReportedPid -eq $TrackedPid) {
            $matched = $true
        } else {
            $kids = Get-DescendantIds -RootId $TrackedPid
            if ($kids) {
                foreach ($k in $kids) {
                    if ([int]$k -eq $ReportedPid) {
                        $matched = $true
                        break
                    }
                }
            }
        }
    }
    return [bool]$matched
}

# G16: Name.py AND this directory's absolute path; exclude test_*.py filenames
function Test-CmdMatches {
    param([string]$Cmd, [string]$Name)
    if (-not $Cmd) { return $false }
    $needle = $Name + ".py"
    if ($Cmd.IndexOf($needle) -lt 0) { return $false }
    if ($Cmd.IndexOf([string]$Root) -lt 0) { return $false }
    if ($Cmd -match 'test_[A-Za-z0-9_-]+\.py') { return $false }
    return $true
}

function Test-TrackedAlive {
    param([string]$Name)
    $pidFile = Join-Path $LogDir ($Name + ".pid")
    if (-not (Test-Path $pidFile)) { return $false }
    $raw = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) { return $false }
    $procId = 0
    if (-not [int]::TryParse([string]$raw.Trim(), [ref]$procId)) { return $false }
    if ($procId -le 0) { return $false }
    $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $cim) { return $false }
    $cmd = [string]$cim.CommandLine
    if (Test-CmdMatches -Cmd $cmd -Name $Name) { return $true }
    return $false
}

function Get-TrackedPid {
    param([string]$Name)
    $pidFile = Join-Path $LogDir ($Name + ".pid")
    if (-not (Test-Path $pidFile)) { return 0 }
    $raw = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) { return 0 }
    $procId = 0
    if (-not [int]::TryParse([string]$raw.Trim(), [ref]$procId)) { return 0 }
    return $procId
}

# F6: stop whole descendant tree leaf-to-root; match only pid file + command line
function Stop-Tracked {
    param([string]$Name)
    $pidFile = Join-Path $LogDir ($Name + ".pid")
    if (-not (Test-Path $pidFile)) {
        return ("stop " + $Name + " result=absent")
    }
    $raw = Get-Content -Path $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $raw) {
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
        return ("stop " + $Name + " result=empty-pid")
    }
    $procId = 0
    if (-not [int]::TryParse([string]$raw.Trim(), [ref]$procId)) {
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
        return ("stop " + $Name + " result=bad-pid")
    }
    if ($procId -le 0) {
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
        return ("stop " + $Name + " result=bad-pid")
    }
    $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $cim) {
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
        return ("stop " + $Name + " pid=" + $procId + " result=dead")
    }
    $cmd = [string]$cim.CommandLine
    if (Test-CmdMatches -Cmd $cmd -Name $Name) {
        $kids = Get-DescendantIds -RootId $procId
        if ($kids -and $kids.Count -gt 0) {
            for ($i = $kids.Count - 1; $i -ge 0; $i--) {
                Stop-Process -Id $kids[$i] -Force -ErrorAction SilentlyContinue
            }
        }
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
        return ("stop " + $Name + " pid=" + $procId + " result=ok")
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
    return ("stop " + $Name + " pid=" + $procId + " result=mismatch")
}

# G15: rotate service logs larger than 5 MB before start
function Rotate-IfLarge {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $item = Get-Item $Path -ErrorAction SilentlyContinue
    if (-not $item) { return }
    if ($item.Length -gt 5MB) {
        $rotated = $Path + ".1"
        if (Test-Path $rotated) {
            Remove-Item -Force $rotated -ErrorAction SilentlyContinue
        }
        Rename-Item -Path $Path -NewName (Split-Path -Leaf $rotated) -ErrorAction SilentlyContinue
    }
}

# F7: idempotent start -- skip when pid file + live process + cmdline match
# G5: Start-Process python directly (not cmd.exe); pid file is python's pid
function Start-Tracked {
    param([string]$Name, [string]$Rel)
    if (Test-TrackedAlive -Name $Name) {
        Write-Output ("skip " + $Name)
        return
    }
    $pidFile = Join-Path $LogDir ($Name + ".pid")
    if (Test-Path $pidFile) {
        Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
    }
    $scriptPath = Join-Path $Root $Rel
    $logPath = Join-Path $LogDir ($Name + ".log")
    $errPath = Join-Path $LogDir ($Name + ".err")
    Rotate-IfLarge -Path $logPath
    Rotate-IfLarge -Path $errPath
    # A8-2: quote the script path so a Root containing spaces reaches python as one argument.
    $p = Start-Process -FilePath $Python -ArgumentList '-u', ('"{0}"' -f $scriptPath) -RedirectStandardOutput $logPath -RedirectStandardError $errPath -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    $still = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if (-not $still) {
        Write-Output ("start failed " + $Name)
        return
    }
    Set-Content -Path $pidFile -Value ([string]$p.Id) -Encoding ASCII
}

function Write-ProbeLine {
    param([string]$Text)
    [Console]::Out.WriteLine($Text)
    [Console]::Out.Flush()
}

# Reviewed against runtime os.environ reads; never import arbitrary HKCU names.
function Get-BotConfigNames {
    return @(
        'GEMINI_API_KEY', 'LAUNDRY_AI_CHAT', 'LAUNDRY_PHOTO_ESTIMATE',
        'LAUNDRY_CHAT_GEMINI_KEY', 'LAUNDRY_CHAT_MODELS', 'LAUNDRY_CHAT_THINKING',
        'LAUNDRY_CHAT_USAGE_DIR', 'LAUNDRY_REPO_ROOT', 'LAUNDRY_EHANK_ROOT',
        'LAUNDRY_LOOKUP_FIXTURE', 'LAUNDRY_FRESH_MINUTES',
        'LAUNDRY_LINE_USAGE', 'LAUNDRY_LINE_USAGE_DIR', 'LAUNDRY_LINE_EVENTS',
        'LAUNDRY_LINE_EVENT_LOG_DIR', 'LAUNDRY_LINE_EVENTS_DIR',
        'LAUNDRY_VISION_KNOWLEDGE_DIR', 'LAUNDRY_VISION_THINKING_BUDGET',
        'LAUNDRY_VISION_MODEL', 'LAUNDRY_VISION_FALLBACK_MODEL', 'LAUNDRY_VISION_USAGE_DIR',
        'CLAUDE_API_CREDIT_KEY', 'LAUNDRY_CLAUDE_EFFORT', 'LAUNDRY_CLAUDE_DAILY_USD',
        'OPENAI_API_KEY', 'LAUNDRY_OPENAI_EFFORT', 'LAUNDRY_OPENAI_DAILY_USD',
        'LAUNDRY_CHAT_PER_CALL_SECONDS'
    )
}

function Get-BotUserValue {
    param([string]$Name)
    return [Environment]::GetEnvironmentVariable($Name, 'User')
}

function Invoke-BotStart {
    $restores = @{}
    $receipt = [ordered]@{}
    $receiptTemp = Join-Path $LogDir ('bot_config_receipt.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        foreach ($name in (Get-BotConfigNames)) {
            $value = [Environment]::GetEnvironmentVariable($name, 'Process')
            $source = 'process'
            if ([string]::IsNullOrEmpty($value)) {
                $userValue = Get-BotUserValue -Name $name
                if (-not [string]::IsNullOrEmpty($userValue)) {
                    $restores[$name] = $value
                    [Environment]::SetEnvironmentVariable($name, $userValue, 'Process')
                    $value = $userValue
                    $source = 'registry'
                } else { $source = 'missing' }
            }
            $receipt[$name] = [ordered]@{ present = (-not [string]::IsNullOrEmpty($value)); source = $source }
        }
        [IO.File]::WriteAllText($receiptTemp, ($receipt | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $receiptTemp -Destination (Join-Path $LogDir 'bot_config_receipt.json') -Force
        Start-Tracked -Name 'line_webhook' -Rel 'line_webhook.py' | ForEach-Object { Write-ProbeLine $_ }
        Start-Tracked -Name 'staff_server' -Rel 'staff_server.py' | ForEach-Object { Write-ProbeLine $_ }
        Start-Tracked -Name 'tunnel_manager' -Rel 'tunnel_manager.py' | ForEach-Object { Write-ProbeLine $_ }
        return (Invoke-Probe)
    } catch {
        # Exceptions can contain paths or configuration values. Emit a fixed reason only.
        Write-ProbeLine 'start failed: configuration receipt or child startup'
        return 1
    } finally {
        foreach ($name in $restores.Keys) {
            [Environment]::SetEnvironmentVariable($name, $restores[$name], 'Process')
        }
        if (Test-Path -LiteralPath $receiptTemp) { Remove-Item -LiteralPath $receiptTemp -Force }
    }
}

# No proxy, redirects or external destination; bounded read, no response logging.
function Read-BotEndpoint {
    param([ValidateSet('/healthz', '/readyz')][string]$Path)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', 8791, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(3000, $false)) { throw 'timeout' }
        $client.EndConnect($iar)
        $stream = $client.GetStream()
        $stream.ReadTimeout = 3000
        $stream.WriteTimeout = 3000
        $payload = [Text.Encoding]::ASCII.GetBytes("GET $Path HTTP/1.0`r`nHost: 127.0.0.1:8791`r`nConnection: close`r`n`r`n")
        $stream.Write($payload, 0, $payload.Length)
        $text = ''
        $buf = New-Object byte[] 512
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while ($text.Length -lt 8192 -and $timer.ElapsedMilliseconds -lt 3000) {
            $nread = $stream.Read($buf, 0, $buf.Length)
            if ($nread -le 0) { break }
            $text += [Text.Encoding]::UTF8.GetString($buf, 0, $nread)
        }
        if ($text.Length -ge 8192 -or $timer.ElapsedMilliseconds -ge 3000) { throw 'limit' }
        if ($text -notmatch '\AHTTP/1\.[01] 200(?: |\r)') { throw 'status' }
        $parts = $text -split "`r`n`r`n", 2
        if ($parts.Count -ne 2) { throw 'body' }
        return $parts[1].Trim()
    } finally { $client.Close() }
}

function Test-BotReady {
    param([int]$HealthPid)
    try {
        $ready = ConvertFrom-Json (Read-BotEndpoint -Path '/readyz')
        if ($ready.pid -isnot [int] -or $ready.pid -ne $HealthPid -or $HealthPid -le 0 -or
            $ready.vision_configured -isnot [bool] -or $ready.ai_chat -isnot [bool] -or
            $ready.missing -isnot [array]) { throw 'schema' }
        $valid = $true
        if (-not $ready.vision_configured) {
            Write-ProbeLine 'readyz fail: vision_configured=False; check GEMINI_API_KEY LAUNDRY_PHOTO_ESTIMATE'
            $valid = $false
        }
        if (-not $ready.ai_chat) {
            Write-ProbeLine 'readyz fail: ai_chat=False; check LAUNDRY_AI_CHAT GEMINI_API_KEY'
            $valid = $false
        }
        if ($ready.missing.Count -gt 0) {
            Write-ProbeLine 'readyz fail: missing configuration'
            $valid = $false
        }
        if ($valid) { Write-ProbeLine 'readyz ok' }
        return $valid
    } catch {
        Write-ProbeLine 'readyz fail: unavailable, malformed or pid mismatch'
        return $false
    }
}

# F7: Probe -- print liveness of three processes and healthz; 0=all up, 1=missing
# G6: healthz body must be "ok <pid>" matching line_webhook.pid
# P1: reported pid may equal tracked pid or be a descendant of it
function Invoke-Probe {
    $names = @("line_webhook", "staff_server", "tunnel_manager")
    $allAlive = $true
    foreach ($n in $names) {
        $alive = Test-TrackedAlive -Name $n
        $procId = Get-TrackedPid -Name $n
        Write-ProbeLine ($n + " alive=" + $alive + " pid=" + $procId)
        if (-not $alive) { $allAlive = $false }
    }
    $health = "fail"
    $hzPid = -1
    try {
        $body = Read-BotEndpoint -Path '/healthz'
        if ($body -match '\Aok (\d+)\z') {
            $hzPid = [int]$Matches[1]
            $tracked = Get-TrackedPid -Name 'line_webhook'
            if (Test-HealthzPidMatch -ReportedPid $hzPid -TrackedPid $tracked) {
                $health = 'ok'
                Write-ProbeLine ("healthz ok pid=" + $hzPid)
            } else {
                Write-ProbeLine ("healthz foreign pid=" + $hzPid + " tracked=" + $tracked)
            }
        }
    } catch { $health = 'fail' }
    Write-ProbeLine ("healthz " + $health)
    if ($health -ne 'ok') { $allAlive = $false }
    if (-not (Test-BotReady -HealthPid $hzPid)) { $allAlive = $false }
    if ($allAlive) { return 0 }
    return 1
}

if ($Probe -and $Stop) {
    Write-Output "error: -Stop and -Probe are mutually exclusive"
    exit 2
}

if ($Probe) {
    $code = Invoke-Probe
    exit $code
}

# G9: Stop-Tracked is live via -Stop; order tunnel then staff then webhook
if ($Stop) {
    foreach ($n in @("tunnel_manager", "staff_server", "line_webhook")) {
        $result = Stop-Tracked -Name $n
        Write-Output $result
    }
    exit 0
}

exit (Invoke-BotStart)
