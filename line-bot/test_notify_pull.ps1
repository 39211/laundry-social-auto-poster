#requires -Version 5.1
# Offline checks for the N1 notify_report step in pull_shop_mdb.ps1. Real ssh/scp never run.
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

foreach ($name in @('pull_shop_mdb.ps1', 'test_notify_pull.ps1')) {
    $path = Join-Path $PSScriptRoot $name
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "parse $name"
    $bytes = [IO.File]::ReadAllBytes($path)
    Assert-True (@($bytes | Where-Object { $_ -gt 127 }).Count -eq 0) "$name ASCII only"
    if ($name -eq 'pull_shop_mdb.ps1') {
        Assert-True (-not ([IO.File]::ReadAllText($path) -match 'Register-ScheduledTask')) 'pull script never touches scheduled tasks'
        foreach ($node in $ast.EndBlock.Statements) {
            if ($node -is [Management.Automation.Language.FunctionDefinitionAst]) {
                . ([scriptblock]::Create($node.Extent.Text))
            }
        }
    }
}

function New-ReportJson([string[]]$Dates) {
    $days = @($Dates | ForEach-Object {
        '{"date":"' + $_ + '","sent":3,"wrong_sends":0,"wrong_sends_basis":"auto_duplicate_deliveries","duplicates":0,"abandoned":1,"no_binding":2,"pending":0,"first_ts":"10:15","last_ts":"18:40","reported_by":"shop-notify-report"}'
    })
    '{"schema":"notify-report/v1","generated_at":"2026-11-02T10:30:00+08:00","outbox":"ok","corrupt_lines":0,"days":[' + ($days -join ',') + ']}'
}
function Set-NotifyReply([int]$Exit, [string]$Output, [bool]$TimedOut = $false) {
    $script:notifyReply = [pscustomobject]@{ Exit = $Exit; TimedOut = $TimedOut; Output = $Output }
}
function Read-LastLog([string]$Path) {
    $lines = @([IO.File]::ReadAllLines($Path) | Where-Object { $_.Length -gt 0 })
    $lines[$lines.Count - 1] | ConvertFrom-Json
}
function Get-FileCount([string]$Directory) {
    if (-not [IO.Directory]::Exists($Directory)) { return 0 }
    @(Get-ChildItem -LiteralPath $Directory -File -Force).Count
}
function Get-NotifyCalls { @($script:calls | Where-Object { $_.program -eq 'ssh.exe' -and $_.arguments -contains '-n' }) }

# Mocked transport: '-n' marks the notify call; everything else is the MDB pull.
$script:calls = New-Object Collections.ArrayList
$script:mdbReply = [pscustomobject]@{ Exit = 255; TimedOut = $false; Output = '' }
Set-NotifyReply 0 ''
function Invoke-ShopProcess([string]$Program, [string[]]$Arguments, [int]$TimeoutSeconds) {
    [void]$script:calls.Add(@{ program = $Program; arguments = $Arguments; timeout = $TimeoutSeconds })
    if ($Arguments -contains '-n') { return $script:notifyReply }
    return $script:mdbReply
}

