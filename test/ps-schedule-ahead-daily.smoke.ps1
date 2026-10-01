# R4：從正式腳本的 AST 只抽取純函式；不執行排程、通知或網路主流程。
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\schedule-ahead-daily.ps1"

function Stop-Smoke([string]$Reason) {
    Write-Output ("CASE_FAIL name=extract reason=" + $Reason)
    Write-Output '{"ok":false}'
    exit 2
}

if (-not (Test-Path -LiteralPath $prod)) { Stop-Smoke "production script missing" }
$errs = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($prod, [ref]$tokens, [ref]$errs)
if (@($errs).Count -gt 0) {
    Stop-Smoke (@($errs | ForEach-Object { $_.ToString() } | Select-Object -First 3) -join "; ")
}
$functions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true))
$fn = $null
foreach ($candidate in @($functions)) {
    if ($candidate.Name -eq "Get-ScheduledRowSummary") { $fn = $candidate; break }
}
if ($null -eq $fn) { Stop-Smoke "Get-ScheduledRowSummary not found" }
. ([scriptblock]::Create($fn.Extent.Text))
Write-Output ("EXTRACT_OK name=" + $fn.Name)

$failed = $false
$caseCount = 0

function Assert-Summary {
    param(
        [string]$Name,
        $Got,
        [int]$Confirmed,
        [int]$Uncertain,
        [bool]$Details = $true
    )
    $script:caseCount++
    $valid = ($Got.Confirmed -eq $Confirmed) -and ($Got.Uncertain -eq $Uncertain) -and
        ($Got.UncertainRows -is [System.Array]) -and (@($Got.UncertainRows).Count -eq $Uncertain) -and $Details
    $counts = " confirmed=" + $Got.Confirmed + " uncertain=" + $Got.Uncertain + " rows=" + @($Got.UncertainRows).Count
    if ($valid) {
        Write-Output ("CASE_OK name=" + $Name + $counts)
    } else {
        Write-Output ("CASE_FAIL name=" + $Name + $counts + " expect=" + $Confirmed + "/" + $Uncertain + " details=" + $Details)
        $script:failed = $true
    }
}

# R4: Text guards inspect the production body without executing it.
function Assert-Guard {
    param([string]$Name, [bool]$Condition)
    $script:caseCount++
    if ($Condition) {
        Write-Output ("CASE_OK name=" + $Name)
    } else {
        Write-Output ("CASE_FAIL name=" + $Name)
        $script:failed = $true
    }
}

function Assert-Run {
    param([string]$Name, [bool]$Condition, [string]$Details)
    if ($Condition) {
        Write-Output ("CASE_OK name=" + $Name)
    } else {
        Write-Output ("CASE_FAIL name=" + $Name + " details=" + $Details)
        $script:failed = $true
    }
}

function Invoke-IsolatedWrapper {
    param([string]$ScriptPath, [string]$FakeBin, [string]$TracePath, [string]$FailDate)
    $previousPath = $env:PATH
    $previousTrace = [Environment]::GetEnvironmentVariable("SCHEDWRAP_TRACE")
    $previousFailDate = [Environment]::GetEnvironmentVariable("SCHEDWRAP_FAIL_DATE")
    try {
        if (Test-Path -LiteralPath $TracePath) { Remove-Item -LiteralPath $TracePath -Force }
        $env:PATH = $FakeBin + ";" + $previousPath
        $env:SCHEDWRAP_TRACE = $TracePath
        $env:SCHEDWRAP_FAIL_DATE = $FailDate
        $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $ScriptPath 2>&1
        $code = $LASTEXITCODE
        $calls = if (Test-Path -LiteralPath $TracePath) { @(Get-Content -LiteralPath $TracePath -Encoding ASCII) } else { @() }
        return [pscustomobject]@{ ExitCode = $code; Calls = @($calls); Output = (@($output) -join " | ") }
    } finally {
        $env:PATH = $previousPath
        [Environment]::SetEnvironmentVariable("SCHEDWRAP_TRACE", $previousTrace)
        [Environment]::SetEnvironmentVariable("SCHEDWRAP_FAIL_DATE", $previousFailDate)
    }
}

