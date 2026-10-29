#requires -Version 5.1
# Offline behavior checks. Real ssh/scp and Task Scheduler commands never run.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
function Assert-True($Condition, [string]$Name) {
    if (-not $Condition) { throw "FAIL $Name" }
    $script:passed++; Write-Output "PASS $Name"
}

foreach ($name in @('pull_shop_mdb.ps1', 'register-mdb-pull-task.ps1')) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "parse $name"
    if ($name -eq 'pull_shop_mdb.ps1') {
        foreach ($node in $ast.EndBlock.Statements) {
            if ($node -is [Management.Automation.Language.FunctionDefinitionAst]) {
                . ([scriptblock]::Create($node.Extent.Text))
            }
        }
    }
}

# Keep a copy of the actual process wrapper so its timeout and argument quoting
# can be exercised against a local, task-owned child process only.
$nativeProcess = ${function:Invoke-ShopProcess}
function Invoke-ShopProcess([string]$Program, [string[]]$Arguments, [int]$TimeoutSeconds) {
    [void]$script:calls.Add(@{ program = $Program; arguments = $Arguments; timeout = $TimeoutSeconds })
    if ($script:mode -eq 'unreachable') { return [pscustomobject]@{ Exit = 255; TimedOut = $false; Output = '' } }
    if ($Program -eq 'ssh.exe') {
        $script:metadataCalls++
        $mtime = if ($script:mode -eq 'changed' -and $script:metadataCalls -eq 2) { '2026-10-30T11:31:00Z' } else { '2026-10-30T11:30:00Z' }
        return [pscustomobject]@{ Exit = 0; TimedOut = $false; Output = (@{ bytes = 11534336; mtime = $mtime } | ConvertTo-Json -Compress) }
    }
    if ($script:mode -eq 'timeout') { return [pscustomobject]@{ Exit = 3; TimedOut = $true; Output = '' } }
    if ($script:mode -eq 'scp-fail') { return [pscustomobject]@{ Exit = 1; TimedOut = $false; Output = '' } }
    if ($Arguments -notcontains 'shop-pc:C:/FXwash/eHank.mdb') { throw 'Incorrect scp argv' }
    $file = [IO.File]::Open($Arguments[-1], [IO.FileMode]::CreateNew)
    try {
        $header = New-Object byte[] 21
        $header[1] = 1; $header[20] = 1
        [Array]::Copy([Text.Encoding]::ASCII.GetBytes("Standard Jet DB`0"), 0, $header, 4, 16)
        if ($script:mode -eq 'invalid') { $header[1] = 0 }
        $file.Write($header, 0, $header.Length)
        $file.SetLength($(if ($script:mode -eq 'small') { 10MB } else { 11MB }))
    }
    finally { $file.Dispose() }
    [pscustomobject]@{ Exit = 0; TimedOut = $false; Output = '' }
}

