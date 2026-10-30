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
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect("127.0.0.1", 8791, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(3000, $false)
        if ($ok) {
            $client.EndConnect($iar)
            $stream = $client.GetStream()
            $stream.ReadTimeout = 3000
            $stream.WriteTimeout = 3000
            $payload = [System.Text.Encoding]::ASCII.GetBytes("GET /healthz HTTP/1.0`r`nHost: 127.0.0.1:8791`r`nConnection: close`r`n`r`n")
            $stream.Write($payload, 0, $payload.Length)
            $text = ""
            $buf = New-Object byte[] 512
            try {
                while ($text.Length -lt 2048) {
                    $nread = $stream.Read($buf, 0, $buf.Length)
                    if ($nread -le 0) { break }
                    $text += [System.Text.Encoding]::ASCII.GetString($buf, 0, $nread)
                    if ($text.Contains("`r`n`r`n") -and ($text -match "ok (\d+)")) { break }
                }
            } catch {}
            if ($text.Length -gt 0) {
                if ($text -match "HTTP/1\.[01] 200") { $health = "ok" }
                $hzPid = -1
                if ($text -match "ok (\d+)") { $hzPid = [int]$Matches[1] }
                $tracked = Get-TrackedPid -Name "line_webhook"
                if ($health -eq "ok") {
                    if ($hzPid -lt 0) {
                        Write-ProbeLine ("healthz foreign pid= tracked=" + $tracked)
                        $health = "fail"
                    } elseif (Test-HealthzPidMatch -ReportedPid $hzPid -TrackedPid $tracked) {
                        if ($hzPid -eq $tracked) {
                            Write-ProbeLine ("healthz ok pid=" + $hzPid)
                        } else {
                            Write-ProbeLine ("healthz ok pid=" + $hzPid + " (child of " + $tracked + ")")
                        }
                    } else {
                        Write-ProbeLine ("healthz foreign pid=" + $hzPid + " tracked=" + $tracked)
                        $health = "fail"
                    }
                }
            }
        }
    } catch {
        $health = "fail"
    } finally {
        try { $client.Close() } catch {}
    }
    Write-ProbeLine ("healthz " + $health)
    if ($health -ne "ok") { $allAlive = $false }
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

Start-Tracked -Name "line_webhook" -Rel "line_webhook.py"
Start-Tracked -Name "staff_server" -Rel "staff_server.py"
Start-Tracked -Name "tunnel_manager" -Rel "tunnel_manager.py"
