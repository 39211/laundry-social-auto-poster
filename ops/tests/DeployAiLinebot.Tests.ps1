#requires -Version 5.1
# Pester 3.4.0. Every service, process, HTTP and task boundary is synthetic.
$runner = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy-ai-linebot.ps1'
$runnerExists = Test-Path -LiteralPath $runner
if ($runnerExists) {
    . $runner
} else {
    # Test-only missing-feature stand-ins allow every acceptance case to go red.
    function Invoke-AiLinebotDeployment { param($Source, $Target, [switch]$DryRun, $Rollback, [switch]$RegisterTasks) return 99 }
    function Invoke-AiGit { param($Root, $Arguments) throw 'Runner missing' }
    function Get-AiBackupRoot { throw 'Runner missing' }
    function Get-AiPythonPath { throw 'Runner missing' }
    function Invoke-AiNative { param($FilePath, $Arguments, $WorkingDirectory) throw 'Runner missing' }
    function Get-AiLiveTargetMap { throw 'Runner missing' }
    function Get-AiTickState { throw 'Runner missing' }
    function Start-AiBotTask { throw 'Runner missing' }
    function Get-AiTickWindowDecision { throw 'Runner missing' }
}
$script:A8RealNative = (Get-Command Invoke-AiNative).ScriptBlock

function Write-A8Fixture {
    param([string]$Path, [string]$Text)
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Get-A8Snapshot {
    param([string]$Root)
    return (@(Get-ChildItem -LiteralPath $Root -Force -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Root.Length)
        if ($_.PSIsContainer) { 'D:' + $relative }
        else { 'F:' + $relative + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }) -join "`n")
}