$root = Join-Path $PSScriptRoot ('.n1-ps-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
try {
    $dates = @('2026-11-02', '2026-11-01')
    $good = New-ReportJson $dates
    $common = @{ ShopRoot = 'C:/LaundryStores/fxwash'; ShopPython = 'python'; TimeoutSeconds = 60 }

    # Date computation (Asia/Taipei).
    $d1 = @(Get-NotifyReportDates ([DateTimeOffset]::new(2026, 11, 2, 1, 0, 0, [TimeSpan]::Zero)))
    $d2 = @(Get-NotifyReportDates ([DateTimeOffset]::new(2026, 11, 1, 16, 30, 0, [TimeSpan]::Zero)))
    $d3 = @(Get-NotifyReportDates ([DateTimeOffset]::new(2026, 11, 1, 15, 59, 0, [TimeSpan]::Zero)))
    Assert-True (($d1 -join ',') -ceq '2026-11-02,2026-11-01' -and ($d2 -join ',') -ceq '2026-11-02,2026-11-01') 'today/yesterday in Taipei'
    Assert-True (($d3 -join ',') -ceq '2026-11-01,2026-10-31') 'Taipei midnight boundary'

    # OK: files written atomically with the gate schema.
    $gates = Join-Path $root 'repo\data\gates'
    $log = Join-Path $root 'ok.jsonl'
    Set-NotifyReply 0 ($good + "`r`n")
    $script:calls.Clear()
    $status = Invoke-NotifyPull -LogPath $log -GatesDir $gates -Dates $dates @common
    Assert-True ($status -ceq 'OK') "OK status (got $status)"
    foreach ($d in $dates) {
        $file = Join-Path $gates ('notify-' + $d + '.json')
        Assert-True ([IO.File]::Exists($file)) "file written for $d"
        $obj = [IO.File]::ReadAllText($file) | ConvertFrom-Json
        $names = @($obj.PSObject.Properties.Name) -join ','
        Assert-True ($names -ceq 'date,sent,wrong_sends,reported_by,wrong_sends_basis,duplicates,abandoned,no_binding,pending,fetched_at') "gate fields for $d"
        Assert-True ($obj.date -ceq $d -and $obj.sent -eq 3 -and $obj.wrong_sends -eq 0 -and $obj.abandoned -eq 1 -and $obj.no_binding -eq 2 -and $obj.reported_by -ceq 'shop-notify-report' -and $obj.wrong_sends_basis -ceq 'auto_duplicate_deliveries') "gate values for $d"
        Assert-True ([bool]$obj.fetched_at) "fetched_at for $d"
    }
    Assert-True ((Get-FileCount $gates) -eq 2) 'only the two gate files, no temp left'
    $record = Read-LastLog $log
    Assert-True ($record.notify_report -ceq 'OK' -and -not (@($record.PSObject.Properties.Name) -contains 'ts')) 'log line OK without ts'
    $notify = @(Get-NotifyCalls)
    Assert-True ($notify.Count -eq 1) 'one notify ssh call'
    $a = $notify[0].arguments
    Assert-True ($notify[0].timeout -eq 60 -and $a -contains 'BatchMode=yes' -and $a -contains 'ConnectTimeout=10' -and $a -contains 'StrictHostKeyChecking=yes' -and $a -contains 'shop-pc') 'notify ssh alias/options/timeout'
    $remote = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String(($a[-1] -split ' ')[-1]))
    Assert-True ($remote.Contains("Set-Location -LiteralPath 'C:/LaundryStores/fxwash'")) 'remote runs in the shop root'
    Assert-True ($remote.Contains("& 'python' -I -S -B 'runtime\notify_report.py' --root . --date '2026-11-02' --date '2026-11-01'")) 'remote report command and dates'

    # A rejected reply never touches existing files.
    $before = @($dates | ForEach-Object { [IO.File]::ReadAllText((Join-Path $gates ('notify-' + $_ + '.json'))) })
    Set-NotifyReply 0 'not json {'
    $status = Invoke-NotifyPull -LogPath $log -GatesDir $gates -Dates $dates @common
    $after = @($dates | ForEach-Object { [IO.File]::ReadAllText((Join-Path $gates ('notify-' + $_ + '.json'))) })
    Assert-True ($status -ceq 'FAILED:invalid_json' -and ($before -join '|') -ceq ($after -join '|')) 'failure keeps existing gate files'

    $rejects = @(
        @('invalid JSON', '{"schema":"notify-report/v1","days":[', 'FAILED:invalid_json'),
        @('empty output', '', 'FAILED:empty_output'),
        @('uid-looking value', $good.Replace('"reported_by":"shop-notify-report"', '"reported_by":"U0123456789abcdef0123456789abcdef"'), 'FAILED:line_user_id_like_value'),
        @('escaped uid-looking value', $good.Replace('"first_ts":"10:15"', '"first_ts":"\u00550123456789abcdef0123456789abcdef"'), 'FAILED:forbidden_content'),
        @('uid key', $good.Replace('"sent":3', '"uid":"x","sent":3'), 'FAILED:forbidden_content'),
        @('messages key', $good.Replace('"sent":3', '"messages":[],"sent":3'), 'FAILED:forbidden_content'),
        @('text key', $good.Replace('"outbox":"ok"', '"outbox":"ok","text":"hello"'), 'FAILED:forbidden_content'),
        @('wrong schema', $good.Replace('notify-report/v1', 'notify-report/v0'), 'FAILED:schema'),
        @('negative count', $good.Replace('"pending":0', '"pending":-1'), 'FAILED:count_pending'),
        @('fractional count', $good.Replace('"sent":3', '"sent":3.5'), 'FAILED:count_sent'),
        @('string count', $good.Replace('"sent":3', '"sent":"3"'), 'FAILED:count_sent'),
        @('dates mismatch', (New-ReportJson @('2026-11-02', '2026-10-31')), 'FAILED:date_mismatch'),
        @('day missing', (New-ReportJson @('2026-11-02')), 'FAILED:day_count'),
        @('outbox missing', $good.Replace('"outbox":"ok"', '"outbox":"missing"'), 'FAILED:outbox_missing'),
        @('corrupt lines', $good.Replace('"corrupt_lines":0', '"corrupt_lines":1'), 'FAILED:corrupt_lines'),
        @('not an object', '[1,2]', 'FAILED:not_an_object')
    )
    $i = 0
    foreach ($case in $rejects) {
        $i++
        $dir = Join-Path $root ('gates-' + $i)
        $caseLog = Join-Path $root ('reject-' + $i + '.jsonl')
        Set-NotifyReply 0 $case[1]
        $status = Invoke-NotifyPull -LogPath $caseLog -GatesDir $dir -Dates $dates @common
        Assert-True ($status -ceq $case[2]) "$($case[0]): $($case[2]) (got $status)"
        Assert-True ((Get-FileCount $dir) -eq 0) "$($case[0]): no file written"
        Assert-True ((Read-LastLog $caseLog).notify_report -ceq $case[2]) "$($case[0]): logged"
    }

    # ssh failures.
    $dir = Join-Path $root 'gates-ssh'
    Set-NotifyReply 255 ''
    $status = Invoke-NotifyPull -LogPath $log -GatesDir $dir -Dates $dates @common
    Assert-True ($status -ceq 'FAILED:ssh_exit_255' -and (Get-FileCount $dir) -eq 0) 'ssh failure: FAILED, no file'
    Set-NotifyReply 3 '' $true
    $status = Invoke-NotifyPull -LogPath $log -GatesDir $dir -Dates $dates @common
    Assert-True ($status -ceq 'FAILED:ssh_timeout' -and (Get-FileCount $dir) -eq 0) 'ssh timeout: FAILED, no file'

    # DryRun: no connection, SKIPPED logged.
    $script:calls.Clear()
    $status = Invoke-NotifyPull -DryRun -LogPath $log -GatesDir $dir -Dates $dates @common
    Assert-True ($status -ceq 'SKIPPED' -and $script:calls.Count -eq 0 -and (Read-LastLog $log).notify_report -ceq 'SKIPPED') 'DryRun: SKIPPED, no ssh'
    # WhatIf: no connection and no write at all.
    $lineCount = @([IO.File]::ReadAllLines($log)).Count
    $status = Invoke-NotifyPull -WhatIf -LogPath $log -GatesDir $dir -Dates $dates @common
    Assert-True ($status -ceq 'SKIPPED' -and $script:calls.Count -eq 0 -and @([IO.File]::ReadAllLines($log)).Count -eq $lineCount) 'WhatIf: nothing connected or written'

    # Whole flow with the real Invoke-MdbPull: its result/exit never change.
    $mdbLog = Join-Path $root 'mdb.jsonl'
    $dest = Join-Path $root 'dest\eHank.mdb'
    $sched = @{ Destination = $dest; LogPath = $mdbLog; TimeoutSeconds = 60; GatesDir = (Join-Path $root 'gates-sched')
        ShopRoot = 'C:/LaundryStores/fxwash'; ShopPython = 'python'; NotifyDates = $dates
        # A2-c: one attempt, so these checks keep their log-line indexes and never sleep.
        MaxAttempts = 1 }
    $script:mdbReply = [pscustomobject]@{ Exit = 255; TimedOut = $false; Output = '' }
    Set-NotifyReply 0 $good
    $code = Invoke-ScheduledPull @sched
    $lines = @([IO.File]::ReadAllLines($mdbLog) | ForEach-Object { $_ | ConvertFrom-Json })
    Assert-True ($code -eq 3 -and $lines[0].result -ceq 'REMOTE_UNAVAILABLE' -and $lines[0].exit -eq 3) "MDB result 3 with notify OK (got $code)"
    Assert-True ($lines[1].notify_report -ceq 'OK' -and (Get-FileCount $sched.GatesDir) -eq 2) 'notify OK after failed MDB pull'
    Set-NotifyReply 255 ''
    $code = Invoke-ScheduledPull @sched
    $lines = @([IO.File]::ReadAllLines($mdbLog) | ForEach-Object { $_ | ConvertFrom-Json })
    Assert-True ($code -eq 3 -and $lines[2].result -ceq 'REMOTE_UNAVAILABLE' -and $lines[2].exit -eq 3 -and $lines[3].notify_report -ceq 'FAILED:ssh_exit_255') 'ssh failure leaves MDB result 3 unchanged'
    Assert-True (-not [IO.File]::Exists($dest)) 'no MDB written by the failed pull'

    # Mocked MDB results: notify failure/throw never changes them.
    $script:fakeMdbCode = 0
    function Invoke-MdbPull { param([switch]$DryRun, [string]$Destination, [string]$LogPath, [int]$TimeoutSeconds) return $script:fakeMdbCode }
    $code = Invoke-ScheduledPull @sched
    Assert-True ($code -eq 0) "MDB exit 0 kept when notify ssh fails (got $code)"
    $script:fakeMdbCode = 2
    function Invoke-NotifyPull { param([switch]$DryRun, $LogPath, $GatesDir, $ShopRoot, $ShopPython, $TimeoutSeconds, $Dates) throw 'boom' }
    $code = Invoke-ScheduledPull @sched
    Assert-True ($code -eq 2) "MDB exit 2 kept when the notify step throws (got $code)"
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
