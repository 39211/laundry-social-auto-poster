#requires -Version 5.1
<#
Pull the weekly attribution summaries from the shop into the ai repo (task card B2-7).
Copies ONLY:
  shop C:\LaundryStores\fxwash\data\conversions\source-to-order-YYYY-Www.json
  shop C:\LaundryStores\fxwash\data\conversions\history\source-to-order-YYYY-Www.rN.json
to the same relative folders under -TargetRoot (default: the live repo data\conversions).
Never anything else (no inquiries.jsonl*, secrets\*, shop.json, ...).
Each file: skip if SHA-256 unchanged; else copy to a temp name in the target folder, check
size + SHA-256 + JSON object, then atomic replace. Log: counts only, one JSON line.
-SourceRoot/-TargetRoot (both together): local folders, no transport (tests).
Exit: 0 ok (incl. nothing new), 1 transport or local I/O error, 2 a file failed validation
      (the other files are still installed).
#>
[CmdletBinding()]
param(
    [string]$SourceRoot = '',
    [string]$TargetRoot = 'C:\Users\cyc39\laundry-repo\data\conversions',
    [string]$LogPath = (Join-Path $env:LOCALAPPDATA 'line-bot\conversions_pull.jsonl'),
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

function Test-ConversionFileName([string]$Name, [string]$Folder) {
    # Allow-list: '^source-to-order-\d{4}-W\d{2}\.json$' (main) and
    # '^source-to-order-\d{4}-W\d{2}\.r\d+\.json$' (history), with [0-9] and \z for strictness.
    if ([string]::IsNullOrEmpty($Name)) { return $false }
    if ($Folder -ceq '') {
        return [regex]::IsMatch($Name, '^source-to-order-[0-9]{4}-W[0-9]{2}\.json\z')
    }
    if ($Folder -ceq 'history') {
        return [regex]::IsMatch($Name, '^source-to-order-[0-9]{4}-W[0-9]{2}\.r[0-9]+\.json\z')
    }
    return $false
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Test-ConversionJson([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 2) { return $false }
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { return $false }
    try { $text = (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes) }
    catch { return $false }
    if (-not $text.TrimStart().StartsWith('{')) { return $false }
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    try { $parsed = $serializer.DeserializeObject($text) }
    catch { return $false }
    return ($parsed -is [System.Collections.Generic.Dictionary[string, object]])
}

function Get-ShopConversionListing([int]$TimeoutSeconds) {
    $command = @'
$ErrorActionPreference = 'Stop'
$base = 'C:/LaundryStores/fxwash/data/conversions'
$items = New-Object System.Collections.ArrayList
foreach ($sub in @('', 'history')) {
    $dir = if ($sub) { $base + '/' + $sub } else { $base }
    if (-not [IO.Directory]::Exists($dir)) { continue }
    foreach ($path in [IO.Directory]::GetFiles($dir, 'source-to-order-*.json')) {
        $info = New-Object IO.FileInfo $path
        if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($info.Name -notmatch '^source-to-order-[0-9]{4}-W[0-9]{2}(\.r[0-9]+)?\.json$') { continue }
        $hash = (Get-FileHash -LiteralPath $info.FullName -Algorithm SHA256).Hash
        [void]$items.Add(@{ dir = $sub; name = $info.Name; bytes = $info.Length; sha256 = $hash })
    }
}
ConvertTo-Json -InputObject @($items.ToArray()) -Compress
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $arguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes',
        'shop-pc', ('powershell.exe -NoProfile -NonInteractive -EncodedCommand ' + $encoded))
    $reply = Invoke-ShopProcess 'ssh.exe' $arguments $TimeoutSeconds
    if ($reply.TimedOut -or $reply.Exit -ne 0) { throw 'Remote listing unavailable' }
    $parsed = $reply.Output | ConvertFrom-Json -ErrorAction Stop
    foreach ($item in @($parsed)) {
        if ($null -eq $item) { continue }
        [pscustomobject]@{
            Dir = [string]$item.dir; Name = [string]$item.name; Bytes = [long]$item.bytes
            Sha256 = [string]$item.sha256; SourcePath = $null
        }
    }
}

function Get-LocalConversionListing([string]$SourceRoot) {
    $SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
    if (-not [IO.Directory]::Exists($SourceRoot)) { throw 'Source root not found' }
    foreach ($sub in @('', 'history')) {
        $dir = if ($sub) { Join-Path $SourceRoot $sub } else { $SourceRoot }
        if (-not [IO.Directory]::Exists($dir)) { continue }
        foreach ($path in [IO.Directory]::GetFiles($dir)) {
            $info = New-Object IO.FileInfo $path
            $hash = ''
            if ((Test-ConversionFileName $info.Name $sub) -and -not ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $hash = Get-Sha256 $info.FullName
            }
            [pscustomobject]@{ Dir = $sub; Name = $info.Name; Bytes = [long]$info.Length; Sha256 = $hash; SourcePath = $info.FullName }
        }
    }
}

function Copy-ShopConversionFile([string]$Folder, [string]$Name, [string]$Temp, [int]$TimeoutSeconds) {
    if (-not (Test-ConversionFileName $Name $Folder)) { throw 'Name not allow-listed' }
    $remote = 'shop-pc:C:/LaundryStores/fxwash/data/conversions/'
    if ($Folder) { $remote = $remote + $Folder + '/' }
    $remote = $remote + $Name
    $reply = Invoke-ShopProcess 'scp.exe' @('-p', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=yes', $remote, $Temp) $TimeoutSeconds
    return (-not $reply.TimedOut -and $reply.Exit -eq 0)
}

function Write-ConversionsPullLog([string]$Path, [string]$Result, $Counts, [int]$ExitCode) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)))
    $record = [ordered]@{ ts = [DateTimeOffset]::Now.ToString('o'); result = $Result }
    foreach ($key in $Counts.Keys) { $record[$key] = $Counts[$key] }
    $record['exit'] = $ExitCode
    $line = $record | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($Path, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding $false))
}

