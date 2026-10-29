[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)][string]$From,
    [ValidateSet('secrets','data','state','tasks','mdb')][string]$Only,
    [string]$Root = 'C:\Users\cyc39\laundry-repo',
    [string]$LocalStateRoot = (Join-Path $env:LOCALAPPDATA 'line-bot'),
    [string]$MdbPath = 'C:\FXwash\eHank.mdb',
    [string]$PreRestoreRoot = 'D:\AI-Lanes-work\_backups\sxj-live',
    [string]$TaskRestoreDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
$From = Get-RecoveryFullPath $From
$Root = Get-RecoveryFullPath $Root
$LocalStateRoot = Get-RecoveryFullPath $LocalStateRoot
$MdbPath = Get-RecoveryFullPath $MdbPath
$PreRestoreRoot = Get-RecoveryFullPath $PreRestoreRoot
Assert-RecoveryStoragePath $PreRestoreRoot
if ($TaskRestoreDirectory) { $TaskRestoreDirectory = Get-RecoveryFullPath $TaskRestoreDirectory }
foreach ($target in @($Root,$LocalStateRoot,$MdbPath) + @($TaskRestoreDirectory | Where-Object { $_ })) {
    Assert-RecoveryDisjoint $target $From
    Assert-RecoveryDisjoint $target $PreRestoreRoot
}
# Validate the ENTIRE backup first, including categories excluded by -Only.
$manifest = Read-RecoveryManifest $From
$selected = @($manifest.Files | Where-Object { -not $Only -or $_.Category -eq $Only } | Sort-Object { $_.Category -eq 'tasks' })
if ($selected.Count -eq 0) { throw 'No existing files in this category/snapshot. ABSENT-BEFORE.json is informational; no automatic deletion is performed.' }
$plan = @()
$seen = @{}
foreach ($entry in $selected) {
    $destination = $null; $boundary = $null
    switch ($entry.Category) {
        'secrets' { $boundary = $Root; $destination = Join-RecoveryPath $Root $entry.RelativePath }
        'data' { $boundary = $Root; $destination = Join-RecoveryPath $Root $entry.RelativePath }
        'state' {
            if ($entry.RelativePath.StartsWith('local/')) {
                $boundary = $LocalStateRoot; $destination = Join-RecoveryPath $LocalStateRoot $entry.RelativePath.Substring(6)
            } else { $boundary = $Root; $destination = Join-RecoveryPath $Root $entry.RelativePath }
        }
        'mdb' { $destination = $MdbPath; $boundary = Split-Path -Parent $MdbPath; Assert-RecoveryStoragePath $MdbPath }
        'tasks' {
            if ($TaskRestoreDirectory) { $boundary = $TaskRestoreDirectory; $destination = Join-RecoveryPath $TaskRestoreDirectory $entry.RelativePath }
            else { $destination = 'scheduled-task:' + $entry.TaskPath + $entry.TaskName }
        }
    }
    if ($boundary) { Assert-RecoveryNoLinks $destination $boundary }
    if ($seen.ContainsKey($destination)) { throw 'Multiple entries resolve to the same destination.' }
    $seen[$destination] = $true
    $plan += [pscustomobject]@{ Entry = $entry; Destination = $destination; Boundary = $boundary }
}
if (-not $PSCmdlet.ShouldProcess(($plan.Destination -join ', '), 'Snapshot existing files/tasks, then restore verified backup')) {
    return [pscustomobject]@{ WhatIf = $true; RestoredCount = 0; PlannedCount = $plan.Count }
}

