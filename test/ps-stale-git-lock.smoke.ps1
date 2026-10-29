$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$library = Join-Path $root 'scripts\_pipeline-lock.ps1'
if (-not (Test-Path -LiteralPath $library)) {
    Write-Output 'CASE_FAIL name=stale-lock-library reason=missing _pipeline-lock.ps1'
    Write-Output 'SMOKE_FAIL'
    exit 1
}
. $library
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('a7-git-lock-' + [guid]::NewGuid().ToString('n'))
$repo = Join-Path $fixture 'repo with spaces'
$lock = Join-Path $repo '.git\index.lock'
$script:failed = $false
$script:processes = @()
$script:queryFails = $false
$script:lines = @()
function Write-Log([string]$Message) { $script:lines += $Message }
# Only the process inventory is stubbed; deletion, timestamps and paths are real.
function Get-CimInstance {
    param($ClassName, $Filter, $ErrorAction)
    if ($script:queryFails) { throw 'fixture process inventory unavailable' }
    if ($ClassName -ne 'Win32_Process' -or $Filter -notmatch 'git.exe') { throw 'unexpected inventory query' }
    return $script:processes
}
function Assert-Case([string]$Name, [bool]$Ok) {
    if ($Ok) { Write-Output "CASE_OK name=$Name" }
    else { Write-Output "CASE_FAIL name=$Name"; $script:failed = $true }
}
function Reset-Lock([int]$Minutes = 11) {
    [IO.File]::WriteAllBytes($lock, [byte[]]@())
    [IO.File]::SetLastWriteTimeUtc($lock, [DateTime]::UtcNow.AddMinutes(-$Minutes))
    $script:processes = @()
    $script:queryFails = $false
    $script:lines = @()
}
try {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $lock))
    Reset-Lock
    $mtime = (Get-Item -LiteralPath $lock).LastWriteTimeUtc.ToString('o')
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'old-zero-byte-lock-removed-and-mtime-logged' (-not (Test-Path -LiteralPath $lock) -and ($script:lines -join '|').Contains($mtime))
    Reset-Lock 1
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'one-minute-lock-preserved' (Test-Path -LiteralPath $lock)
    Reset-Lock
    $script:processes = @([pscustomobject]@{ CommandLine = ('git.exe -C "' + $repo + '" add docs') })
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'matching-git-commandline-preserves-old-lock' (Test-Path -LiteralPath $lock)
    Reset-Lock
    $script:processes = @([pscustomobject]@{ CommandLine = ('git.exe -C "' + $repo.Replace('\', '/').ToUpperInvariant() + '" status') })
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'slash-and-case-normalized-process-match' (Test-Path -LiteralPath $lock)
    Reset-Lock
    $script:processes = @([pscustomobject]@{ CommandLine = 'git.exe -C C:/another-repo status' })
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'unrelated-git-does-not-block-cleanup' (-not (Test-Path -LiteralPath $lock))
    Reset-Lock
    $script:queryFails = $true
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'inventory-error-preserves-lock' (Test-Path -LiteralPath $lock)
    Reset-Lock
    $script:processes = @([pscustomobject]@{ CommandLine = $null })
    Remove-StaleGitLock -RepoRoot $repo
    Assert-Case 'unreadable-git-commandline-preserves-lock' (Test-Path -LiteralPath $lock)
    $worktree = Join-Path $fixture 'worktree'
    $gitdir = Join-Path $fixture 'worktree-gitdir'
    [void][IO.Directory]::CreateDirectory($worktree)
    [void][IO.Directory]::CreateDirectory($gitdir)
    [IO.File]::WriteAllText((Join-Path $worktree '.git'), 'gitdir: ../worktree-gitdir', [Text.UTF8Encoding]::new($false))
    $worktreeLock = Join-Path $gitdir 'index.lock'
    [IO.File]::WriteAllBytes($worktreeLock, [byte[]]@())
    [IO.File]::SetLastWriteTimeUtc($worktreeLock, [DateTime]::UtcNow.AddMinutes(-11))
    $script:processes = @()
    Remove-StaleGitLock -RepoRoot $worktree
    Assert-Case 'worktree-gitdir-lock-resolved' (-not (Test-Path -LiteralPath $worktreeLock))
} finally {
    $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture path' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
if ($script:failed) { Write-Output 'SMOKE_FAIL'; exit 1 }
Write-Output 'SMOKE_OK stale-git-lock cases=8'
