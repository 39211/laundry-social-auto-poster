#requires -Version 5.1
<#
Weekly attribution export + retention on the shop PC (task card B2-7).

Runs from <Root>:
  python -I -S -B runtime\attribution_export.py --root .      (last week, no --week)
  python -I -S -B runtime\attribution_retention.py --root .   (only if export exit is 0 or 2)

Log : <Root>\logs\attribution_weekly.log, one line per step that ran:
      <timestamp> step=<export|retention> exit=<code> summary=<last stdout line of the CLI>[ stderr_lines=N]
      Python stderr is never printed or logged (only its line count). A refused run
      (lock held) writes one step=lock line and runs no step.
Lock: <Root>\data\attribution_weekly.lock, create-new semantics; a lock older than 2 hours
      is taken over. The handle stays open (no delete sharing) for the whole run.
Exit: 0 when export is 0 or 2 and retention is 0; otherwise the first failing step's code
      (1..3; any other failing code is reported as 1). 3 when another run holds the lock.
      1 when the root/data folder is unusable.
#>
[CmdletBinding()]
param(
    [string]$Root = 'C:\LaundryStores\fxwash',
    [string]$Python = 'C:\LaundryStores\python-portable\python.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function ConvertTo-NativeArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting, including spaces and trailing slashes.
    '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Get-StepSummary([string]$Text) {
    $lines = @(($Text -split "`r?`n") | Where-Object { $_.Trim().Length -gt 0 })
    if ($lines.Count -eq 0) { return '(no summary)' }
    $line = $lines[$lines.Count - 1].Trim() -replace '[\x00-\x1F\x7F]', ' '
    if ($line.Length -gt 300) { $line = $line.Substring(0, 300) + '...' }
    return $line
}

function Get-FailureCode([int]$Code) {
    if ($Code -ge 1 -and $Code -le 3) { return $Code }
    return 1
}

function Write-WeeklyLog([string]$LogPath, [string]$Step, [string]$ExitText, [string]$Summary) {
    $line = [DateTimeOffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz') + ' step=' + $Step + ' exit=' + $ExitText + ' summary=' + $Summary
    [IO.File]::AppendAllText($LogPath, $line + "`r`n", (New-Object Text.UTF8Encoding $false))
    Write-Host $line
}

function Invoke-PythonStep([string]$Python, [string]$Root, [string]$ScriptRelative) {
    # A missing script would make python exit 2, which must never be read as "nothing to export".
    if (-not [IO.File]::Exists((Join-Path $Root $ScriptRelative))) {
        return [pscustomobject]@{ Exit = 1; Summary = 'step script not found' }
    }
    $process = New-Object System.Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Python
        $process.StartInfo.Arguments = ((@('-I', '-S', '-B', $ScriptRelative, '--root', '.') |
            ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
        $process.StartInfo.WorkingDirectory = $Root
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        try { [void]$process.Start() }
        catch { return [pscustomobject]@{ Exit = 1; Summary = 'python could not be started' } }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        # No kill on a long run: interrupting retention mid-rewrite is worse than waiting.
        $process.WaitForExit()
        $outText = $stdout.GetAwaiter().GetResult()
        $errText = $stderr.GetAwaiter().GetResult()
        $summary = Get-StepSummary $outText
        $errLines = @(($errText -split "`r?`n") | Where-Object { $_.Trim().Length -gt 0 }).Count
        if ($errLines -gt 0) { $summary = $summary + ' stderr_lines=' + $errLines }
        return [pscustomobject]@{ Exit = $process.ExitCode; Summary = $summary }
    }
    finally { $process.Dispose() }
}

function Enter-RunLock([string]$Path, [TimeSpan]$StaleAfter) {
    $tookOver = $false
    $ageMinutes = 0
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $stream = $null
        try {
            $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        }
        catch {
            if ($attempt -eq 2) { break }
            if (-not [IO.File]::Exists($Path)) { continue }   # vanished meanwhile, or not a file: one retry
            $age = [DateTime]::UtcNow - [IO.File]::GetLastWriteTimeUtc($Path)
            $ageMinutes = [int][Math]::Floor($age.TotalMinutes)
            if ($age.Duration() -lt $StaleAfter) { break }
            # A live run holds its handle without delete sharing, so this fails for it.
            try { [IO.File]::Delete($Path) } catch { break }
            $tookOver = $true
            continue
        }
        $bytes = [Text.Encoding]::ASCII.GetBytes('pid=' + $PID + ' started=' + [DateTimeOffset]::Now.ToString('o') + "`r`n")
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        return @{ Stream = $stream; TookOver = $tookOver; AgeMinutes = $ageMinutes }
    }
    return @{ Stream = $null; TookOver = $false; AgeMinutes = $ageMinutes }
}

$exitCode = 1
$lockStream = $null
$lockPath = $null
try {
    $Root = [IO.Path]::GetFullPath($Root)
    $dataDir = Join-Path $Root 'data'
    if (-not [IO.Directory]::Exists($dataDir)) { throw 'data folder not found under the root' }
    $logDir = Join-Path $Root 'logs'
    [void][IO.Directory]::CreateDirectory($logDir)
    $logPath = Join-Path $logDir 'attribution_weekly.log'
    $lockPath = Join-Path $dataDir 'attribution_weekly.lock'

    $lock = Enter-RunLock $lockPath (New-TimeSpan -Hours 2)
    if ($null -eq $lock.Stream) {
        Write-WeeklyLog $logPath 'lock' '3' ('another run holds the lock (age ' + $lock.AgeMinutes + ' min); no step run')
        $exitCode = 3
    }
    else {
        $lockStream = $lock.Stream
        $note = ''
        if ($lock.TookOver) { $note = 'stale lock taken over; ' }
        $export = Invoke-PythonStep $Python $Root 'runtime\attribution_export.py'
        Write-WeeklyLog $logPath 'export' ([string]$export.Exit) ($note + $export.Summary)
        if ($export.Exit -eq 0 -or $export.Exit -eq 2) {
            $retention = Invoke-PythonStep $Python $Root 'runtime\attribution_retention.py'
            Write-WeeklyLog $logPath 'retention' ([string]$retention.Exit) $retention.Summary
            if ($retention.Exit -eq 0) { $exitCode = 0 } else { $exitCode = Get-FailureCode $retention.Exit }
        }
        else {
            $exitCode = Get-FailureCode $export.Exit
        }
    }
}
catch {
    [Console]::Error.WriteLine('attribution_weekly: ' + $_.Exception.Message)
    $exitCode = 1
}
finally {
    if ($null -ne $lockStream) {
        $lockStream.Dispose()
        try { [IO.File]::Delete($lockPath) } catch { }
    }
}
exit $exitCode