Describe 'A8 isolated deployment acceptance' {
    BeforeEach {
        $script:Fixture = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        $script:Source = Join-Path $script:Fixture 'source with spaces'
        # A8-2: the runner now operates the live tree only through the junction and
        # refuses other whitespace paths. The fixture target IS the live tree for the
        # test because Get-AiLiveTargetMap is mocked to point its junction here.
        $script:Target = Join-Path $script:Fixture 'target with spaces'
        $script:Backups = Join-Path $script:Fixture 'backups'
        $script:Runtime = Join-Path $script:Fixture 'runtime'
        $script:Calls = Join-Path $script:Fixture 'calls.txt'
        $script:Python = Join-Path $script:Fixture 'fake-python.exe'
        $script:Payload = @('line-bot/tunnel_manager.py', 'line-bot/handover.json',
            'line-bot/register-night-handover-task.ps1', 'line-bot/register-mdb-pull-task.ps1',
            'line-bot/evidence/after.txt')
        $script:Dirty = ''
        $script:FailOffline = ''
        $script:FailOfflineOnce = ''
        $script:FailOfflineSeen = @{}
        $script:PythonCalls = @()
        $script:Processes = @()
        $script:Stopped = @()
        $script:Listeners = @()
        $script:HealthBody = 'ok 4242'
        $script:Window = 'day'
        $script:Endpoint = 'https://shop-test.lhr.life/line/webhook'
        $script:Active = $true
        # A8-2 tick-window: Ready, old last run, far next run -> Proceed.
        $script:TickState = [pscustomobject]@{
            Exists = $true; State = 'Ready';
            LastRunTime = (Get-Date).AddMinutes(-30);
            NextRunTime = (Get-Date).AddMinutes(30);
            ControlScriptRunning = $false
        }
        $script:SavedEnvironment = @{}
        foreach ($name in @('LOCALAPPDATA', 'A8_TEST_CALLS', 'A8_TEST_RUNTIME', 'A8_TEST_WINDOW', 'A8_TEST_PROBE', 'A8_TEST_EVENT')) {
            $script:SavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        }
        $env:LOCALAPPDATA = $script:Runtime
        $env:A8_TEST_CALLS = $script:Calls
        $env:A8_TEST_RUNTIME = $script:Runtime
        $env:A8_TEST_WINDOW = 'day'
        $env:A8_TEST_PROBE = '0'
        $env:A8_TEST_EVENT = ''
        foreach ($dir in @($script:Source, $script:Target, $script:Backups, $script:Runtime)) {
            [void][IO.Directory]::CreateDirectory($dir)
        }
        Write-A8Fixture $script:Python 'never execute this fixture'
        foreach ($relative in $script:Payload) {
            Write-A8Fixture (Join-Path $script:Source $relative) ('new:' + $relative)
        }
        Write-A8Fixture (Join-Path $script:Target 'line-bot/tunnel_manager.py') 'old-manager'
        Write-A8Fixture (Join-Path $script:Target 'line-bot/untouched.py') 'preserve-this'
        $fakeBot = @'
param([switch]$Stop, [switch]$Probe)
$ErrorActionPreference = 'Stop'
if ($Stop) { Add-Content -LiteralPath $env:A8_TEST_CALLS -Value 'Stop'; exit 0 }
if ($Probe) { Add-Content -LiteralPath $env:A8_TEST_CALLS -Value 'Probe'; exit ([int]$env:A8_TEST_PROBE) }
Add-Content -LiteralPath $env:A8_TEST_CALLS -Value 'Start'
$runtime = Join-Path $env:A8_TEST_RUNTIME 'line-bot'
[void][IO.Directory]::CreateDirectory($runtime)
[IO.File]::WriteAllText((Join-Path $runtime 'line_webhook.pid'), '4242')
$event = if ($env:A8_TEST_WINDOW -eq 'day') { 'skipped_day' } else { 'webhook_update' }
if ($env:A8_TEST_EVENT) { $event = $env:A8_TEST_EVENT }
$row = @{ ts = [DateTimeOffset]::UtcNow.ToString('o'); event = $event;
    new_url = 'https://ai-test.trycloudflare.com/line/webhook'; old_url = '';
    put_status = $(if ($event -eq 'webhook_update') { 200 } else { 'not_attempted' });
    verify_status = 'match' }
Add-Content -LiteralPath (Join-Path $runtime 'tunnel_events.jsonl') -Value ($row | ConvertTo-Json -Compress) -Encoding UTF8
exit 0
'@
        Write-A8Fixture (Join-Path $script:Target 'line-bot/run_line_bot.ps1') $fakeBot
        Write-A8Fixture (Join-Path $script:Source 'line-bot/register-night-handover-task.ps1') @'
param([string]$Python)
Add-Content -LiteralPath $env:A8_TEST_CALLS -Value ('TaskNight:' + $Python)
exit 0
'@
        Write-A8Fixture (Join-Path $script:Source 'line-bot/register-mdb-pull-task.ps1') @'
Add-Content -LiteralPath $env:A8_TEST_CALLS -Value 'TaskMdb'
exit 0
'@
        Mock Invoke-AiGit {
            param($Root, $Arguments)
            if ($Arguments[0] -eq 'rev-parse') { return ('a' * 40) }
            if ($Arguments[0] -eq 'diff') { return ($script:Payload -join "`n") }
            if ($Arguments[0] -eq 'status') { return $script:Dirty }
            throw ('Unexpected git arguments: ' + ($Arguments -join ' '))
        }
        Mock Get-AiBackupRoot { return $script:Backups }
        Mock Get-AiPythonPath { return $script:Python }
        # A8-2: the live tree is the fixture target for the test. The junction equals
        # the fixture target so Resolve-AiTarget treats it as the live junction and
        # Start-AiBotTask accepts it. The whitespace in the path is still present, but
        # the "refuse whitespace" rule only fires for NON-live paths, so a foreign
        # whitespace path (other-target) is still refused by the runner.
        Mock Get-AiLiveTargetMap {
            return [pscustomobject]@{
                Junction = $script:Target
                Aliases  = @($script:Target)
            }
        }
        # A8-2: read-only tick state is injected; the pure decision function still runs.
        Mock Get-AiTickState { return $script:TickState }
        # A8-2: Start goes through Start-ScheduledTask in production. In the test we run
        # the fake control script's Start pass so calls.txt records 'Start' and the
        # runtime pid/events are produced, matching old behaviour.
        Mock Start-AiBotTask {
            param($Context)
            $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            $control = Join-Path $Context.Target 'line-bot/run_line_bot.ps1'
            $null = & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $control
        }
        # Real native execution is permitted only for PS1 files inside TestDrive.
        # An accidentally hard-coded live path fails closed before a child starts.
        Mock Invoke-AiNative {
            param($FilePath, $Arguments, $WorkingDirectory, $TimeoutSeconds)
            if ($FilePath -eq $script:Python) {
                $script:PythonCalls += ,@($Arguments)
                if ($Arguments -contains '-c') {
                    $state = @{ window = $script:Window; endpoint = $script:Endpoint; active = $script:Active;
                        ai_endpoint = 'https://ai-test.trycloudflare.com/line/webhook' }
                    return [pscustomobject]@{ ExitCode = 0; Output = ($state | ConvertTo-Json -Compress) }
                }
                $code = 0
                if ($script:FailOffline -and ($Arguments -contains $script:FailOffline)) { $code = 1 }
                # A8-2 retry: fail only the first attempt for the named command.
                if ($script:FailOfflineOnce -and ($Arguments -contains $script:FailOfflineOnce)) {
                    if (-not $script:FailOfflineSeen.ContainsKey($script:FailOfflineOnce)) {
                        $script:FailOfflineSeen[$script:FailOfflineOnce] = $true
                        $code = 1
                    }
                }
                return [pscustomobject]@{ ExitCode = $code; Output = 'synthetic offline test output' }
            }
            $fileIndex = [Array]::IndexOf([object[]]$Arguments, '-File')
            $allowedShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            if ($FilePath -ne $allowedShell -or $fileIndex -lt 0 -or $fileIndex + 1 -ge $Arguments.Count) {
                throw 'A8 test forbids this native command.'
            }
            $scriptPath = [IO.Path]::GetFullPath($Arguments[$fileIndex + 1])
            if (-not $scriptPath.StartsWith($script:Fixture + '\', [StringComparison]::OrdinalIgnoreCase) -or
                -not ([IO.Path]::GetFullPath($WorkingDirectory)).StartsWith($script:Fixture + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'A8 test forbids native access outside its fixture.'
            }
            return (& $script:A8RealNative -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $WorkingDirectory -TimeoutSeconds $TimeoutSeconds)
        }
        Mock Start-Sleep { }
        Mock Get-CimInstance {
            param($ClassName, $Filter)
            $rows = @($script:Processes | Where-Object { $script:Stopped -notcontains $_.ProcessId })
            if ($Filter -match '^ProcessId=(\d+)$') {
                return @($rows | Where-Object { $_.ProcessId -eq [int]$Matches[1] })
            }
            return $rows
        }
        Mock Stop-Process { param($Id) $script:Stopped += $Id }
        Mock Get-NetTCPConnection { return $script:Listeners }
        Mock Invoke-WebRequest { return [pscustomobject]@{ StatusCode = 200; Content = $script:HealthBody } }
    }

    AfterEach {
        foreach ($name in $script:SavedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $script:SavedEnvironment[$name], 'Process')
        }
    }

    It 'blocks tracked dirty target code before backup or service calls' {
        $script:Dirty = ' M line-bot/conversation.py'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
        @(Get-ChildItem -LiteralPath $script:Backups -Directory -Force).Count | Should Be 0
    }

    It 'blocks untracked target program files instead of overwriting them' {
        $script:Dirty = '?? line-bot/handover.json'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    It 'rejects missing source before any mutation' {
        (Invoke-AiLinebotDeployment -Source (Join-Path $script:Fixture 'missing') -Target $script:Target) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    It 'retains a failed preflight in the deployment log without backing up or stopping' {
        $script:Dirty = ' M line-bot/conversation.py'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        $logs = @(Get-ChildItem -LiteralPath $script:Backups -Filter 'deploy-*.log')
        $logs.Count | Should Be 1
        (Get-Content -LiteralPath $logs[0].FullName -Raw -Encoding UTF8) | Should Match 'line-bot/conversation.py'
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    It 'rejects source and target being the same tree' {
        (Invoke-AiLinebotDeployment -Source $script:Target -Target $script:Target) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    It 'uses the exact git diff list including nested evidence and records SHA backups' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        $manifest = Get-Content -LiteralPath (Join-Path $backup 'MANIFEST.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        @($manifest.Files).Count | Should Be 5
        $manifest.SourceHead | Should Be ('a' * 40)
        $old = @($manifest.Files | Where-Object { $_.Path -eq 'line-bot/tunnel_manager.py' })[0]
        $old.Existed | Should Be $true
        $old.BackupSha256 | Should Be (Get-FileHash -LiteralPath (Join-Path $backup 'payload/line-bot/tunnel_manager.py')).Hash
        (Get-Content -LiteralPath (Join-Path $backup 'payload/line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/evidence/after.txt') -Raw) | Should Be 'new:line-bot/evidence/after.txt'
    }

    It 'keeps DryRun at zero filesystem writes and zero service or Python calls' {
        $before = Get-A8Snapshot $script:Fixture
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target -DryRun -RegisterTasks) | Should Be 0
        (Get-A8Snapshot $script:Fixture) | Should Be $before
        $script:PythonCalls.Count | Should Be 0
        $script:Stopped.Count | Should Be 0
    }

    It 'restores original bytes and removes newly added files after an offline test fails' {
        $script:FailOffline = 'test_mdb_freshness'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
        (Test-Path -LiteralPath (Join-Path $script:Target 'line-bot/handover.json')) | Should Be $false
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/untouched.py') -Raw) | Should Be 'preserve-this'
        ((Get-Content -LiteralPath $script:Calls) -join ',') | Should Be 'Stop,Stop,Start,Probe'
    }

    It 'executes all three offline commands using the configured production Python' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        @($script:PythonCalls | Where-Object { $_ -contains 'test_day_night_handover' }).Count | Should Be 1
        @($script:PythonCalls | Where-Object { $_ -contains 'test_mdb_freshness' }).Count | Should Be 1
        @($script:PythonCalls | Where-Object { $_ -contains 'test_arrival_notify' }).Count | Should Be 1
        ((Get-Content -LiteralPath $script:Calls) -join ',') | Should Be 'Stop,Start,Probe'
    }

    It 'stops only exact scoped python or cloudflared PIDs and excludes this host' {
        $bot = Join-Path $script:Target 'line-bot'
        $script:Processes = @(
            [pscustomobject]@{ ProcessId = 8111; Name = 'python.exe'; CommandLine = ('python "' + $bot + '\line_webhook.py"'); CreationDate = 'same' },
            [pscustomobject]@{ ProcessId = 8112; Name = 'cloudflared.exe'; CommandLine = ('cloudflared --config "' + $bot + '\tunnel.yml"'); CreationDate = 'same' },
            [pscustomobject]@{ ProcessId = 8113; Name = 'python.exe'; CommandLine = 'python C:\unrelated\job.py'; CreationDate = 'same' },
            [pscustomobject]@{ ProcessId = 8114; Name = 'cmd.exe'; CommandLine = ('cmd "' + $bot + '\test.cmd"'); CreationDate = 'same' },
            [pscustomobject]@{ ProcessId = $PID; Name = 'python.exe'; CommandLine = ('python "' + $bot + '\self.py"'); CreationDate = 'same' }
        )
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        ($script:Stopped -join ',') | Should Be '8111,8112'
    }

    It 'does not copy payload when either bot port remains occupied' {
        $script:Listeners = @([pscustomobject]@{ LocalPort = 8792; OwningProcess = 9001 })
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
        $script:Stopped.Count | Should Be 0
    }

    It 'rolls back if Probe returns nonzero' {
        $env:A8_TEST_PROBE = '1'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'rejects a healthz pid that is neither the PID file nor its descendant even when Probe itself succeeds' {
        $script:HealthBody = 'ok 4343'
        $script:Processes = @($script:Processes) + @([pscustomobject]@{ ProcessId = 4343; ParentProcessId = 777; Name = 'python.exe'; CommandLine = 'python.exe other.py'; CreationDate = (Get-Date) })
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'rejects a healthz pid with no process row (no lineage evidence)' {
        $script:HealthBody = 'ok 4343'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'A8-3 accepts a healthz pid that is the venv child of the PID file launcher' {
        $script:HealthBody = 'ok 4343'
        $script:Processes = @($script:Processes) + @([pscustomobject]@{ ProcessId = 4343; ParentProcessId = 4242; Name = 'python.exe'; CommandLine = 'python.exe -u line_webhook.py'; CreationDate = (Get-Date) })
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
    }

    It 'A8-3 lineage helper: self, child, grandchild accepted; foreign, cycle, zero and >3 hops rejected' {
        $parents = @{ 11 = 10; 12 = 11; 13 = 12; 14 = 13; 20 = 99; 30 = 30 }
        $parentOf = { param([int]$ProcessId) if ($parents.ContainsKey($ProcessId)) { return $parents[$ProcessId] } return 0 }.GetNewClosure()
        (Test-AiHealthzPidLineage -ReportedPid 10 -TrackedPid 10 -ParentOf $parentOf) | Should Be $true
        (Test-AiHealthzPidLineage -ReportedPid 11 -TrackedPid 10 -ParentOf $parentOf) | Should Be $true
        (Test-AiHealthzPidLineage -ReportedPid 12 -TrackedPid 10 -ParentOf $parentOf) | Should Be $true
        (Test-AiHealthzPidLineage -ReportedPid 13 -TrackedPid 10 -ParentOf $parentOf) | Should Be $true
        (Test-AiHealthzPidLineage -ReportedPid 14 -TrackedPid 10 -ParentOf $parentOf) | Should Be $false
        (Test-AiHealthzPidLineage -ReportedPid 20 -TrackedPid 10 -ParentOf $parentOf) | Should Be $false
        (Test-AiHealthzPidLineage -ReportedPid 30 -TrackedPid 10 -ParentOf $parentOf) | Should Be $false
        (Test-AiHealthzPidLineage -ReportedPid 0 -TrackedPid 10 -ParentOf $parentOf) | Should Be $false
        (Test-AiHealthzPidLineage -ReportedPid 11 -TrackedPid 0 -ParentOf $parentOf) | Should Be $false
    }

    It 'rejects a daytime endpoint outside the lhr.life shop domain' {
        $script:Endpoint = 'https://lhr.life.attacker.invalid/line/webhook'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'rejects daytime PUT evidence rather than trusting an endpoint readback alone' {
        $env:A8_TEST_EVENT = 'webhook_update'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'accepts fresh verified night events with the exact AI endpoint' {
        $script:Window = 'night'
        $env:A8_TEST_WINDOW = 'night'
        $script:Endpoint = 'https://ai-test.trycloudflare.com/line/webhook'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'new:line-bot/tunnel_manager.py'
    }

    It 'rejects a night endpoint that still points to the shop' {
        $script:Window = 'night'
        $env:A8_TEST_WINDOW = 'night'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
    }

    It 'never registers tasks by default' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        @((Get-Content -LiteralPath $script:Calls) | Where-Object { $_ -like 'Task*' }).Count | Should Be 0
    }

    It 'registers both fake task scripts only after all acceptance gates pass' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target -RegisterTasks) | Should Be 0
        $rows = @(Get-Content -LiteralPath $script:Calls)
        $rows[2] | Should Be 'Probe'
        $rows[3] | Should Be ('TaskNight:' + $script:Python)
        $rows[4] | Should Be 'TaskMdb'
    }

    It 'performs explicit Rollback without requiring the source tree' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback $backup) | Should Be 0
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/tunnel_manager.py') -Raw) | Should Be 'old-manager'
        (Test-Path -LiteralPath (Join-Path $script:Target 'line-bot/handover.json')) | Should Be $false
        ((Get-Content -LiteralPath $script:Calls) -join ',') | Should Be 'Stop,Start,Probe,Stop,Start,Probe'
    }

    It 'validates backup hashes before an explicit Rollback can stop services' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        Write-A8Fixture (Join-Path $backup 'payload/line-bot/tunnel_manager.py') 'corrupt-backup'
        $before = Get-Content -LiteralPath $script:Calls -Raw
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback $backup) | Should Be 1
        (Get-Content -LiteralPath $script:Calls -Raw) | Should Be $before
    }

    It 'preserves later local edits instead of deleting them during explicit Rollback' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        Write-A8Fixture (Join-Path $script:Target 'line-bot/handover.json') 'later-owner-edit'
        $before = Get-Content -LiteralPath $script:Calls -Raw
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback $backup) | Should Be 1
        (Get-Content -LiteralPath $script:Calls -Raw) | Should Be $before
        (Get-Content -LiteralPath (Join-Path $script:Target 'line-bot/handover.json') -Raw) | Should Be 'later-owner-edit'
    }

    It 'rejects manifest path traversal before stopping services' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        $path = Join-Path $backup 'MANIFEST.json'
        $manifest = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $manifest.Files[0].Path = 'line-bot/../../outside.py'
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
        $before = Get-Content -LiteralPath $script:Calls -Raw
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback $backup) | Should Be 1
        (Get-Content -LiteralPath $script:Calls -Raw) | Should Be $before
    }

    It 'binds a backup manifest to its original target' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        # A different, non-whitespace path so the runner reaches the manifest-target
        # check (a whitespace foreign path would be refused earlier; see dedicated case).
        $other = Join-Path $script:Fixture 'other-target'
        Write-A8Fixture (Join-Path $other 'line-bot/run_line_bot.ps1') 'throw "must never execute"'
        (Invoke-AiLinebotDeployment -Target $other -Rollback $backup) | Should Be 1
        (Test-Path -LiteralPath (Join-Path $other 'line-bot/tunnel_manager.py')) | Should Be $false
    }

    It 'rejects rollback switches that could also register tasks or pretend to be dry' {
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback 'unused' -RegisterTasks) | Should Be 1
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback 'unused' -DryRun) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    It 'refuses a git payload escaping line-bot before any copy' {
        $script:Payload = @('line-bot/../secrets/channel.json')
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
    }

    # --- A8-2 new cases -----------------------------------------------------

    It 'maps a whitespace live target to the junction and operates there' {
        # The junction equals the fixture target (a whitespace path). Resolve-AiTarget
        # must treat it as live and normalize Root to the junction, not refuse it.
        $resolved = Resolve-AiTarget $script:Target
        $resolved.Live | Should Be $true
        ([string]$resolved.Root).TrimEnd('\') | Should Be ([string]$script:Target).TrimEnd('\')
        # A full deployment to this target succeeds (proves normalization is accepted).
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
    }

    It 'refuses a foreign whitespace target before any backup or stop' {
        $foreign = Join-Path $script:Fixture 'foreign dir with spaces'
        Write-A8Fixture (Join-Path $foreign 'line-bot/run_line_bot.ps1') 'throw "must never execute"'
        { Resolve-AiTarget $foreign } | Should Throw
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $foreign) | Should Be 1
        (Test-Path -LiteralPath $script:Calls) | Should Be $false
        @(Get-ChildItem -LiteralPath $script:Backups -Directory -Force).Count | Should Be 0
    }

    It 'does not hang when a grandchild keeps stdout open past the child exit' {
        # A background powershell child sleeps 20 s with inherited handles; the direct
        # child exits immediately. Invoke-AiNative must return within ~10 s with a
        # truncation note rather than blocking for the full 20 s.
        $script = Join-Path $script:Fixture 'grandchild.ps1'
        $body = @'
$ErrorActionPreference = 'Stop'
# Spawn a detached grandchild that inherits the redirected stdout and holds it open.
Start-Process -FilePath $PSHOME\powershell.exe `
    -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 20; Write-Output grandchild-late' `
    -NoNewWindow
Write-Output 'parent-done'
exit 0
'@
        [IO.File]::WriteAllText($script, $body, (New-Object Text.UTF8Encoding($false)))
        $shell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $script)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $result = & $script:A8RealNative -FilePath $shell -Arguments $args -WorkingDirectory $script:Fixture -TimeoutSeconds 60 -DrainSeconds 4
        $sw.Stop()
        $sw.Elapsed.TotalSeconds | Should BeLessThan 15
        $result.Truncated | Should Be $true
        $result.Output | Should Match 'parent-done'
    }

    It 'proceeds in a tick-safe window when Ready with old last run and far next run' {
        $now = Get-Date
        $decision = Get-AiTickWindowDecision -Now $now `
            -LastRunTime $now.AddMinutes(-30) -NextRunTime $now.AddMinutes(30) -State 'Ready'
        $decision.Action | Should Be 'Proceed'
        $decision.WaitSeconds | Should Be 0
    }

    It 'waits while a Laundry-LINE-Bot tick is Running' {
        $now = Get-Date
        $decision = Get-AiTickWindowDecision -Now $now `
            -LastRunTime $now.AddMinutes(-30) -NextRunTime $now.AddMinutes(30) -State 'Running'
        $decision.Action | Should Be 'WaitRunning'
        $decision.WaitSeconds | Should BeGreaterThan 0
    }

    It 'waits when the next tick is too close' {
        $now = Get-Date
        $decision = Get-AiTickWindowDecision -Now $now `
            -LastRunTime $now.AddMinutes(-30) -NextRunTime $now.AddSeconds(20) -State 'Ready'
        $decision.Action | Should Be 'WaitNextTick'
        $decision.WaitSeconds | Should BeGreaterThan 0
    }

    It 'succeeds when an offline test fails once then passes on retry and logs both attempts' {
        $script:FailOfflineOnce = 'test_mdb_freshness'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $log = @(Get-ChildItem -LiteralPath $script:Backups -Filter 'deploy-*.log')[0].FullName
        $text = Get-Content -LiteralPath $log -Raw -Encoding UTF8
        $text | Should Match 'attempt 1/2'
        $text | Should Match 'attempt 2/2'
        $text | Should Match 'RETRY'
        $text | Should Match 'passed on retry'
    }

    It 'fails when an offline test fails on both attempts' {
        $script:FailOffline = 'test_mdb_freshness'
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 1
        $log = @(Get-ChildItem -LiteralPath $script:Backups -Filter 'deploy-*.log')[0].FullName
        $text = Get-Content -LiteralPath $log -Raw -Encoding UTF8
        $text | Should Match 'attempt 1/2'
        $text | Should Match 'attempt 2/2'
        $text | Should Match 'both attempts'
    }

    It 'writes a rollback WARNING line about daytime tunnel_manager PUTs' {
        (Invoke-AiLinebotDeployment -Source $script:Source -Target $script:Target) | Should Be 0
        $backup = @(Get-ChildItem -LiteralPath $script:Backups -Directory)[0].FullName
        (Invoke-AiLinebotDeployment -Target $script:Target -Rollback $backup) | Should Be 0
        $log = @(Get-ChildItem -LiteralPath $script:Backups -Filter 'deploy-*.log' | Sort-Object LastWriteTime)[-1].FullName
        $text = Get-Content -LiteralPath $log -Raw -Encoding UTF8
        $text | Should Match 'WARNING rollback'
        $text | Should Match 'tunnel_manager'
    }
}
