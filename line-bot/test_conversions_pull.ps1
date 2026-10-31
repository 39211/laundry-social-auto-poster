#requires -Version 5.1
# Offline behavior checks for pull_shop_conversions.ps1. Real ssh/scp and Task Scheduler never run.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script:passed = 0
$script:failed = 0
function Assert-True($Condition, [string]$Name) {
    if ($Condition) { $script:passed++; Write-Output "PASS $Name" }
    else { $script:failed++; Write-Output "FAIL $Name" }
}

$pullScript = Join-Path $PSScriptRoot 'pull_shop_conversions.ps1'
foreach ($name in @('pull_shop_conversions.ps1', 'register-conversions-pull-task.ps1', 'test_conversions_pull.ps1')) {
    $path = Join-Path $PSScriptRoot $name
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "parse $name"
    $bytes = [IO.File]::ReadAllBytes($path)
    Assert-True (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0) "$name ASCII only"
    if ($name -eq 'pull_shop_conversions.ps1') {
        foreach ($node in $ast.EndBlock.Statements) {
            if ($node -is [Management.Automation.Language.FunctionDefinitionAst]) {
                . ([scriptblock]::Create($node.Extent.Text))
            }
        }
    }
}

# Allow-list checks.
$badNames = @('inquiries.jsonl', 'inquiries.jsonl.gen', 'shop.json', 'secrets\x.json', 'source-to-order-2026-W44.json.bak',
    '..\x.json', '..\source-to-order-2026-W44.json', 'history\source-to-order-2026-W44.r1.json',
    'source-to-order-2026-W44.json ', "source-to-order-2026-W44.json`n", 'SOURCE-TO-ORDER-2026-W44.JSON', '')
foreach ($bad in $badNames) {
    $label = $bad -replace "`n", '\n'
    Assert-True (-not (Test-ConversionFileName $bad '') -and -not (Test-ConversionFileName $bad 'history')) "allow-list rejects '$label'"
}
Assert-True (Test-ConversionFileName 'source-to-order-2026-W44.json' '') 'allow-list accepts weekly file'
Assert-True (Test-ConversionFileName 'source-to-order-2026-W44.r12.json' 'history') 'allow-list accepts history revision'
Assert-True (-not (Test-ConversionFileName 'source-to-order-2026-W44.json' 'history')) 'weekly name refused inside history'
Assert-True (-not (Test-ConversionFileName 'source-to-order-2026-W44.r1.json' '')) 'revision name refused in main folder'
Assert-True (-not (Test-ConversionFileName 'source-to-order-2026-W44.json' 'secrets') -and -not (Test-ConversionFileName 'source-to-order-2026-W44.json' '..')) 'other folders refused'

function Write-TestFile([string]$Path, [string]$Text) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path))
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding $false))
}
function Read-LastLog([string]$Path) {
    $lines = @([IO.File]::ReadAllLines($Path) | Where-Object { $_.Length -gt 0 })
    $lines[$lines.Count - 1] | ConvertFrom-Json
}
$valid44 = '{"week": "2026-W44", "revision": 2, "status": "lower_bound", "rows": [{"source": "unknown", "inquiries": 3}]}'
$valid44b = '{"week": "2026-W44", "revision": 3, "status": "lower_bound", "rows": [{"source": "unknown", "inquiries": 4}]}'
$history44 = '{"week": "2026-W44", "revision": 1, "status": "lower_bound", "rows": []}'
$broken45 = '{"week": "2026-W45", "rows": ['