# Capture all existing affected destinations before the first overwrite/registration.
$previous = @(); $previousTasks = @(); $missing = @()
$existingTasks = @()
if (-not $TaskRestoreDirectory -and @($selected | Where-Object { $_.Category -eq 'tasks' }).Count -gt 0) {
    foreach ($entry in @($selected | Where-Object { $_.Category -eq 'tasks' })) {
        Assert-RecoveryTaskAccount (Get-Content -LiteralPath (Join-RecoveryPath $From $entry.BackupPath) -Raw -Encoding UTF8)
    }
    # Enumerate once: querying a missing TaskPath directly would fail on a new machine.
    $existingTasks = @(Get-ScheduledTask -ErrorAction Stop)
}
foreach ($item in $plan) {
    $entry = $item.Entry
    if ($entry.Category -eq 'tasks' -and -not $TaskRestoreDirectory) {
        $existing = @($existingTasks | Where-Object { $_.TaskName -eq $entry.TaskName -and $_.TaskPath -eq $entry.TaskPath })
        if ($existing.Count -gt 0) {
            $xml = Export-ScheduledTask -TaskName $entry.TaskName -TaskPath $entry.TaskPath -ErrorAction Stop
            $old = New-RecoveryTaskEntry $entry.TaskName $entry.TaskPath $xml $item.Destination
            $previous += $old; $previousTasks += [pscustomobject]@{ Entry = $old; Xml = $xml }
        } else { $missing += $item.Destination }
    } elseif (Test-Path -LiteralPath $item.Destination -PathType Leaf) {
        # Fixture XML is copied byte-for-byte, including a changed existing definition.
        $old = New-RecoveryEntry $entry.Category $entry.RelativePath $item.Destination
        $old.TaskName = $entry.TaskName; $old.TaskPath = $entry.TaskPath
        $previous += $old
    } elseif (Test-Path -LiteralPath $item.Destination) { throw "Restore destination is not a file: $($item.Destination)" }
    else { $missing += $item.Destination }
}
$preDirectory = New-RecoveryDirectory $PreRestoreRoot 'pre-restore-'
foreach ($old in $previous) {
    $destination = Join-RecoveryPath $preDirectory $old.BackupPath
    if ($old.SourcePath.StartsWith('scheduled-task:')) {
        $oldTask = $previousTasks | Where-Object { $_.Entry.BackupPath -eq $old.BackupPath }
        Write-RecoveryTaskPayload $destination $oldTask.Xml $old
    } else { Copy-RecoveryPayload $old.SourcePath $destination $old }
}
# Empty previous sets (a newly rebuilt machine) still record the absence inventory.
if ($previous.Count -gt 0) { Complete-RecoveryManifest $preDirectory 'sxj-pre-restore' $previous }
else {
    Write-RecoveryJson (Join-Path $preDirectory 'MANIFEST.json') ([ordered]@{
        SchemaVersion=1; Kind='sxj-pre-restore'; Status='Complete'; CompletedUtc=[DateTime]::UtcNow.ToString('o'); Files=@()
    })
}
Write-RecoveryJson (Join-Path $preDirectory 'ABSENT-BEFORE.json') @($missing)
foreach ($item in $plan) {
    $entry = $item.Entry
    $payload = Join-RecoveryPath $From $entry.BackupPath
    Assert-RecoveryNoLinks $payload $From
    Assert-RecoveryPayload $payload $entry
    if ($item.Boundary) { Assert-RecoveryNoLinks $item.Destination $item.Boundary }
    if ($entry.Category -eq 'tasks' -and -not $TaskRestoreDirectory) {
        # Register-ScheduledTask has no native -WhatIf; our enclosing ShouldProcess is the gate.
        $xml = Get-Content -LiteralPath $payload -Raw -Encoding UTF8
        Ensure-RecoveryTaskFolder $entry.TaskPath
        Register-ScheduledTask -TaskName $entry.TaskName -TaskPath $entry.TaskPath -Xml $xml -Force -ErrorAction Stop | Out-Null
        $readback = Export-ScheduledTask -TaskName $entry.TaskName -TaskPath $entry.TaskPath -ErrorAction Stop
        $null = New-RecoveryTaskEntry $entry.TaskName $entry.TaskPath $readback $item.Destination
        Assert-RecoveryTaskEquivalent $xml $readback
    } else { Copy-RecoveryPayload $payload $item.Destination $entry }
}
[pscustomobject]@{ RestoredCount=$plan.Count; PreRestoreDirectory=$preDirectory; Verified=$true; TasksMode=$(if ($TaskRestoreDirectory) {'FixtureDirectory'} else {'WindowsScheduler'}) }