try {
    # R4-1: Two confirmed rows plus one uncertain row, preserving action details.
    $mixedRows = @(
        [pscustomobject]@{ slot = 1; platform = "facebook"; scheduled_post_id = "fb-1" },
        [pscustomobject]@{ slot = 2; platform = "facebook"; scheduled_post_id = "fb-2" },
        [pscustomobject]@{ slot = 3; platform = "facebook"; scheduled_post_id = ""; status = "uncertain"; error = "TLS submit response unconfirmed" }
    )
    $mixed = Get-ScheduledRowSummary $mixedRows
    $mixedRow = @($mixed.UncertainRows) | Select-Object -First 1
    Assert-Summary -Name "mixed" -Got $mixed -Confirmed 2 -Uncertain 1 -Details (
        $mixedRow.slot -eq 3 -and $mixedRow.platform -eq "facebook" -and $mixedRow.error -eq "TLS submit response unconfirmed"
    )

    # R4-2: A single JSON object must work without an array wrapper.
    $singleRow = '{"slot":1,"platform":"facebook","scheduled_post_id":"fb-single"}' | ConvertFrom-Json
    $single = Get-ScheduledRowSummary $singleRow
    Assert-Summary -Name "single-object" -Got $single -Confirmed 1 -Uncertain 0 -Details (-not ($singleRow -is [System.Array]))
    $empty = Get-ScheduledRowSummary $null
    Assert-Summary -Name "null" -Got $empty -Confirmed 0 -Uncertain 0

    # R4-3: Even a nonempty ID must not override an uncertain status.
    $uncertain = Get-ScheduledRowSummary ([pscustomobject]@{
        slot = 2; platform = "facebook"; scheduled_post_id = "fb-untrusted"; status = "uncertain"; error = "check the Page"
    })
    $uncertainRow = @($uncertain.UncertainRows) | Select-Object -First 1
    Assert-Summary -Name "uncertain-with-id" -Got $uncertain -Confirmed 0 -Uncertain 1 -Details (
        $uncertainRow.slot -eq 2 -and $uncertainRow.platform -eq "facebook" -and $uncertainRow.error -eq "check the Page"
    )

    # R2 edges: Empty collections and IDs without a usable value confirm nothing.
    $emptyArray = Get-ScheduledRowSummary @()
    Assert-Summary -Name "empty-array" -Got $emptyArray -Confirmed 0 -Uncertain 0
    $missingIds = Get-ScheduledRowSummary @(
        [pscustomobject]@{ slot = 1; platform = "facebook" },
        [pscustomobject]@{ slot = 2; platform = "facebook"; scheduled_post_id = "" },
        [pscustomobject]@{ slot = 3; platform = "facebook"; scheduled_post_id = " " },
        $null
    )
    Assert-Summary -Name "missing-empty-id" -Got $missingIds -Confirmed 0 -Uncertain 0

    $source = $ast.Extent.Text
    $commandStart = $source.IndexOf('$out = cmd /c "npm.cmd run schedule-ahead')
    $scheduledStart = $source.IndexOf('$scheduledLog = Join-Path', $commandStart)
    $scheduledEnd = $source.IndexOf('# R7: YouTube', $scheduledStart)
    $command = $source.Substring($commandStart, $scheduledStart - $commandStart)
    $scheduled = $source.Substring($scheduledStart, $scheduledEnd - $scheduledStart)
    $final = $source.Substring($source.IndexOf('Pop-Location'))

    Assert-Guard -Name "exit-code-immediate" -Condition (
        $command -match '\$out = cmd /c "npm\.cmd run schedule-ahead -- --date \$date --live 2>&1"\r?\n\s*\$scheduleExitCode = \$LASTEXITCODE'
    )
    Assert-Guard -Name "exit-report-tail" -Condition (
        $command -match 'if \(\$scheduleExitCode -ne 0\) \{\s+Write-Log "SCHEDULE-AHEAD EXIT \$scheduleExitCode \$\{date\}"\s+\$problems \+= "\$date schedule-ahead-exit-\$scheduleExitCode"\s+@\(\$out\) \| Select-Object -Last 5 \| ForEach-Object \{ Write-Log \(\[string\]\$_\) \}\s+\}' -and
        $command -notmatch '(?m)^\s*(continue|break|exit|throw)\b'
    )
    Assert-Guard -Name "queued-confirmed" -Condition (
        $scheduled -match '\$summary = Get-ScheduledRowSummary \$rows\s+\$queued \+= "\{0\}x\{1\}" -f \$date, \$summary\.Confirmed' -and
        $source -notmatch '\$queued\s*\+=\s*[^\r\n]*@\(\$rows\)\.Count'
    )
    Assert-Guard -Name "uncertain-actions" -Condition (
        $scheduled -match 'if \(\$summary\.Uncertain -gt 0\) \{\s+\$problems \+= "\$date uncertain-\$\(\$summary\.Uncertain\)"\s+foreach \(\$row in @\(\$summary\.UncertainRows\)\) \{' -and
        $scheduled.Contains('Write-Log "UNCERTAIN ${date} slot $($row.slot) $($row.platform): $($row.error) -- check the Page; if the post is NOT queued there, delete this row from data\scheduled-log\$date.json and rerun"')
    )
    Assert-Guard -Name "zero-confirmed-note" -Condition (
        $scheduled -match 'if \(\$summary\.Confirmed -eq 0\) \{\s+Write-Log "NOTE \$\{date\}: scheduled-log exists but nothing confirmed"\s+\}'
    )
    Assert-Guard -Name "problems-notification" -Condition (
        $final.Contains('if ($problems.Count) { $summary += " / problems: " + ($problems -join ", ") }') -and
        $final.Contains('Write-Log $summary') -and
        $final.Contains('if ($problems.Count) { Show-Toast $summary }')
    )

    # Run the complete wrapper under a temp root. Only this temp root has an
    # npm.cmd on PATH; no real schedule-ahead command or network is reached.
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $caseRoot = Join-Path $tempParent ("schedwrap-smoke-" + [guid]::NewGuid().ToString("N"))
    $resolvedCaseRoot = [IO.Path]::GetFullPath($caseRoot)
    if (-not $resolvedCaseRoot.StartsWith($tempParent, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedCaseRoot) -like "schedwrap-smoke-*")) {
        throw "Unsafe smoke temp root"
    }
    try {
        $isolatedScripts = Join-Path $caseRoot "scripts"
        $fakeBin = Join-Path $caseRoot "fake-bin"
        foreach ($dir in @($isolatedScripts, $fakeBin, (Join-Path $caseRoot "data\content-calendar"),
                (Join-Path $caseRoot "data\approved-log"), (Join-Path $caseRoot "data\scheduled-log"),
                (Join-Path $caseRoot "output\d3-imggen"))) {
            New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        $isolatedProd = Join-Path $isolatedScripts "schedule-ahead-daily.ps1"
        [IO.File]::Copy($prod, $isolatedProd)
        [IO.File]::WriteAllText((Join-Path $isolatedScripts "_watchdog.ps1"), "", [Text.UTF8Encoding]::new($true))
        $fakeNpm = Join-Path $fakeBin "npm.cmd"
        [IO.File]::WriteAllLines($fakeNpm, @(
            '@echo off',
            '>>"%SCHEDWRAP_TRACE%" echo %*',
            'if "%2"=="schedule-ahead" if "%5"=="%SCHEDWRAP_FAIL_DATE%" exit /b 1',
            'exit /b 0'
        ), [Text.Encoding]::ASCII)
        $taipeiNow = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time"))
        $dates = @(1..3 | ForEach-Object { $taipeiNow.AddDays($_).ToString("yyyy-MM-dd") })
        foreach ($date in $dates) {
            [IO.File]::WriteAllText((Join-Path $caseRoot "data\content-calendar\$date.json"), '{}', [Text.Encoding]::UTF8)
            [IO.File]::WriteAllText((Join-Path $caseRoot "data\approved-log\$date.json"), '{}', [Text.Encoding]::UTF8)
            [IO.File]::WriteAllText((Join-Path $caseRoot "data\scheduled-log\$date.json"), '{"slot":1,"platform":"facebook","scheduled_post_id":"fb-queued"}', [Text.Encoding]::UTF8)
            [IO.File]::WriteAllText((Join-Path $caseRoot "output\d3-imggen\plan-$date.json"), '{"items":[],"blockers":[]}', [Text.Encoding]::UTF8)
        }
        $tracePath = Join-Path $caseRoot "npm-calls.txt"
        $problemRun = Invoke-IsolatedWrapper -ScriptPath $isolatedProd -FakeBin $fakeBin -TracePath $tracePath -FailDate $dates[0]
        Assert-Run -Name "problem-exit-1" -Condition ($problemRun.ExitCode -eq 1) -Details ("exit=" + $problemRun.ExitCode + " output=" + $problemRun.Output)
        $expectedAfterProblem = @(
            "run schedule-youtube -- --date $($dates[0]) --slot 2",
            "run schedule-youtube -- --date $($dates[0]) --slot 3",
            "run schedule-ahead -- --date $($dates[1]) --live",
            "run schedule-youtube -- --date $($dates[1]) --slot 2",
            "run schedule-youtube -- --date $($dates[1]) --slot 3",
            "run schedule-ahead -- --date $($dates[2]) --live",
            "run schedule-youtube -- --date $($dates[2]) --slot 2",
            "run schedule-youtube -- --date $($dates[2]) --slot 3"
        )
        $missingCalls = @($expectedAfterProblem | Where-Object { $problemRun.Calls -notcontains $_ })
        Assert-Run -Name "later-dates-youtube" -Condition ($missingCalls.Count -eq 0) -Details ("missing=" + ($missingCalls -join ", ") + " observed=" + ($problemRun.Calls -join ", "))

        $cleanRun = Invoke-IsolatedWrapper -ScriptPath $isolatedProd -FakeBin $fakeBin -TracePath $tracePath -FailDate ""
        Assert-Run -Name "clean-exit-0" -Condition ($cleanRun.ExitCode -eq 0 -and
            @($cleanRun.Calls | Where-Object { $_ -like "run schedule-ahead*" }).Count -eq 3) -Details (
            "exit=" + $cleanRun.ExitCode + " calls=" + $cleanRun.Calls.Count + " output=" + $cleanRun.Output
        )
    } finally {
        if (Test-Path -LiteralPath $resolvedCaseRoot) { Remove-Item -LiteralPath $resolvedCaseRoot -Recurse -Force }
    }
} catch {
    Write-Output ("CASE_FAIL name=exception reason=" + $_.Exception.Message)
    $failed = $true
}

$result = [pscustomobject]@{
    ok = (-not $failed)
    cases = $caseCount
    mixed_confirmed = $mixed.Confirmed
    mixed_uncertain = $mixed.Uncertain
    mixed_rows = @($mixed.UncertainRows).Count
    single_confirmed = $single.Confirmed
    null_confirmed = $empty.Confirmed
    null_uncertain = $empty.Uncertain
    uncertain_id_confirmed = $uncertain.Confirmed
    uncertain_id_uncertain = $uncertain.Uncertain
}
if ($failed) {
    Write-Output "SMOKE_FAIL"
    Write-Output ($result | ConvertTo-Json -Compress)
    exit 1
}
Write-Output "SMOKE_OK"
Write-Output ($result | ConvertTo-Json -Compress)
exit 0