$root = Join-Path $PSScriptRoot ('.b27-ps-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
try {
    # Fake shop tree: allowed files plus everything that must never travel.
    $shopData = Join-Path $root 'shop\data'
    $src = Join-Path $shopData 'conversions'
    Write-TestFile (Join-Path $src 'source-to-order-2026-W44.json') $valid44
    Write-TestFile (Join-Path $src 'source-to-order-2026-W45.json') $broken45
    Write-TestFile (Join-Path $src 'history\source-to-order-2026-W44.r1.json') $history44
    Write-TestFile (Join-Path $src 'history\source-to-order-2026-W44.json') $valid44
    Write-TestFile (Join-Path $src 'history\inquiries.jsonl') '{"k":"x"}'
    Write-TestFile (Join-Path $src 'inquiries.jsonl') '{"k":"x"}'
    Write-TestFile (Join-Path $src 'inquiries.jsonl.gen') '1'
    Write-TestFile (Join-Path $src 'shop.json') '{"secret":"no"}'
    Write-TestFile (Join-Path $src 'source-to-order-2026-W44.json.bak') $valid44
    Write-TestFile (Join-Path $src 'secrets\x.json') '{"secret":"no"}'
    Write-TestFile (Join-Path $shopData 'x.json') '{"outside":"no"}'
    Write-TestFile (Join-Path $shopData 'inquiries.jsonl') '{"k":"x"}'
    $tgt = Join-Path $root 'repo\data\conversions'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $tgt))
    $log = Join-Path $root 'pull.jsonl'

    $code = Invoke-ConversionsPull -SourceRoot $src -TargetRoot $tgt -LogPath $log
    Assert-True ($code -eq 2) "invalid JSON gives exit 2 (got $code)"
    Assert-True ([IO.File]::ReadAllText((Join-Path $tgt 'source-to-order-2026-W44.json')) -ceq $valid44) 'valid sibling installed'
    Assert-True ([IO.File]::ReadAllText((Join-Path $tgt 'history\source-to-order-2026-W44.r1.json')) -ceq $history44) 'history revision installed'
    Assert-True (-not [IO.File]::Exists((Join-Path $tgt 'source-to-order-2026-W45.json'))) 'invalid JSON not installed'
    $all = @(Get-ChildItem -LiteralPath $tgt -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($tgt.Length + 1) } | Sort-Object)
    Assert-True (($all -join ';') -ceq 'history\source-to-order-2026-W44.r1.json;source-to-order-2026-W44.json') 'only allow-listed files copied, no temp left'
    $record = Read-LastLog $log
    Assert-True ($record.listed -eq 3 -and $record.installed -eq 2 -and $record.invalid -eq 1 -and $record.ignored -eq 6 -and $record.exit -eq 2) 'log counts run 1'
    Assert-True ((@($record.PSObject.Properties.Name) -join ',') -ceq 'ts,result,listed,ignored,unchanged,installed,invalid,failed,exit') 'log holds counts only'

    Remove-Item -LiteralPath (Join-Path $src 'source-to-order-2026-W45.json')
    $marker = [DateTime]::new(2020, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    [IO.File]::SetLastWriteTimeUtc((Join-Path $tgt 'source-to-order-2026-W44.json'), $marker)
    $code = Invoke-ConversionsPull -SourceRoot $src -TargetRoot $tgt -LogPath $log
    $record = Read-LastLog $log
    Assert-True ($code -eq 0 -and $record.unchanged -eq 2 -and $record.installed -eq 0 -and $record.result -eq 'NOTHING_NEW') 'unchanged files skipped, exit 0'
    Assert-True ([IO.File]::GetLastWriteTimeUtc((Join-Path $tgt 'source-to-order-2026-W44.json')) -eq $marker) 'unchanged file not rewritten'

    Write-TestFile (Join-Path $src 'source-to-order-2026-W44.json') $valid44b
    $code = Invoke-ConversionsPull -SourceRoot $src -TargetRoot $tgt -LogPath $log
    $record = Read-LastLog $log
    Assert-True ($code -eq 0 -and $record.installed -eq 1 -and $record.unchanged -eq 1) 'changed file replaced, exit 0'
    Assert-True ([IO.File]::ReadAllText((Join-Path $tgt 'source-to-order-2026-W44.json')) -ceq $valid44b) 'replacement content installed'
    Assert-True (@(Get-ChildItem -LiteralPath $tgt -Recurse -Filter '*.tmp' -Force).Count -eq 0) 'no temp files after replace'

    # Whole script as a child process: exit code 2 reaches the caller.
    $src2 = Join-Path $root 'shop2\conversions'
    Write-TestFile (Join-Path $src2 'source-to-order-2026-W44.json') $valid44
    Write-TestFile (Join-Path $src2 'source-to-order-2026-W45.json') $broken45
    $tgt2 = Join-Path $root 'repo2\data\conversions'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $tgt2))
    $powershell = Join-Path $PSHOME 'powershell.exe'
    $ErrorActionPreference = 'Continue'
    $null = & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $pullScript -SourceRoot $src2 -TargetRoot $tgt2 -LogPath (Join-Path $root 'pull2.jsonl')
    $childCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Assert-True ($childCode -eq 2 -and [IO.File]::Exists((Join-Path $tgt2 'source-to-order-2026-W44.json'))) "script exit 2 with valid sibling installed (got $childCode)"

    # Shop transport path with a mocked Invoke-ShopProcess (no ssh/scp is started).
    $script:fake = Join-Path $root 'fake-remote-W46.json'
    Write-TestFile $script:fake '{"week": "2026-W46", "revision": 1, "rows": []}'
    $script:fakeHash = (Get-FileHash -LiteralPath $script:fake -Algorithm SHA256).Hash
    $script:fakeBytes = (Get-Item -LiteralPath $script:fake).Length
    function Invoke-ShopProcess([string]$Program, [string[]]$Arguments, [int]$TimeoutSeconds) {
        [void]$script:calls.Add(@{ program = $Program; arguments = $Arguments; timeout = $TimeoutSeconds })
        if ($script:mode -eq 'unreachable') { return [pscustomobject]@{ Exit = 255; TimedOut = $false; Output = '' } }
        if ($Program -eq 'ssh.exe') {
            $listing = @(
                @{ dir = ''; name = 'source-to-order-2026-W46.json'; bytes = $script:fakeBytes; sha256 = $script:fakeHash },
                @{ dir = ''; name = 'inquiries.jsonl'; bytes = $script:fakeBytes; sha256 = $script:fakeHash },
                @{ dir = ''; name = 'shop.json'; bytes = $script:fakeBytes; sha256 = $script:fakeHash },
                @{ dir = 'secrets'; name = 'source-to-order-2026-W46.json'; bytes = $script:fakeBytes; sha256 = $script:fakeHash },
                @{ dir = 'history'; name = '..\x.json'; bytes = $script:fakeBytes; sha256 = $script:fakeHash }
            )
            return [pscustomobject]@{ Exit = 0; TimedOut = $false; Output = (ConvertTo-Json -InputObject $listing -Compress) }
        }
        if ($script:mode -eq 'tampered') { [IO.File]::WriteAllText($Arguments[-1], '{"other": 1}') }
        else { [IO.File]::Copy($script:fake, $Arguments[-1], $false) }
        return [pscustomobject]@{ Exit = 0; TimedOut = $false; Output = '' }
    }
    foreach ($mode in @('unreachable', 'tampered', 'good')) {
        $script:mode = $mode
        $script:calls = New-Object Collections.ArrayList
        $tgtR = Join-Path $root ('repo-' + $mode + '\data\conversions')
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $tgtR))
        $logR = Join-Path $root ('pull-' + $mode + '.jsonl')
        $code = Invoke-ConversionsPull -TargetRoot $tgtR -LogPath $logR
        $installedFile = Join-Path $tgtR 'source-to-order-2026-W46.json'
        $scpCalls = @($script:calls | Where-Object { $_.program -eq 'scp.exe' })
        foreach ($call in $script:calls) {
            Assert-True ($call.timeout -eq 60 -and $call.arguments -contains 'BatchMode=yes' -and $call.arguments -contains 'StrictHostKeyChecking=yes') "$mode batch/timeout arguments"
        }
        if ($mode -eq 'unreachable') {
            Assert-True ($code -eq 1 -and $scpCalls.Count -eq 0 -and -not [IO.File]::Exists($installedFile)) 'unreachable: exit 1, nothing copied'
        }
        elseif ($mode -eq 'tampered') {
            Assert-True ($code -eq 1 -and -not [IO.File]::Exists($installedFile)) 'hash mismatch: exit 1, not installed'
            Assert-True (@(Get-ChildItem -LiteralPath $tgtR -Recurse -File -Force).Count -eq 0) 'hash mismatch: temp removed'
        }
        else {
            Assert-True ($code -eq 0 -and [IO.File]::Exists($installedFile)) 'remote good: installed, exit 0'
            Assert-True ($scpCalls.Count -eq 1 -and $scpCalls[0].arguments -contains 'shop-pc:C:/LaundryStores/fxwash/data/conversions/source-to-order-2026-W46.json') 'remote: scp only for the allow-listed file'
            Assert-True (@(Get-ChildItem -LiteralPath $tgtR -Recurse -File -Force).Count -eq 1) 'remote: nothing else written'
            $record = Read-LastLog $logR
            Assert-True ($record.ignored -eq 4 -and $record.listed -eq 1) 'remote: disallowed listing entries ignored'
        }
    }

    # Mock scheduler cmdlets; verify the real registration script.
    $global:B27Triggers = New-Object Collections.ArrayList
    $global:B27Registered = $null
    function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
    function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) @{ execute = $Execute; arguments = $Argument } }
    function New-ScheduledTaskTrigger {
        param([switch]$Weekly, $DaysOfWeek, [datetime]$At)
        [void]$global:B27Triggers.Add(('{0} {1} {2}' -f [bool]$Weekly, $DaysOfWeek, $At.ToString('HH:mm'))); @{ weekly = [bool]$Weekly }
    }
    function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) @{ user = $UserId; type = $LogonType; level = $RunLevel } }
    function New-ScheduledTaskSettingsSet { param($MultipleInstances, $ExecutionTimeLimit) @{ instances = $MultipleInstances } }
    function Register-ScheduledTask { param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description) $global:B27Registered = $PSBoundParameters }
    $null = & (Join-Path $PSScriptRoot 'register-conversions-pull-task.ps1') -DryRun
    Assert-True ($null -eq $global:B27Registered -and $global:B27Triggers.Count -eq 0) 'register -DryRun changes nothing'
    $null = & (Join-Path $PSScriptRoot 'register-conversions-pull-task.ps1')
    Assert-True (($global:B27Triggers -join ';') -ceq 'True Monday 11:10;True Monday 15:10') 'mock schedule Monday 11:10 and 15:10'
    Assert-True ($global:B27Registered.TaskName -eq 'LineBot-PullShopConversions' -and $global:B27Registered.Principal.type -eq 'Interactive' -and $global:B27Registered.Principal.level -eq 'Limited' -and $global:B27Registered.Settings.instances -eq 'IgnoreNew') 'mock schedule principal and no overlap'
    Assert-True ($global:B27Registered.Action.arguments -like '*pull_shop_conversions.ps1*') 'mock schedule action runs the pull script'
}
catch {
    Write-Output ('FAIL unexpected error: ' + $_.Exception.Message)
    $script:failed++
}
finally {
    # Literal, task-owned directory, checked to remain within line-bot; no junctions.
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith($PSScriptRoot + [IO.Path]::DirectorySeparatorChar)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Output "RESULT PASS=$script:passed FAIL=$script:failed"
if ($script:failed -gt 0) { exit 1 }
exit 0
