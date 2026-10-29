# Dot-source only. Callers hold the returned mutex in try/finally.
function Write-PipelineLog {
    param([string]$Message)
    if (Get-Command Write-Log -CommandType Function -ErrorAction SilentlyContinue) {
        Write-Log $Message
    } else {
        $line = '[{0:yyyy-MM-dd HH:mm:ss}] {1}' -f (Get-Date), $Message
        $target = Get-Variable -Name logFile -ValueOnly -ErrorAction SilentlyContinue
        if ($target) { Add-Content -LiteralPath $target -Value $line -Encoding UTF8 }
        Write-Host $line
    }
}

function Remove-StaleGitLock {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    try {
        $repoPath = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\', '/')
        $gitPath = Join-Path $repoPath '.git'
        if (Test-Path -LiteralPath $gitPath -PathType Leaf) {
            # Linked worktrees have a .git file, not a directory.
            $pointer = [IO.File]::ReadAllText($gitPath).Trim()
            if ($pointer -notmatch '^gitdir:\s*(.+)$') { return }
            $gitPath = $Matches[1]
            if (-not [IO.Path]::IsPathRooted($gitPath)) { $gitPath = Join-Path $repoPath $gitPath }
            $gitPath = [IO.Path]::GetFullPath($gitPath)
        }
        $lockPath = Join-Path $gitPath 'index.lock'
        if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) { return }
        $lock = Get-Item -LiteralPath $lockPath -Force -ErrorAction Stop
        if ($lock.Attributes -band [IO.FileAttributes]::ReparsePoint) { return }
        if (([DateTime]::UtcNow - $lock.LastWriteTimeUtc).TotalMinutes -le 10) { return }
        $mtime = $lock.LastWriteTimeUtc
        $normalizedRepo = $repoPath.Replace('\', '/')
        $normalizedGit = $gitPath.Replace('\', '/')
        # Failure/hidden command lines cannot establish that deleting is safe.
        $gitProcesses = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'git.exe'" -ErrorAction Stop)
        foreach ($process in $gitProcesses) {
            $commandLine = [string]$process.CommandLine
            if ([string]::IsNullOrWhiteSpace($commandLine)) { return }
            $commandLine = $commandLine.Replace('\', '/')
            if ($commandLine.IndexOf($normalizedRepo, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
                $commandLine.IndexOf($normalizedGit, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return }
        }
        # Re-read before deletion: a replaced/refreshed lock is not our stale lock.
        $current = Get-Item -LiteralPath $lockPath -Force -ErrorAction Stop
        if ($current.LastWriteTimeUtc -ne $mtime -or $current.Length -ne $lock.Length -or
            $current.CreationTimeUtc -ne $lock.CreationTimeUtc -or
            ($current.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return }
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
        Write-PipelineLog ("Removed stale git lock: {0}; mtime={1}" -f $lockPath, $mtime.ToString('o'))
    } catch {
        Write-PipelineLog ("Stale git lock preserved: {0}" -f $_.Exception.Message)
    }
}

function Enter-PipelineMutex {
    [CmdletBinding()]
    param(
        [string]$Name = 'sxj-publish',
        [ValidateRange(0, 2147483)][int]$TimeoutSec = 600
    )
    $mutex = $null
    $owned = $false
    try {
        $mutex = [Threading.Mutex]::new($false, ('Global\' + $Name))
        try {
            $owned = $mutex.WaitOne([TimeSpan]::FromSeconds($TimeoutSec))
        } catch [Threading.AbandonedMutexException] {
            # WaitOne transfers ownership when reporting an abandoned mutex.
            $owned = $true
            Write-PipelineLog "Pipeline mutex $Name was abandoned; ownership recovered."
        }
        if (-not $owned) {
            Write-PipelineLog "Pipeline mutex $Name timed out after ${TimeoutSec}s; exit 75, no pipeline work started."
        }
    } catch {
        Write-PipelineLog ("Pipeline mutex {0} unavailable: {1}; exit 75." -f $Name, $_.Exception.Message)
    }
    if (-not $owned) {
        if ($null -ne $mutex) { $mutex.Dispose() }
        exit 75
    }
    return $mutex
}

function Exit-PipelineMutex {
    [CmdletBinding()]
    param([AllowNull()][Threading.Mutex]$Mutex)
    if ($null -eq $Mutex) { return }
    try { $Mutex.ReleaseMutex() }
    finally { $Mutex.Dispose() }
}
