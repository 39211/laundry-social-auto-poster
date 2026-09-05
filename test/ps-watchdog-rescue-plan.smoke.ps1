# PS-layer smoke for F32 scheduled-task rescue in scripts/watchdog-patrol.ps1.
# Extracts the production functions via AST (does not run the script body) and
# invokes them with mocked Get/Enable/Start so the live scheduler is untouched.
#
# Teeth:
#   1. Disabled -> EnableFirst, Enable then Start, enable line in the log
#   2. Ready -> Start only, Enable not called
#   3. Missing task -> Start anyway
#   4. Start throw is logged, not swallowed into silence
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\watchdog-patrol.ps1"
if (-not (Test-Path -LiteralPath $prod)) {
    Write-Output "MISSING_PROD=$prod"
    exit 2
}

$errs = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($prod, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
    $head = @($errs | ForEach-Object { $_.ToString() } | Select-Object -First 3) -join "; "
    Write-Output "PARSE_FAIL=$head"
    exit 2
}

function Get-ProdFunction([string]$Name) {
    $matches = $ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        }, $true)
    foreach ($fn in @($matches)) {
        if ($fn.Name -eq $Name) { return $fn }
    }
    return $null
}

$planFn = Get-ProdFunction "Get-ScheduledTaskRescuePlan"
$invokeFn = Get-ProdFunction "Invoke-ScheduledTaskRescue"
if (-not $planFn) {
    Write-Output "EXTRACT_FAIL=Get-ScheduledTaskRescuePlan not found"
    exit 2
}
if (-not $invokeFn) {
    Write-Output "EXTRACT_FAIL=Invoke-ScheduledTaskRescue not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $planFn.Name)
Write-Output ("EXTRACT_OK name=" + $invokeFn.Name)

. ([scriptblock]::Create($planFn.Extent.Text))
. ([scriptblock]::Create($invokeFn.Extent.Text))

$failed = $false
$now = [datetime]"2026-08-22T11:44:00"

function New-LogPath {
    $p = Join-Path $env:TEMP ("watchdog-rescue-smoke-" + [guid]::NewGuid().ToString("n") + ".log")
    New-Item -ItemType File -Path $p -Force | Out-Null
    return $p
}

function Read-Log([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    return [IO.File]::ReadAllText($Path, [Text.UTF8Encoding]::new($false))
}

# --- pure planner ---
$disabledPlan = Get-ScheduledTaskRescuePlan -TaskName "Laundry-CatchUp-Publish" -Task ([pscustomobject]@{ State = "Disabled" })
$readyPlan = Get-ScheduledTaskRescuePlan -TaskName "Laundry-CatchUp-Publish" -Task ([pscustomobject]@{ State = "Ready" })
$missingPlan = Get-ScheduledTaskRescuePlan -TaskName "Laundry-CatchUp-Publish" -Task $null

if ($disabledPlan.EnableFirst -ne $true -or $disabledPlan.Reason -ne "disabled" -or $disabledPlan.Start -ne $true) {
    Write-Output ("PLAN_FAIL name=disabled enable=" + $disabledPlan.EnableFirst + " reason=" + $disabledPlan.Reason)
    $failed = $true
} else {
    Write-Output "PLAN_OK name=disabled enable=True start=True reason=disabled"
}

if ($readyPlan.EnableFirst -ne $false -or $readyPlan.Reason -ne "ready" -or $readyPlan.Start -ne $true) {
    Write-Output ("PLAN_FAIL name=ready enable=" + $readyPlan.EnableFirst + " reason=" + $readyPlan.Reason)
    $failed = $true
} else {
    Write-Output "PLAN_OK name=ready enable=False start=True reason=ready"
}

if ($missingPlan.EnableFirst -ne $false -or $missingPlan.Reason -ne "missing" -or $missingPlan.Start -ne $true) {
    Write-Output ("PLAN_FAIL name=missing enable=" + $missingPlan.EnableFirst + " reason=" + $missingPlan.Reason)
    $failed = $true
} else {
    Write-Output "PLAN_OK name=missing enable=False start=True reason=missing"
}

# Mock scriptblocks must use $script: vars: PS scriptblocks are dynamically
# scoped, so a closure over a local $Task would bind to Invoke-ScheduledTaskRescue's
# own $task instead.
$script:calls = @()
$script:mockTask = $null
$script:startShouldThrow = $false

$getMock = {
    param($n)
    $script:calls += "get:$n"
    return $script:mockTask
}
$enableMock = {
    param($n)
    $script:calls += "enable:$n"
}
$startMock = {
    param($n)
    $script:calls += "start:$n"
    if ($script:startShouldThrow) {
        throw "The task is disabled."
    }
}

function Invoke-MockedRescue {
    param(
        [string]$Name,
        $Task,
        [bool]$ThrowOnStart = $false,
        [string[]]$ExpectLog,
        [string[]]$ForbidLog
    )
    $log = New-LogPath
    $script:calls = @()
    $script:mockTask = $Task
    $script:startShouldThrow = $ThrowOnStart
    $plan = Invoke-ScheduledTaskRescue -TaskName "Laundry-CatchUp-Publish" -LogFile $log -Now $now `
        -GetTask $getMock -EnableTask $enableMock -StartTask $startMock
    $text = Read-Log $log
    $joined = $script:calls -join ","
    Write-Output ("INVOKE name=" + $Name + " enableFirst=" + $plan.EnableFirst + " reason=" + $plan.Reason + " calls=" + $joined)
    foreach ($needle in @($ExpectLog)) {
        if ($text -notmatch [regex]::Escape($needle)) {
            Write-Output ("INVOKE_FAIL name=" + $Name + " missing_log=" + $needle)
            $script:failed = $true
        }
    }
    foreach ($needle in @($ForbidLog)) {
        if ($needle -and $text -match [regex]::Escape($needle)) {
            Write-Output ("INVOKE_FAIL name=" + $Name + " forbidden_log=" + $needle)
            $script:failed = $true
        }
    }
    Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
    return @{ Plan = $plan; Calls = @($script:calls); Log = $text }
}

$disabledRun = Invoke-MockedRescue -Name "disabled" `
    -Task ([pscustomobject]@{ State = "Disabled" }) `
    -ExpectLog @("Laundry-CatchUp-Publish is Disabled during an open window; re-enabling.") `
    -ForbidLog @("Start-ScheduledTask Laundry-CatchUp-Publish failed")

$disabledCalls = $disabledRun.Calls -join ","
if ($disabledCalls -ne "get:Laundry-CatchUp-Publish,enable:Laundry-CatchUp-Publish,start:Laundry-CatchUp-Publish") {
    Write-Output ("INVOKE_FAIL name=disabled order=" + $disabledCalls)
    $failed = $true
} else {
    Write-Output "INVOKE_OK name=disabled order=get,enable,start"
}

$readyRun = Invoke-MockedRescue -Name "ready" `
    -Task ([pscustomobject]@{ State = "Ready" }) `
    -ExpectLog @() `
    -ForbidLog @("re-enabling", "failed")
$readyCalls = $readyRun.Calls -join ","
if ($readyCalls -ne "get:Laundry-CatchUp-Publish,start:Laundry-CatchUp-Publish") {
    Write-Output ("INVOKE_FAIL name=ready order=" + $readyCalls)
    $failed = $true
} else {
    Write-Output "INVOKE_OK name=ready order=get,start"
}

$missingRun = Invoke-MockedRescue -Name "missing" `
    -Task $null `
    -ExpectLog @() `
    -ForbidLog @("re-enabling")
$missingCalls = $missingRun.Calls -join ","
if ($missingCalls -ne "get:Laundry-CatchUp-Publish,start:Laundry-CatchUp-Publish") {
    Write-Output ("INVOKE_FAIL name=missing order=" + $missingCalls)
    $failed = $true
} else {
    Write-Output "INVOKE_OK name=missing start_without_enable"
}

$failRun = Invoke-MockedRescue -Name "start-fail" `
    -Task ([pscustomobject]@{ State = "Disabled" }) `
    -ThrowOnStart $true `
    -ExpectLog @("re-enabling", "Start-ScheduledTask Laundry-CatchUp-Publish failed: The task is disabled.") `
    -ForbidLog @()
if ($failRun.Log -notmatch "Start-ScheduledTask Laundry-CatchUp-Publish failed") {
    Write-Output "INVOKE_FAIL name=start-fail no_failure_log"
    $failed = $true
} else {
    Write-Output "INVOKE_OK name=start-fail logged"
}

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                = $true
    disabled_enable   = [bool]$disabledPlan.EnableFirst
    ready_enable      = [bool]$readyPlan.EnableFirst
    missing_enable    = [bool]$missingPlan.EnableFirst
    disabled_order    = [string]($disabledRun.Calls -join ",")
    start_fail_logged = [bool]($failRun.Log -match "Start-ScheduledTask Laundry-CatchUp-Publish failed")
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
