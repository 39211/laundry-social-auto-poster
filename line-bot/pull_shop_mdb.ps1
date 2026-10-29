#requires -Version 5.1
<#
Pull the shop's password-protected Jet MDB without changing its reader/password.
-DryRun reads remote metadata only. -WhatIf performs no connection or writes.
Exit: 0 success/dry-run, 1 local/validation error, 2 locked, 3 remote failure.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$DryRun,
    [string]$Destination = 'C:\FXwash\eHank.mdb',
    [string]$LogPath = (Join-Path $env:LOCALAPPDATA 'line-bot\mdb_pull.jsonl'),
    [ValidateRange(1, 60)][int]$TimeoutSeconds = 60
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

function Invoke-MdbPull {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param([switch]$DryRun, [string]$Destination, [string]$LogPath, [int]$TimeoutSeconds = 60)
    $action = if ($DryRun) { 'Read remote MDB metadata only' } else { 'Download, validate, backup and replace MDB' }
    if (-not $PSCmdlet.ShouldProcess('shop-pc -> ' + $Destination, $action)) { return 0 }
    $ErrorActionPreference = 'Stop'
    $result = 'LOCAL_ERROR'; $code = 1; $bytes = 0; $sourceMtime = $null
    $temp = $null; $targetHandle = $null
    try {
        try { $before = Get-ShopMdbMetadata $TimeoutSeconds }
        catch { $result = 'REMOTE_UNAVAILABLE'; $code = 3; return $code }
        $sourceMtime = $before.Mtime.ToString('o')
        if ($DryRun) { $bytes = $before.Bytes; $result = 'DRY_RUN'; $code = 0; return $code }
        $Destination = [IO.Path]::GetFullPath($Destination)
        $directory = [IO.Path]::GetDirectoryName($Destination)
        [void][IO.Directory]::CreateDirectory($directory)
        $temp = Join-Path $directory ('eHank-' + [guid]::NewGuid().ToString('N') + '.tmp')
        try {
            $reply = Invoke-ShopProcess 'scp.exe' @('-p', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                '-o', 'StrictHostKeyChecking=yes', 'shop-pc:C:/FXwash/eHank.mdb', $temp) $TimeoutSeconds
        }
        catch { $result = 'SCP_FAILED_OR_TIMEOUT'; $code = 3; return $code }
        if ($reply.TimedOut -or $reply.Exit -ne 0) { $result = 'SCP_FAILED_OR_TIMEOUT'; $code = 3; return $code }
        if (-not [IO.File]::Exists($temp)) { $result = 'SCP_MISSING_FILE'; $code = 3; return $code }
        $bytes = (Get-Item -LiteralPath $temp).Length
        if ($bytes -ne $before.Bytes -or -not (Test-JetMdb $temp)) { $result = 'INVALID_MDB'; return $code }
        try { $after = Get-ShopMdbMetadata $TimeoutSeconds }
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
        Write-MdbPullLog $LogPath $result $bytes $sourceMtime $code
    }
}

exit (Invoke-MdbPull -DryRun:$DryRun -Destination $Destination -LogPath $LogPath -TimeoutSeconds $TimeoutSeconds)
