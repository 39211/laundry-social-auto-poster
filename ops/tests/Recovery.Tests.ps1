# All mutations are confined to ops/_tmp. No real task/provider calls.
$ErrorActionPreference = 'Stop'
$opsRoot = Split-Path -Parent $PSScriptRoot
$drillRoot = Join-Path $opsRoot ('_tmp/drill-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $drillRoot -Force | Out-Null
$clock = [Diagnostics.Stopwatch]::StartNew()

function Write-Fixture([string]$Path, [string]$Value) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}
function New-Fixture([string]$Name) {
    $base = Join-Path $drillRoot $Name
    $args = @{
        Root = Join-Path $base 'source'
        LocalStateRoot = Join-Path $base 'local-state'
        MdbPath = Join-Path $base 'fxwash/eHank.mdb'
        TaskXmlSource = Join-Path $base 'task-source'
        BackupRoot = Join-Path $base 'backups'
    }
    Write-Fixture (Join-Path $args.Root 'secrets/line.json') '{"token":"SYNTHETIC-NOT-A-CREDENTIAL"}'
    Write-Fixture (Join-Path $args.Root '.env') 'A5_FIXTURE=1'
    Write-Fixture (Join-Path $args.Root 'data/leads/list.jsonl') '{"synthetic":true}'
    Write-Fixture (Join-Path $args.Root 'data/posted-log/20261030.json') '{"fixture":1}'
    Write-Fixture (Join-Path $args.Root 'data/photos/skip.jpg') 'EXCLUDED'
    Write-Fixture (Join-Path $args.Root 'data/video-fixture/skip.bin') 'EXCLUDED'
    Write-Fixture (Join-Path $args.Root 'data/nested/video-large/skip.bin') 'EXCLUDED'
    Write-Fixture (Join-Path $args.Root 'line-bot/public_base.txt') 'https://invalid.example/a5'
    Write-Fixture (Join-Path $args.Root 'line-bot/richmenu-id.json') '{"fixture":2}'
    Write-Fixture (Join-Path $args.Root 'line-bot/staff-target.txt') 'SYNTHETIC-STAFF'
    Write-Fixture (Join-Path $args.Root 'line-bot/ignore.py') 'EXCLUDED'
    Write-Fixture (Join-Path $args.LocalStateRoot 'tunnel_events.jsonl') '{"fixture":3}'
    Write-Fixture (Join-Path $args.LocalStateRoot 'ignore.pid') 'EXCLUDED'
    Write-Fixture $args.MdbPath 'SYNTHETIC-MDB-BYTES'
    foreach ($pair in @(@('Laundry-Backup','\'), @('AI-Daily-Test','\A5\'), @('SXJ-Test','\'))) {
        $xml = '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task" version="1.2"><RegistrationInfo><URI>' + $pair[1] + $pair[0] + '</URI></RegistrationInfo><Triggers/><Principals/><Settings/><Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions></Task>'
        $relative = ($pair[1].Trim('\') + '/' + $pair[0] + '.xml').TrimStart('/')
        Write-Fixture (Join-Path $args.TaskXmlSource $relative) $xml
    }
    Write-Fixture (Join-Path $args.TaskXmlSource 'Unrelated.xml') '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><URI>\Unrelated</URI></RegistrationInfo></Task>'
    return $args
}
function Get-TreeStamp([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return 'ABSENT' }
    return ((Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        if ($_.PSIsContainer) { 'DIR|' + $_.FullName }
        else { $_.FullName + '|' + $_.Length + '|' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }) -join "`n")
}
function Read-Manifest([string]$Path) {
    Get-Content -LiteralPath (Join-Path $Path 'MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Save-Manifest([string]$Path, $Manifest) {
    Write-Fixture (Join-Path $Path 'MANIFEST.json') ($Manifest | ConvertTo-Json -Depth 12)
}
function Invoke-Backup($Fixture) { & (Join-Path $opsRoot 'backup-sxj-live.ps1') @Fixture }
function Get-RestoreArgs($Fixture, [string]$From) {
    @{
        From = $From; Root = $Fixture.Root; LocalStateRoot = $Fixture.LocalStateRoot
        MdbPath = $Fixture.MdbPath; TaskRestoreDirectory = $Fixture.TaskXmlSource
        PreRestoreRoot = Join-Path (Split-Path -Parent $Fixture.Root) 'pre-restore'
    }
}

Describe 'A5 real file recovery drill (synthetic only)' -Tag 'Core' {
    It 'has all four required entry scripts' {
        foreach ($name in @('backup-sxj-live','restore-sxj-live','rollback-code','register-backup-task')) {
            (Test-Path -LiteralPath (Join-Path $opsRoot ($name + '.ps1'))) | Should Be $true
        }
    }
    It 'DryRun creates no files, even when BackupRoot does not exist' {
        $f = New-Fixture 'dry-run'
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        $preview = & (Join-Path $opsRoot 'backup-sxj-live.ps1') @f -DryRun
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
        $preview.FileCount | Should Be 12
        (Test-Path -LiteralPath $f.BackupRoot) | Should Be $false
    }
    It 'backs up, corrupts, restores all categories and verifies every SHA/size plus pre-restore' {
        $f = New-Fixture 'roundtrip'
        $backup = Invoke-Backup $f
        $manifest = Read-Manifest $backup.BackupDirectory
        @($manifest.Files).Count | Should Be 12
        @($manifest.Files | Where-Object { $_.RelativePath -match 'skip|ignore' }).Count | Should Be 0
        foreach ($entry in $manifest.Files) {
            $payload = Join-Path $backup.BackupDirectory $entry.BackupPath
            (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash | Should Be $entry.Sha256
            (Get-Item -LiteralPath $payload).Length | Should Be $entry.Size
            if ($entry.Category -ne 'tasks') { Write-Fixture $entry.SourcePath 'CORRUPTED-FIXTURE' }
        }
        Write-Fixture (Join-Path $f.TaskXmlSource 'Laundry-Backup.xml') '<broken/>'
        # A changed existing task must remain valid XML for a safe pre-restore snapshot.
        $task = $manifest.Files | Where-Object { $_.TaskName -eq 'Laundry-Backup' }
        Write-Fixture (Join-Path $f.TaskXmlSource 'Laundry-Backup.xml') ((Get-Content -LiteralPath (Join-Path $backup.BackupDirectory $task.BackupPath) -Raw -Encoding UTF8).Replace('/c exit 0','/c exit 7'))
        $restoreArgs = Get-RestoreArgs $f $backup.BackupDirectory
        $restored = & (Join-Path $opsRoot 'restore-sxj-live.ps1') @restoreArgs
        $restored.RestoredCount | Should Be 12
        $previous = Read-Manifest $restored.PreRestoreDirectory
        @($previous.Files).Count | Should Be 12
        foreach ($entry in $manifest.Files) {
            $destination = $entry.SourcePath
            if ($entry.Category -eq 'tasks') { $destination = Join-Path $f.TaskXmlSource $entry.RelativePath }
            (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash | Should Be $entry.Sha256
            (Get-Item -LiteralPath $destination).Length | Should Be $entry.Size
        }
        foreach ($entry in $previous.Files) {
            (Get-FileHash -LiteralPath (Join-Path $restored.PreRestoreDirectory $entry.BackupPath) -Algorithm SHA256).Hash | Should Be $entry.Sha256
        }
        $previousFile = $previous.Files | Where-Object { $_.Category -eq 'secrets' -and $_.RelativePath -eq '.env' }
        (Get-Content -LiteralPath (Join-Path $restored.PreRestoreDirectory $previousFile.BackupPath) -Raw -Encoding UTF8) | Should Be 'CORRUPTED-FIXTURE'
        Write-Host ('ROUNDTRIP backup={0} entries={1} SHA256_ALL_EQUAL=True preRestore={2}' -f $backup.BackupDirectory, $manifest.Files.Count, $restored.PreRestoreDirectory)
    }
    It 'Only data leaves secrets/state/tasks/mdb unchanged' {
        $f = New-Fixture 'only-data'; $b = Invoke-Backup $f
        Write-Fixture (Join-Path $f.Root '.env') 'KEEP-CHANGED'
        Write-Fixture (Join-Path $f.Root 'data/leads/list.jsonl') 'BROKEN-DATA'
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $r = & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only data
        $r.RestoredCount | Should Be 2
        (Get-Content -LiteralPath (Join-Path $f.Root '.env') -Raw -Encoding UTF8) | Should Be 'KEEP-CHANGED'
        (Get-Content -LiteralPath (Join-Path $f.Root 'data/leads/list.jsonl') -Raw -Encoding UTF8) | Should Be '{"synthetic":true}'
    }
    It 'restores to a new root and overrides local-state and mdb destinations' {
        $f = New-Fixture 'new-root'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $a.Root = Join-Path $drillRoot 'new-target/root'
        $a.LocalStateRoot = Join-Path $drillRoot 'new-target/local'
        $a.MdbPath = Join-Path $drillRoot 'new-target/db/copy.mdb'
        $a.TaskRestoreDirectory = Join-Path $drillRoot 'new-target/tasks'
        $r = & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a
        $r.RestoredCount | Should Be 12
        (Test-Path -LiteralPath (Join-Path $a.Root 'secrets/line.json')) | Should Be $true
        (Test-Path -LiteralPath (Join-Path $a.LocalStateRoot 'tunnel_events.jsonl')) | Should Be $true
        (Test-Path -LiteralPath $a.MdbPath) | Should Be $true
    }
    It 'restore WhatIf performs zero writes including no pre-restore directory' {
        $f = New-Fixture 'whatif'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -WhatIf | Out-Null
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
    }
    It 'validates all payloads before writing even if Only excludes the damaged payload' {
        $f = New-Fixture 'tamper'; $b = Invoke-Backup $f
        $m = Read-Manifest $b.BackupDirectory
        $entry = $m.Files | Where-Object { $_.Category -eq 'mdb' }
        Write-Fixture (Join-Path $b.BackupDirectory $entry.BackupPath) 'TAMPERED'
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only data } | Should Throw
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
    }
    It 'rejects manifest path traversal and duplicate destinations before any write' {
        $f = New-Fixture 'traversal'; $b = Invoke-Backup $f
        $m = Read-Manifest $b.BackupDirectory
        $m.Files[0].RelativePath = '../escape.txt'; Save-Manifest $b.BackupDirectory $m
        $a = Get-RestoreArgs $f $b.BackupDirectory
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a } | Should Throw
        (Test-Path -LiteralPath $a.PreRestoreRoot) | Should Be $false
        $m.Files[0].RelativePath = 'secrets/line.json'
        $m.Files = @($m.Files) + @($m.Files[0]); Save-Manifest $b.BackupDirectory $m
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a } | Should Throw
    }
    It 'fails for missing sources and does not create a completed backup' {
        $f = New-Fixture 'missing'
        $f.MdbPath = Join-Path $drillRoot 'does-not-exist.mdb'
        { Invoke-Backup $f } | Should Throw
        (Test-Path -LiteralPath $f.BackupRoot) | Should Be $false
    }
    It 'keeps the newest 14 completed backups, preserves unknown folders, and has unique minute collisions' {
        Mock Get-Date { '20261030-0330' } -ParameterFilter { $Format -eq 'yyyyMMdd-HHmm' }
        $f = New-Fixture 'retention'
        $created = @()
        for ($i = 0; $i -lt 16; $i++) { $created += (Invoke-Backup $f).BackupDirectory }
        @($created | Select-Object -Unique).Count | Should Be 16
        @(Get-ChildItem -LiteralPath $f.BackupRoot -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'MANIFEST.json') }).Count | Should Be 14
        (Test-Path -LiteralPath $created[-1]) | Should Be $true
        (Test-Path -LiteralPath $created[0]) | Should Be $false
        Write-Fixture (Join-Path $f.BackupRoot 'unknown/keep.txt') 'KEEP'
        $sourceStamp = Get-TreeStamp $f.Root
        New-Item -ItemType Junction -Path (Join-Path $f.BackupRoot '20000101-0000') -Value $f.Root | Out-Null
        Invoke-Backup $f | Out-Null
        (Test-Path -LiteralPath (Join-Path $f.BackupRoot 'unknown/keep.txt')) | Should Be $true
        (Get-Item -LiteralPath (Join-Path $f.BackupRoot '20000101-0000')).LinkType | Should Be 'Junction'
        (Get-TreeStamp $f.Root) | Should Be $sourceStamp
    }
    It 'rejects overlapping source/backup roots and a pre-restore directory inside a restore target' {
        $f = New-Fixture 'overlap'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $a.PreRestoreRoot = Join-Path $f.Root 'data/pre-restore'
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a } | Should Throw
        $f.BackupRoot = Join-Path $f.Root 'data/backups'
        { Invoke-Backup $f } | Should Throw
    }
    It 'rejects out-of-scope task names and malformed XML' {
        $f = New-Fixture 'bad-task'
        Write-Fixture (Join-Path $f.TaskXmlSource 'Laundry-Bad.xml') '<broken/>'
        { Invoke-Backup $f } | Should Throw
        (Test-Path -LiteralPath $f.BackupRoot) | Should Be $false
    }
    It 'rollback outputs a plan only and rejects a missing tag' {
        $f = New-Fixture 'rollback'
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        $plan = & (Join-Path $opsRoot 'rollback-code.ps1') -ToTag 'sxj-live-2026-10-29' -Root (Split-Path -Parent $opsRoot)
        ($plan -join "`n") | Should Match 'checkout --detach'
        ($plan -join "`n") | Should Match '-Stop'
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
        { & (Join-Path $opsRoot 'rollback-code.ps1') -ToTag 'a5-tag-that-does-not-exist' -Root (Split-Path -Parent $opsRoot) } | Should Throw
    }
    It 'register-backup-task WhatIf never reaches Register-ScheduledTask' {
        $f = New-Fixture 'register-preview'
        Mock Register-ScheduledTask { throw 'A5: real registration is forbidden' }
        & (Join-Path $opsRoot 'register-backup-task.ps1') -BackupScript (Join-Path $opsRoot 'backup-sxj-live.ps1') -Root $f.Root -LocalStateRoot $f.LocalStateRoot -MdbPath $f.MdbPath -BackupRoot $f.BackupRoot -WhatIf
        Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
    }
}
Describe 'A5 additional boundary and scheduler contract checks' -Tag 'Hardening' {
    It 'rejects a junction at secrets or data before enumerating files' {
        foreach ($name in @('secrets','data')) {
            $f = New-Fixture ('junction-' + $name)
            $original = Join-Path $f.Root $name
            $saved = Join-Path $f.Root ($name + '-original')
            Rename-Item -LiteralPath $original -NewName ($name + '-original')
            New-Item -ItemType Junction -Path $original -Value $saved | Out-Null
            { Invoke-Backup $f } | Should Throw
            (Test-Path -LiteralPath $f.BackupRoot) | Should Be $false
        }
    }
    It 'rejects a destination junction before pre-restore creates files' {
        $f = New-Fixture 'target-junction'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory
        Rename-Item -LiteralPath (Join-Path $f.Root 'data') -NewName 'data-original'
        New-Item -ItemType Junction -Path (Join-Path $f.Root 'data') -Value (Join-Path $f.Root 'data-original') | Out-Null
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only data } | Should Throw
        (Test-Path -LiteralPath $a.PreRestoreRoot) | Should Be $false
    }
    It 'backs up and restores a non-ASCII filename and literal wildcard brackets' {
        $f = New-Fixture 'unicode'
        $name = ([string][char]0x5ba2) + ([string][char]0x6236) + '[1].json'
        $path = Join-Path $f.Root ('data/' + $name)
        Write-Fixture $path 'SYNTHETIC-UNICODE-PATH'
        $b = Invoke-Backup $f
        Write-Fixture $path 'BROKEN'
        $a = Get-RestoreArgs $f $b.BackupDirectory
        & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only data | Out-Null
        (Get-Content -LiteralPath $path -Raw -Encoding UTF8) | Should Be 'SYNTHETIC-UNICODE-PATH'
    }
    It 'the native scheduler inventory only exports the three allowed name prefixes (all native calls mocked)' {
        $f = New-Fixture 'native-backup'; $f.Remove('TaskXmlSource')
        Mock Get-ScheduledTask {
            @([pscustomobject]@{TaskName='Laundry-Backup';TaskPath='\'},
              [pscustomobject]@{TaskName='AI-Daily-Test';TaskPath='\A5\'},
              [pscustomobject]@{TaskName='SXJ-Test';TaskPath='\'},
              [pscustomobject]@{TaskName='Unrelated';TaskPath='\'})
        }
        Mock Export-ScheduledTask {
            '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><URI>' + $TaskPath + $TaskName + '</URI></RegistrationInfo><Actions><Exec><Command>cmd.exe</Command></Exec></Actions></Task>'
        }
        $b = Invoke-Backup $f
        $m = Read-Manifest $b.BackupDirectory
        @($m.Files | Where-Object { $_.Category -eq 'tasks' }).Count | Should Be 3
        Assert-MockCalled Export-ScheduledTask -Times 3 -Exactly -Scope It
        Assert-MockCalled Export-ScheduledTask -Times 0 -Exactly -Scope It -ParameterFilter { $TaskName -eq 'Unrelated' }
    }
    It 'native task restore WhatIf never queries or registers real tasks' {
        $f = New-Fixture 'native-whatif'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory; $a.Remove('TaskRestoreDirectory')
        Mock Get-ScheduledTask { throw 'A5: unexpected native read' }
        Mock Register-ScheduledTask { throw 'A5: unexpected native write' }
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only tasks -WhatIf | Out-Null
        Assert-MockCalled Get-ScheduledTask -Times 0 -Exactly -Scope It
        Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
    }
    It 'can restore the pre-restore snapshot of existing files a second time' {
        $f = New-Fixture 'pre-roundtrip'; $b = Invoke-Backup $f
        Write-Fixture (Join-Path $f.Root '.env') 'BEFORE-RESTORE'
        $a = Get-RestoreArgs $f $b.BackupDirectory
        $r = & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only secrets
        $a.From = $r.PreRestoreDirectory
        & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only secrets | Out-Null
        (Get-Content -LiteralPath (Join-Path $f.Root '.env') -Raw -Encoding UTF8) | Should Be 'BEFORE-RESTORE'
    }
    It 'native task restore handles an absent nested folder and verifies meaningful XML (all providers mocked)' {
        $f = New-Fixture 'native-restore'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory; $a.Remove('TaskRestoreDirectory')
        Mock Get-ScheduledTask { @() }
        Mock Register-ScheduledTask { }
        Mock Export-ScheduledTask {
            '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task" version="1.2"><RegistrationInfo><URI>' + $TaskPath + $TaskName + '</URI></RegistrationInfo><Triggers/><Principals/><Settings/><Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions></Task>'
        }
        Mock New-Object -ParameterFilter { $ComObject -eq 'Schedule.Service' } {
            $folder = [pscustomobject]@{}
            $folder | Add-Member ScriptMethod GetFolder { param($Name) throw 'Synthetic missing folder' }
            $folder | Add-Member ScriptMethod CreateFolder { param($Name) return $this }
            $service = [pscustomobject]@{ Folder=$folder }
            $service | Add-Member ScriptMethod Connect { }
            $service | Add-Member ScriptMethod GetFolder { param($Name) return $this.Folder }
            return $service
        }
        $r = & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only tasks
        $r.RestoredCount | Should Be 3
        Assert-MockCalled Get-ScheduledTask -Times 1 -Exactly -Scope It -ParameterFilter { -not $TaskPath }
        Assert-MockCalled Register-ScheduledTask -Times 3 -Exactly -Scope It
        Assert-MockCalled New-Object -Times 1 -Exactly -Scope It -ParameterFilter { $ComObject -eq 'Schedule.Service' }
    }
    It 'does not call a wrong-action scheduler readback verified' {
        $f = New-Fixture 'wrong-action'; $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory; $a.Remove('TaskRestoreDirectory')
        Mock Get-ScheduledTask { @() }
        Mock Register-ScheduledTask { }
        Mock Export-ScheduledTask {
            '<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task" version="1.2"><RegistrationInfo><URI>' + $TaskPath + $TaskName + '</URI></RegistrationInfo><Triggers/><Principals/><Settings/><Actions Context="Author"><Exec><Command>WRONG-ACTION.exe</Command></Exec></Actions></Task>'
        }
        Mock New-Object -ParameterFilter { $ComObject -eq 'Schedule.Service' } {
            $folder = [pscustomobject]@{}
            $folder | Add-Member ScriptMethod GetFolder { param($Name) return $this }
            $service = [pscustomobject]@{ Folder=$folder }
            $service | Add-Member ScriptMethod Connect { }
            $service | Add-Member ScriptMethod GetFolder { param($Name) return $this.Folder }
            return $service
        }
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a -Only tasks } | Should Throw
    }
    It 'rejects password-based task principals before overwriting any destination' {
        $f = New-Fixture 'password-task'
        $taskFile = Join-Path $f.TaskXmlSource 'Laundry-Backup.xml'
        $xml = Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8
        Write-Fixture $taskFile ($xml.Replace('<Principals/>','<Principals><Principal id="Author"><UserId>S-1-5-18</UserId><LogonType>Password</LogonType></Principal></Principals>'))
        $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory; $a.Remove('TaskRestoreDirectory')
        Mock Get-ScheduledTask { throw 'A5: no provider should be queried' }
        Mock Register-ScheduledTask { throw 'A5: no task should be registered' }
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a } | Should Throw
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
        Assert-MockCalled Register-ScheduledTask -Times 0 -Exactly -Scope It
    }
    It 'rejects an unresolved old local account SID before writing' {
        $f = New-Fixture 'old-account'
        $taskFile = Join-Path $f.TaskXmlSource 'Laundry-Backup.xml'
        $xml = Get-Content -LiteralPath $taskFile -Raw -Encoding UTF8
        Write-Fixture $taskFile ($xml.Replace('<Principals/>','<Principals><Principal id="Author"><UserId>S-1-5-21-111111111-222222222-333333333-99999</UserId><LogonType>InteractiveToken</LogonType></Principal></Principals>'))
        $b = Invoke-Backup $f
        $a = Get-RestoreArgs $f $b.BackupDirectory; $a.Remove('TaskRestoreDirectory')
        Mock Get-ScheduledTask { throw 'A5: no provider should be queried' }
        Mock Register-ScheduledTask { throw 'A5: no task should be registered' }
        { & (Join-Path $opsRoot 'restore-sxj-live.ps1') @a } | Should Throw
        (Test-Path -LiteralPath $a.PreRestoreRoot) | Should Be $false
    }
    It 'runbook process selection excludes similarly named directories, editors and Python -c' {
        . (Join-Path $opsRoot 'Recovery.Common.ps1')
        $f = New-Fixture 'process-selector'
        $pythonImage = Join-Path $f.Root 'python.exe'
        $bot = Join-Path $f.Root 'line-bot'
        $scriptFile = Join-Path $bot 'line_webhook.py'
        $p = [pscustomobject]@{ ExecutablePath=$pythonImage; CommandLine=('"' + $pythonImage + '" -u "' + $scriptFile + '"') }
        (Test-RecoveryServiceProcess $p $bot @($pythonImage)) | Should Be $true
        $p.CommandLine = '"' + $pythonImage + '" -u "' + (Join-Path ($bot + '-old') 'line_webhook.py') + '"'
        (Test-RecoveryServiceProcess $p $bot @($pythonImage)) | Should Be $false
        $p.ExecutablePath = Join-Path $f.Root 'notepad.exe'
        $p.CommandLine = '"' + $p.ExecutablePath + '" "' + $scriptFile + '"'
        (Test-RecoveryServiceProcess $p $bot @($pythonImage)) | Should Be $false
        $p.ExecutablePath = $pythonImage
        $p.CommandLine = '"' + $pythonImage + '" -c "print(' + $scriptFile + ')"'
        (Test-RecoveryServiceProcess $p $bot @($pythonImage)) | Should Be $false
    }
}
Describe 'A5 backup task action contract (in-memory CIM fixtures only)' -Tag 'Register' {
    BeforeEach {
        $global:A5TestRegistered = $null
        $global:A5TestRegistrationFault = ''
        Mock Get-ScheduledTask { if ($TaskName) { return $global:A5TestRegistered } }
        Mock New-ScheduledTaskAction {
            $fixture = New-CimInstance -ClientOnly -ClassName 'MSFT_TaskExecAction' -Property @{ Execute=$Execute; Arguments=$Argument; WorkingDirectory=$WorkingDirectory }
            $fixture.PSTypeNames.Add('Microsoft.Management.Infrastructure.CimInstance#MSFT_TaskAction')
            return $fixture
        }
        Mock New-ScheduledTaskTrigger {
            $fixture = New-CimInstance -ClientOnly -ClassName 'MSFT_TaskDailyTrigger' -Property @{ StartBoundary=(Get-Date $At -Format 'yyyy-MM-ddTHH:mm:ss'); DaysInterval=[uint16]1; Enabled=$true }
            $fixture.PSTypeNames.Add('Microsoft.Management.Infrastructure.CimInstance#MSFT_TaskTrigger')
            return $fixture
        }
        Mock New-ScheduledTaskPrincipal {
            $enumType = (Get-Command New-ScheduledTaskPrincipal).Parameters['LogonType'].ParameterType
            $kind = [uint32]([Enum]::Parse($enumType, [string]$LogonType))
            New-CimInstance -ClientOnly -ClassName 'MSFT_TaskPrincipal' -Property @{ UserId=$UserId; LogonType=$kind; RunLevel=[uint32]1 }
        }
        Mock New-ScheduledTaskSettingsSet {
            $fixture = New-CimInstance -ClientOnly -ClassName 'MSFT_TaskSettings3' -Property @{ Enabled=$true; StartWhenAvailable=$true; MultipleInstances=[uint32]2; ExecutionTimeLimit='PT2H' }
            $fixture.PSTypeNames.Add('Microsoft.Management.Infrastructure.CimInstance#MSFT_TaskSettings')
            return $fixture
        }
        Mock Register-ScheduledTask {
            $global:A5TestRegistered = [pscustomobject]@{ Actions=@($Action); Triggers=@($Trigger); Principal=$Principal; Settings=$Settings }
            switch ($global:A5TestRegistrationFault) {
                'Execute' { $global:A5TestRegistered.Actions[0].Execute = 'WRONG.exe' }
                'Principal' { $global:A5TestRegistered.Principal.UserId = 'WRONG-ACCOUNT' }
                'LogonType' { $global:A5TestRegistered.Principal.LogonType = [uint32]6 }
                'Daily' { $global:A5TestRegistered.Triggers[0].DaysInterval = [uint16]2 }
            }
        }
    }
    It 'normalizes paths with spaces and trailing slashes before saving task arguments' {
        $f = New-Fixture 'register action spaces'
        $r = & (Join-Path $opsRoot 'register-backup-task.ps1') -Root ($f.Root + '\') -LocalStateRoot ($f.LocalStateRoot + '\') -MdbPath $f.MdbPath -BackupRoot ($f.BackupRoot + '\')
        $r.Verified | Should Be $true
        $enumType = (Get-Command New-ScheduledTaskPrincipal).Parameters['LogonType'].ParameterType
        [int]$global:A5TestRegistered.Principal.LogonType | Should Be ([int]([Enum]::Parse($enumType, 'ServiceAccount')))
        $global:A5TestRegistered.Actions[0].Arguments.Contains('-Root "' + $f.Root + '"') | Should Be $true
        $global:A5TestRegistered.Actions[0].Arguments.Contains('-BackupRoot "' + $f.BackupRoot + '"') | Should Be $true
        Assert-MockCalled Register-ScheduledTask -Times 1 -Exactly -Scope It
    }
    It 'rejects wrong executable, account or daily interval in scheduler readback' {
        $f = New-Fixture 'register readback'
        foreach ($fault in @('Execute','Principal','LogonType','Daily')) {
            $global:A5TestRegistrationFault = $fault
            { & (Join-Path $opsRoot 'register-backup-task.ps1') -Root $f.Root -LocalStateRoot $f.LocalStateRoot -MdbPath $f.MdbPath -BackupRoot $f.BackupRoot } | Should Throw
        }
    }
    It 'supports the explicit CurrentUser interactive account without storing a password' {
        $f = New-Fixture 'register current-user'
        $r = & (Join-Path $opsRoot 'register-backup-task.ps1') -RunAs CurrentUser -Root $f.Root -LocalStateRoot $f.LocalStateRoot -MdbPath $f.MdbPath -BackupRoot $f.BackupRoot
        $r.Verified | Should Be $true
        [int]$global:A5TestRegistered.Principal.LogonType | Should Be 3
        $r.RunAs | Should Be 'CurrentUser'
    }
}
function Invoke-R2BackupProcess($Fixture, [bool]$Preview) {
    $assignments = @($Fixture.GetEnumerator() | ForEach-Object {
        "'{0}'='{1}'" -f $_.Key, ([string]$_.Value).Replace("'", "''")
    }) -join ';'
    $scriptPath = (Join-Path $opsRoot 'backup-sxj-live.ps1').Replace("'", "''")
    $code = '$ErrorActionPreference = ''Stop''; $ProgressPreference = ''SilentlyContinue''; $fixture = @{' + $assignments + '}; $result = & ''' + $scriptPath + ''' @fixture'
    if ($Preview) { $code += ' -DryRun' }
    $code += '; Write-Output (''A5_R2_RESULT_JSON='' + ($result | ConvertTo-Json -Depth 10 -Compress))'
    $logBase = Join-Path $drillRoot ('r2-process-' + [guid]::NewGuid().ToString('N'))
    # -File matches the supported production entry point and keeps Write-Host
    # informational output out of -EncodedCommand's serialized stderr stream.
    $wrapper = $logBase + '.ps1'
    [IO.File]::WriteAllText($wrapper, $code, (New-Object Text.UTF8Encoding($true)))
    $process = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -WindowStyle Hidden -Wait -PassThru `
        -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $wrapper + '"')) `
        -RedirectStandardOutput ($logBase + '.stdout') -RedirectStandardError ($logBase + '.stderr')
    $stdout = [IO.File]::ReadAllText($logBase + '.stdout')
    $stderr = [IO.File]::ReadAllText($logBase + '.stderr')
    $jsonLine = @($stdout -split '\r?\n' | Where-Object { $_.StartsWith('A5_R2_RESULT_JSON=') })
    $value = $null
    if ($jsonLine.Count -gt 0) { $value = $jsonLine[-1].Substring('A5_R2_RESULT_JSON='.Length) | ConvertFrom-Json }
    [pscustomobject]@{ ExitCode=$process.ExitCode; Stdout=$stdout; Stderr=$stderr; Value=$value }
}

Describe 'A5 r2 transient files and source read failures' -Tag 'R2' {
    It 'excludes lock pid and tmp files before reading in <Mode>' -TestCases @(
        @{Mode='DryRun';Preview=$true}, @{Mode='backup';Preview=$false}
    ) {
        param($Mode, $Preview)
        $f = New-Fixture ('r2-excluded-' + $Mode)
        foreach ($relative in @('data/arrival-notify.lock','data/nested/worker.PID','data/request.tmp','secrets/session.LOCK')) {
            Write-Fixture (Join-Path $f.Root $relative) 'TRANSIENT-FIXTURE'
        }
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        $stream = [IO.File]::Open((Join-Path $f.Root 'data/arrival-notify.lock'), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try { $r = Invoke-R2BackupProcess $f $Preview }
        finally { $stream.Dispose() }
        $r.ExitCode | Should Be 0
        $r.Stderr | Should BeNullOrEmpty
        $r.Value.FileCount | Should Be 12
        $r.Value.SkippedCount | Should Be 0
        $r.Stdout | Should Match 'skipped=0'
        if ($Preview) {
            (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
            $files = $r.Value.Files
        } else {
            $m = Read-Manifest $r.Value.BackupDirectory
            @($m.Skipped).Count | Should Be 0
            $files = $m.Files
            foreach ($pattern in @('*.lock','*.pid','*.tmp')) { ($pattern -in $m.ExcludedFilePatterns) | Should Be $true }
        }
        @($files | Where-Object { $_.RelativePath -match '\.(lock|pid|tmp)$' }).Count | Should Be 0
    }

    It 'skips an exclusively locked <Kind> source in <Mode> without an error' -TestCases @(
        @{Kind='data';Relative='data/leads/list.jsonl';Mode='DryRun';Preview=$true},
        @{Kind='data';Relative='data/leads/list.jsonl';Mode='backup';Preview=$false},
        @{Kind='state';Relative='line-bot/public_base.txt';Mode='DryRun';Preview=$true},
        @{Kind='state';Relative='line-bot/public_base.txt';Mode='backup';Preview=$false},
        @{Kind='local';Relative='tunnel_events.jsonl';Mode='DryRun';Preview=$true},
        @{Kind='local';Relative='tunnel_events.jsonl';Mode='backup';Preview=$false},
        @{Kind='mdb';Relative='';Mode='DryRun';Preview=$true},
        @{Kind='mdb';Relative='';Mode='backup';Preview=$false},
        @{Kind='tasks';Relative='Laundry-Backup.xml';Mode='DryRun';Preview=$true},
        @{Kind='tasks';Relative='Laundry-Backup.xml';Mode='backup';Preview=$false}
    ) {
        param($Kind, $Relative, $Mode, $Preview)
        $f = New-Fixture ('r2-locked-' + $Kind + '-' + $Mode)
        $path = switch ($Kind) {
            'local' { Join-Path $f.LocalStateRoot $Relative }
            'mdb' { $f.MdbPath }
            'tasks' { Join-Path $f.TaskXmlSource $Relative }
            default { Join-Path $f.Root $Relative }
        }
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try { $r = Invoke-R2BackupProcess $f $Preview }
        finally { $stream.Dispose() }
        $r.ExitCode | Should Be 0
        $r.Stderr | Should BeNullOrEmpty
        $r.Value.FileCount | Should Be 11
        $r.Value.SkippedCount | Should Be 1
        $r.Stdout | Should Match 'skipped=1'
        if ($Preview) {
            (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
            $skipped = $r.Value.Skipped
            $files = $r.Value.Files
        } else {
            $m = Read-Manifest $r.Value.BackupDirectory
            $m.Status | Should Be 'Complete'
            $skipped = $m.Skipped
            $files = $m.Files
        }
        @($skipped).Count | Should Be 1
        $skipped[0].Path | Should Be $path
        $skipped[0].Reason | Should Match 'IOException'
        @($files | Where-Object { $_.SourcePath -eq $path }).Count | Should Be 0
        if (-not $Preview) {
            foreach ($entry in $files) {
                (Get-FileHash -LiteralPath (Join-Path $r.Value.BackupDirectory $entry.BackupPath) -Algorithm SHA256).Hash | Should Be $entry.Sha256
            }
        }
    }

    It 'fails exit 1 for locked critical <Relative> in <Mode>' -TestCases @(
        @{Relative='.env';Mode='DryRun';Preview=$true}, @{Relative='.env';Mode='backup';Preview=$false},
        @{Relative='secrets/line.json';Mode='DryRun';Preview=$true}, @{Relative='secrets/line.json';Mode='backup';Preview=$false}
    ) {
        param($Relative, $Mode, $Preview)
        $f = New-Fixture ('r2-critical-' + $Relative.Replace('/','-') + '-' + $Mode)
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        $stream = [IO.File]::Open((Join-Path $f.Root $Relative), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        try { $r = Invoke-R2BackupProcess $f $Preview }
        finally { $stream.Dispose() }
        $r.ExitCode | Should Be 1
        (Test-Path -LiteralPath $f.BackupRoot) | Should Be $false
        (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before
    }

    It 'records an access-denied task XML source in <Mode>' -TestCases @(
        @{Mode='DryRun';Preview=$true}, @{Mode='backup';Preview=$false}
    ) {
        param($Mode, $Preview)
        $f = New-Fixture ('r2-denied-' + $Mode)
        $path = Join-Path $f.TaskXmlSource 'Laundry-Backup.xml'
        $before = Get-TreeStamp (Split-Path -Parent $f.Root)
        # The managed workspace disallows DACL changes. Inject the OS exception at
        # the real task XML read boundary; all remaining backup operations are real.
        Mock Get-Content { throw (New-Object UnauthorizedAccessException('Synthetic source read denied')) } `
            -ParameterFilter { $LiteralPath -like '*r2-denied-*task-source*Laundry-Backup.xml' }
        $r = & (Join-Path $opsRoot 'backup-sxj-live.ps1') @f -DryRun:$Preview
        $r.FileCount | Should Be 11
        $r.SkippedCount | Should Be 1
        $skipped = $r.Skipped
        if (-not $Preview) { $skipped = (Read-Manifest $r.BackupDirectory).Skipped }
        $skipped[0].Path | Should Be $path
        $skipped[0].Reason | Should Match 'UnauthorizedAccess'
        if ($Preview) { (Get-TreeStamp (Split-Path -Parent $f.Root)) | Should Be $before }
    }

    It 'does not downgrade an access-denied required source into a skip' {
        . (Join-Path $opsRoot 'Recovery.Common.ps1')
        $skipped = New-Object 'Collections.Generic.List[object]'
        $caught = $null
        try {
            Invoke-RecoverySourceRead '.env' { throw (New-Object UnauthorizedAccessException('Synthetic critical read denied')) } $skipped -Required
        } catch { $caught = $_ }
        $caught | Should Not BeNullOrEmpty
        $caught.Exception.GetType().Name | Should Be 'UnauthorizedAccessException'
        $skipped.Count | Should Be 0
    }

    It 'does not downgrade a destination write failure into a skipped source' {
        $f = New-Fixture 'r2-destination-failure'
        Mock New-Item { throw (New-Object UnauthorizedAccessException('Synthetic destination write denied')) } `
            -ParameterFilter { $Path -like '*r2-destination-failure*payload*' }
        { Invoke-Backup $f } | Should Throw
        @(Get-ChildItem -LiteralPath $f.BackupRoot -Filter MANIFEST.json -Recurse).Count | Should Be 0
    }

    It 'copies a binary source across multiple stream buffers without losing bytes' {
        $f = New-Fixture 'r2-multiple-buffers'
        $bytes = New-Object byte[] (81920 * 2 + 17)
        $bytes[81919] = 7; $bytes[81920] = 11; $bytes[$bytes.Length - 1] = 13
        [IO.File]::WriteAllBytes($f.MdbPath, $bytes)
        $expected = (Get-FileHash -LiteralPath $f.MdbPath -Algorithm SHA256).Hash
        $b = Invoke-Backup $f
        $m = Read-Manifest $b.BackupDirectory
        $entry = $m.Files | Where-Object { $_.Category -eq 'mdb' }
        $payload = Join-Path $b.BackupDirectory $entry.BackupPath
        (Get-Item -LiteralPath $payload).Length | Should Be 163857
        (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash | Should Be $expected
        $b.SkippedCount | Should Be 0
    }

    It 'still fails for changed source bytes after inventory instead of skipping them' {
        $f = New-Fixture 'r2-source-changed'
        $global:A5R2ChangedSource = $f.MdbPath
        Mock Get-Date {
            [IO.File]::WriteAllText($global:A5R2ChangedSource, 'CHANGED-AFTER-INVENTORY')
            '20261030-0331'
        } -ParameterFilter { $Format -eq 'yyyyMMdd-HHmm' }
        try { { Invoke-Backup $f } | Should Throw }
        finally { Remove-Variable A5R2ChangedSource -Scope Global }
        @(Get-ChildItem -LiteralPath $f.BackupRoot -Filter MANIFEST.json -Recurse).Count | Should Be 0
    }

    It 'records a lock acquired after inventory and omits the uncopied payload' {
        $f = New-Fixture 'r2-late-lock'
        $global:A5R2LateLockPath = Join-Path $f.Root 'data/leads/list.jsonl'
        $global:A5R2LateLock = $null
        Mock Get-Date {
            $global:A5R2LateLock = [IO.File]::Open($global:A5R2LateLockPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            '20261030-0330'
        } -ParameterFilter { $Format -eq 'yyyyMMdd-HHmm' }
        try { $b = Invoke-Backup $f }
        finally {
            if ($global:A5R2LateLock) { $global:A5R2LateLock.Dispose() }
            Remove-Variable A5R2LateLock,A5R2LateLockPath -Scope Global
        }
        $b.FileCount | Should Be 11
        $b.SkippedCount | Should Be 1
        $m = Read-Manifest $b.BackupDirectory
        @($m.Skipped).Count | Should Be 1
        $m.Skipped[0].Path | Should Be (Join-Path $f.Root 'data/leads/list.jsonl')
        (Test-Path -LiteralPath (Join-Path $b.BackupDirectory 'payload/data/data/leads/list.jsonl')) | Should Be $false
        @($m.Files).Count | Should Be 11
    }
}
$clock.Stop()
Write-Host ('A5_DRILL elapsedSeconds={0:N3} root={1} realSchedulerWrites=0 livePathOperations=0' -f $clock.Elapsed.TotalSeconds, $drillRoot)
