# Backup contains plaintext credentials. Restrict destination ACLs before live use.
[CmdletBinding()]
param(
    [string]$Root = 'C:\Users\cyc39\laundry-repo',
    [string]$LocalStateRoot = (Join-Path $env:LOCALAPPDATA 'line-bot'),
    [string]$MdbPath = 'C:\FXwash\eHank.mdb',
    [string]$BackupRoot = 'D:\AI-Lanes-work\_backups\sxj-live',
    [string]$TaskXmlSource,
    [ValidateRange(1,3650)][int]$Keep = 14,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'Recovery.Common.ps1')
$skipped = New-Object 'Collections.Generic.List[object]'
$excludeFilePatterns = @('*.lock','*.pid','*.tmp')
try {
    $Root = Get-RecoveryFullPath $Root
    $LocalStateRoot = Get-RecoveryFullPath $LocalStateRoot
    $MdbPath = Get-RecoveryFullPath $MdbPath
    $BackupRoot = Get-RecoveryFullPath $BackupRoot
    Assert-RecoveryStoragePath $BackupRoot
    foreach ($source in @($Root, $LocalStateRoot, $MdbPath)) { Assert-RecoveryDisjoint $source $BackupRoot }
    if ($TaskXmlSource) {
        $TaskXmlSource = Get-RecoveryFullPath $TaskXmlSource
        Assert-RecoveryDisjoint $TaskXmlSource $BackupRoot
    }
    $entries = @()
    Assert-RecoveryNoLinks (Join-Path $Root 'secrets') $Root
    foreach ($file in @(Get-RecoveryFiles (Join-Path $Root 'secrets') -ExcludeFilePatterns $excludeFilePatterns)) {
        $relative = $file.FullName.Substring($Root.Length + 1).Replace('\','/')
        $entries += @(New-RecoveryEntry 'secrets' $relative $file.FullName -Skipped $skipped)
    }
    Assert-RecoveryNoLinks (Join-Path $Root '.env') $Root
    $entries += @(New-RecoveryEntry 'secrets' '.env' (Join-Path $Root '.env') -Skipped $skipped)
    Assert-RecoveryNoLinks (Join-Path $Root 'data') $Root
    foreach ($file in @(Get-RecoveryFiles (Join-Path $Root 'data') -ExcludeMedia -ExcludeFilePatterns $excludeFilePatterns -Skipped $skipped)) {
        $relative = $file.FullName.Substring($Root.Length + 1).Replace('\','/')
        $entries += @(New-RecoveryEntry 'data' $relative $file.FullName -Skipped $skipped)
    }
    $lineState = Join-Path $Root 'line-bot'
    if (-not (Test-Path -LiteralPath $lineState -PathType Container)) { throw "Missing source directory: $lineState" }
    Assert-RecoveryNoLinks $lineState $Root
    foreach ($file in @(Invoke-RecoverySourceRead $lineState { Get-ChildItem -LiteralPath $lineState -File -Force -ErrorAction Stop } $skipped) | Where-Object { $_.Extension -in @('.json','.txt') }) {
        Assert-RecoveryNoLinks $file.FullName $Root
        $entries += @(New-RecoveryEntry 'state' ('line-bot/' + $file.Name) $file.FullName -Skipped $skipped)
    }
    if (-not (Test-Path -LiteralPath $LocalStateRoot -PathType Container)) { throw "Missing source directory: $LocalStateRoot" }
    foreach ($file in @(Invoke-RecoverySourceRead $LocalStateRoot { Get-ChildItem -LiteralPath $LocalStateRoot -File -Force -ErrorAction Stop } $skipped) | Where-Object { $_.Extension -eq '.jsonl' }) {
        Assert-RecoveryNoLinks $file.FullName $LocalStateRoot
        $entries += @(New-RecoveryEntry 'state' ('local/' + $file.Name) $file.FullName -Skipped $skipped)
    }
    Assert-RecoveryStoragePath $MdbPath
    $entries += @(New-RecoveryEntry 'mdb' 'eHank.mdb' $MdbPath -Skipped $skipped)
    $tasks = @(Get-RecoveryTasks $TaskXmlSource -Skipped $skipped -ExcludeFilePatterns $excludeFilePatterns)
    $entries += @($tasks | ForEach-Object { $_.Entry })
    $seen = @{}
    foreach ($entry in $entries) {
        if ($seen.ContainsKey($entry.BackupPath)) { throw "Duplicate inventory entry: $($entry.BackupPath)" }
        $seen[$entry.BackupPath] = $true
    }
    if ($DryRun) {
        return [pscustomobject]@{
            DryRun = $true; BackupRoot = $BackupRoot; FileCount = $entries.Count
            Files = @($entries | Select-Object Category,RelativePath,SourcePath,Size)
            SkippedCount = $skipped.Count; Skipped = @($skipped.ToArray()); ExcludedFilePatterns = $excludeFilePatterns
        }
    }
    $directory = New-RecoveryDirectory $BackupRoot ''
    $copied = @()
    foreach ($entry in $entries) {
        $destination = Join-RecoveryPath $directory $entry.BackupPath
        if ($entry.Category -eq 'tasks') {
            $task = $tasks | Where-Object { $_.Entry.BackupPath -eq $entry.BackupPath }
            Write-RecoveryTaskPayload $destination $task.Xml $entry
        } elseif (-not (Copy-RecoveryBackupPayload $entry.SourcePath $destination $entry $skipped)) { continue }
        $copied += $entry
    }
    Complete-RecoveryManifest $directory 'sxj-live-backup' $copied -Skipped $skipped.ToArray() -ExcludedFilePatterns $excludeFilePatterns
    Remove-RecoveryOldBackups $BackupRoot $Keep
    [pscustomobject]@{
        BackupDirectory = $directory; FileCount = $copied.Count; Verified = $true
        SkippedCount = $skipped.Count; Skipped = @($skipped.ToArray())
    }
} finally { Write-Host ('A5_BACKUP skipped={0}' -f $skipped.Count) }