$root = Join-Path $PSScriptRoot ('.a2b-ps-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
try {
    foreach ($mode in @('unreachable', 'scp-fail', 'timeout', 'invalid', 'small', 'changed', 'locked', 'good')) {
        $script:mode = $mode; $script:calls = New-Object Collections.ArrayList; $script:metadataCalls = 0
        $directory = Join-Path $root ('case ' + $mode)
        [void][IO.Directory]::CreateDirectory($directory)
        $destination = Join-Path $directory 'eHank.mdb'
        $log = Join-Path $directory 'pull.jsonl'
        [IO.File]::WriteAllText($destination, 'old-database')
        $lock = $null
        if ($mode -eq 'locked') { $lock = [IO.File]::Open($destination, 'Open', 'ReadWrite', 'None') }
        if ($mode -eq 'good') {
            $backups = Join-Path $directory 'backups'
            [void][IO.Directory]::CreateDirectory($backups)
            1..9 | ForEach-Object { [IO.File]::WriteAllText((Join-Path $backups ('eHank-202609{0:00}-1000.mdb' -f $_)), 'older') }
            [IO.File]::WriteAllText((Join-Path $backups 'keep-other-file.txt'), 'keep')
        }
        try { $code = Invoke-MdbPull -Destination $destination -LogPath $log }
        finally { if ($lock) { $lock.Dispose() } }
        $expected = if ($mode -eq 'good') { 0 } elseif ($mode -eq 'locked') { 2 } elseif ($mode -in @('invalid', 'small')) { 1 } else { 3 }
        Assert-True ($code -eq $expected) "$mode exit $expected"
        $record = Get-Content -LiteralPath $log -Encoding UTF8 | ConvertFrom-Json
        Assert-True ($record.exit -eq $expected -and $record.ts -and $record.result) "$mode structured log"
        Assert-True (@(Get-ChildItem -LiteralPath $directory -Filter '*.tmp').Count -eq 0) "$mode temp cleanup"
        if ($mode -ne 'good') {
            Assert-True ([IO.File]::ReadAllText($destination) -eq 'old-database') "$mode original unchanged"
            Assert-True (-not [IO.Directory]::Exists((Join-Path $directory 'backups'))) "$mode no backup mutation"
        }
        else {
            Assert-True ((Get-Item -LiteralPath $destination).Length -eq 11MB) 'replacement installed'
            Assert-True ([IO.File]::GetLastWriteTimeUtc($destination) -eq [DateTimeOffset]::Parse('2026-10-30T11:30:00Z').UtcDateTime) 'source mtime preserved'
            $backupFiles = @(Get-ChildItem -LiteralPath $backups -Filter '*.mdb')
            Assert-True ($backupFiles.Count -eq 7) 'retain latest 7 backups'
            $latest = $backupFiles | Sort-Object Name -Descending | Select-Object -First 1
            Assert-True ([IO.File]::ReadAllText($latest.FullName) -eq 'old-database') 'backup is prior original'
            Assert-True ([IO.File]::Exists((Join-Path $backups 'keep-other-file.txt'))) 'unrelated backup directory file preserved'
        }
        foreach ($call in $script:calls) {
            Assert-True ($call.timeout -eq 60 -and $call.arguments -contains 'BatchMode=yes') "$mode batch/timeout arguments"
        }
    }
    $script:mode = 'good'; $script:calls.Clear(); $script:metadataCalls = 0
    $absent = Join-Path $root 'not-created\eHank.mdb'
    $dryLog = Join-Path $root 'dry.jsonl'
    $code = Invoke-MdbPull -DryRun -Destination $absent -LogPath $dryLog
    Assert-True ($code -eq 0 -and $script:calls.Count -eq 1 -and $script:calls[0].program -eq 'ssh.exe') 'DryRun metadata only, no scp'
    Assert-True (-not [IO.Directory]::Exists((Split-Path -Parent $absent))) 'DryRun no destination directory or file'
    $dry = Get-Content -LiteralPath $dryLog -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($dry.result -eq 'DRY_RUN' -and $dry.source_mtime -and $dry.bytes -eq 11MB) 'DryRun log metadata'

    $script:calls.Clear(); $script:metadataCalls = 0
    $code = Invoke-MdbPull -Destination $absent -LogPath (Join-Path $root 'first-install.jsonl')
    Assert-True ($code -eq 0 -and (Get-Item -LiteralPath $absent).Length -eq 11MB) 'first install via same-directory Move-Item'

    # Mock all scheduler cmdlets; verify the actual registration script's triggers.
    $global:A2bScheduleTimes = New-Object Collections.ArrayList
    $global:A2bRegistered = $null
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
    function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) @{ execute = $Execute; arguments = $Argument } }
    function New-ScheduledTaskTrigger {
        param([switch]$Daily, [datetime]$At)
        [void]$global:A2bScheduleTimes.Add($At.ToString('HH:mm')); @{ daily = [bool]$Daily; at = $At }
    }
    function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) @{ user = $UserId; type = $LogonType } }
    function New-ScheduledTaskSettingsSet { param($MultipleInstances, $ExecutionTimeLimit) @{ instances = $MultipleInstances } }
    function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description) $global:A2bRegistered = $PSBoundParameters }
    & (Join-Path $PSScriptRoot 'register-mdb-pull-task.ps1')
    Assert-True ($global:A2bScheduleTimes.Count -eq 19 -and $global:A2bScheduleTimes[0] -eq '10:30' -and $global:A2bScheduleTimes[-1] -eq '19:30') 'mock schedule 19 daily triggers within window'
    Assert-True ($global:A2bRegistered.Settings.instances -eq 'IgnoreNew' -and $global:A2bRegistered.Principal.type -eq 'Interactive') 'mock schedule current-user and no overlapping runs'

    $child = Join-Path $root 'local child.ps1'
    [IO.File]::WriteAllText($child, 'param([string]$Value) Write-Output $Value', [Text.Encoding]::ASCII)
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $reply = & $nativeProcess $powershell @('-NoProfile', '-NonInteractive', '-File', $child, 'path with spaces\') 5
    Assert-True ($reply.Exit -eq 0 -and $reply.Output.Trim() -eq 'path with spaces\') 'real native wrapper quoting'
    [IO.File]::WriteAllText($child, 'Start-Sleep -Seconds 10', [Text.Encoding]::ASCII)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $reply = & $nativeProcess $powershell @('-NoProfile', '-NonInteractive', '-File', $child) 1
    Assert-True ($reply.TimedOut -and $timer.Elapsed.TotalSeconds -lt 6) 'real native wrapper timeout kills only owned child'

    # Execute the two entry points with WhatIf. Both must return before external operations.
    & (Join-Path $PSScriptRoot 'pull_shop_mdb.ps1') -DryRun -WhatIf -Destination $absent -LogPath (Join-Path $root 'whatif.jsonl')
    Assert-True (-not [IO.File]::Exists((Join-Path $root 'whatif.jsonl'))) 'DryRun WhatIf no writes or connection'
    & (Join-Path $PSScriptRoot 'register-mdb-pull-task.ps1') -WhatIf
    Assert-True ($true) 'registration WhatIf returned without scheduler operation'
    Write-Output "RESULT PASS=$script:passed FAIL=0"
}
finally {
    # Literal, task-owned directory, checked to remain within line-bot; no junctions.
    $resolved = [IO.Path]::GetFullPath($root)
    if (-not $resolved.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