function Invoke-ConversionsPull {
    [CmdletBinding()]
    param([string]$SourceRoot = '', [string]$TargetRoot, [string]$LogPath, [int]$TimeoutSeconds = 60)
    $ErrorActionPreference = 'Stop'
    $result = 'LOCAL_ERROR'; $code = 1
    $listed = 0; $ignored = 0; $unchanged = 0; $installed = 0; $invalid = 0; $failed = 0
    try {
        $useLocal = -not [string]::IsNullOrEmpty($SourceRoot)
        $TargetRoot = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
        $parent = [IO.Path]::GetDirectoryName($TargetRoot)
        if (-not $parent -or -not [IO.Directory]::Exists($parent)) { $result = 'TARGET_PARENT_MISSING'; $code = 1; return $code }
        try {
            if ($useLocal) { $entries = @(Get-LocalConversionListing $SourceRoot) }
            else { $entries = @(Get-ShopConversionListing $TimeoutSeconds) }
        }
        catch { Write-Verbose $_.Exception.Message; $result = 'LISTING_UNAVAILABLE'; $code = 1; return $code }
        # History revisions first, then the current weekly files.
        $ordered = @($entries | Sort-Object -Property @{ Expression = { $_.Dir }; Descending = $true }, @{ Expression = { $_.Name }; Descending = $false })
        foreach ($entry in $ordered) {
            if (-not (Test-ConversionFileName $entry.Name $entry.Dir) -or -not ($entry.Sha256 -cmatch '^[0-9A-F]{64}\z')) {
                $ignored++; continue
            }
            $listed++
            $temp = $null
            try {
                $directory = $TargetRoot
                if ($entry.Dir) { $directory = Join-Path $TargetRoot $entry.Dir }
                $destination = [IO.Path]::GetFullPath((Join-Path $directory $entry.Name))
                if (-not $destination.StartsWith($TargetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { $invalid++; continue }
                if ($entry.Bytes -lt 2 -or $entry.Bytes -gt 5MB) { $invalid++; continue }
                if ([IO.File]::Exists($destination)) {
                    if ((Get-Sha256 $destination) -ceq $entry.Sha256) { $unchanged++; continue }
                }
                [void][IO.Directory]::CreateDirectory($directory)
                $temp = Join-Path $directory ('.conversions-' + [guid]::NewGuid().ToString('N') + '.tmp')
                $copied = $false
                if ($useLocal) { [IO.File]::Copy($entry.SourcePath, $temp, $false); $copied = $true }
                else { $copied = Copy-ShopConversionFile $entry.Dir $entry.Name $temp $TimeoutSeconds }
                if (-not $copied -or -not [IO.File]::Exists($temp)) { $failed++; continue }
                # Size/hash mismatch: incomplete copy or source rewritten meanwhile; retry next run.
                if ((New-Object IO.FileInfo $temp).Length -ne $entry.Bytes -or (Get-Sha256 $temp) -cne $entry.Sha256) { $failed++; continue }
                if (-not (Test-ConversionJson $temp)) { $invalid++; continue }
                if ([IO.File]::Exists($destination)) {
                    # Same directory; atomic overwrite (Move-Item -Force is not atomic on PS 5.1).
                    [IO.File]::Replace($temp, $destination, [NullString]::Value, $true)
                }
                else { Move-Item -LiteralPath $temp -Destination $destination -ErrorAction Stop }
                $temp = $null
                $installed++
            }
            catch { Write-Verbose $_.Exception.Message; $failed++ }
            finally { if ($temp -and [IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
        }
        if ($failed -gt 0) { $result = 'TRANSPORT_OR_LOCAL_ERROR'; $code = 1 }
        elseif ($invalid -gt 0) { $result = 'VALIDATION_FAILED'; $code = 2 }
        elseif ($installed -gt 0) { $result = 'INSTALLED'; $code = 0 }
        else { $result = 'NOTHING_NEW'; $code = 0 }
        return $code
    }
    catch { Write-Verbose $_.Exception.Message; $result = 'LOCAL_ERROR'; $code = 1; return $code }
    finally {
        Write-ConversionsPullLog $LogPath $result ([ordered]@{
            listed = $listed; ignored = $ignored; unchanged = $unchanged
            installed = $installed; invalid = $invalid; failed = $failed }) $code
    }
}

if ($PSBoundParameters.ContainsKey('SourceRoot') -ne $PSBoundParameters.ContainsKey('TargetRoot')) {
    [Console]::Error.WriteLine('Pass both -SourceRoot and -TargetRoot (local test mode) or neither (shop transport).')
    exit 1
}
exit (Invoke-ConversionsPull -SourceRoot $SourceRoot -TargetRoot $TargetRoot -LogPath $LogPath -TimeoutSeconds $TimeoutSeconds)
