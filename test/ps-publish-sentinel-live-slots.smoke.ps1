# PS-layer smoke for live-post helpers in scripts/publish-sentinel.ps1.
# Helper cases use AST extraction. Main-flow cases execute the real body in
# isolated Temp roots with stub catchup/npx, fixed time and file-backed toasts.
#
# Teeth (F19 / F21 / F22):
#   1. Due windows stay 11:45 -> slot1, 12:15 -> +slot3, 20:45 -> +slot2
#   2. dry_run success does NOT count as posted (would silence the alarm)
#   3. status "posted" counts; failed / null / missing-status do not
#   4. A dry_run-only log still reports the due slot as missing
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$smokeStopwatch = [Diagnostics.Stopwatch]::StartNew()

function Write-SmokeElapsed {
    $smokeStopwatch.Stop()
    Write-Output ("SMOKE_ELAPSED_MS=" + $smokeStopwatch.ElapsedMilliseconds)
}

# Preserve the failure while reporting timing for unexpected terminating errors.
trap {
    Write-SmokeElapsed
    break
}

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\publish-sentinel.ps1"
. (Join-Path $root "scripts\publish-slot-times.ps1")
if (-not (Test-Path -LiteralPath $prod)) {
    Write-Output "MISSING_PROD=$prod"
    Write-SmokeElapsed
    exit 2
}

$errs = $null
$tokens = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($prod, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
    $head = @($errs | ForEach-Object { $_.ToString() } | Select-Object -First 3) -join "; "
    Write-Output "PARSE_FAIL=$head"
    Write-SmokeElapsed
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

$names = @("Get-DueSlots", "Test-LivePostedEntry", "Get-LivePostedSlots", "Get-MissingDueSlots", "Get-LivePostedPairs", "Get-MissingDuePairs", "Get-UncertainPairs", "Format-PublishPairs", "Test-IgCloudSyncAvailable")
foreach ($name in $names) {
    $fn = Get-ProdFunction $name
    if (-not $fn) {
        Write-Output "EXTRACT_FAIL=$name not found"
        Write-SmokeElapsed
        exit 2
    }
    Write-Output ("EXTRACT_OK name=" + $fn.Name)
    . ([scriptblock]::Create($fn.Extent.Text))
}

$failed = $false

function Slot-Key($Value) {
    $bits = New-Object 'System.Collections.Generic.List[string]'
    if ($null -ne $Value) {
        foreach ($item in @($Value)) {
            if ($null -eq $item) { continue }
            if ($item -is [System.Array]) {
                foreach ($inner in @($item)) {
                    if ($null -eq $inner -or "$inner" -eq "") { continue }
                    [void]$bits.Add(([int]$inner).ToString())
                }
            } else {
                $s = [string]$item
                if ($s -eq "" -or $s -eq "System.Object[]") { continue }
                [void]$bits.Add(([int]$item).ToString())
            }
        }
    }
    return [string]($bits -join ",")
}

function Assert-Slots {
    param([string]$Name, $Got, [string]$Expect)
    $gotKey = Slot-Key $Got
    if ($gotKey -ne $Expect) {
        Write-Output ("CASE_FAIL name=" + $Name + " got=" + $gotKey + " expect=" + $Expect)
        $script:failed = $true
    } else {
        Write-Output ("CASE_OK name=" + $Name + " got=" + $gotKey)
    }
}

# R5: 逐平台字串必須完整比對，不能只比 slot。
function Assert-Pairs {
    param([string]$Name, $Got, [string]$Expect)
    $gotKey = @($Got) -join ","
    if ($gotKey -cne $Expect) {
        Write-Output ("CASE_FAIL name=" + $Name + " got=" + $gotKey + " expect=" + $Expect)
        $script:failed = $true
    } else {
        Write-Output ("CASE_OK name=" + $Name + " got=" + $gotKey)
    }
}

function Assert-Bool {
    param([string]$Name, $Got, [bool]$Expect)
    $value = [bool]$Got
    if ($value -ne $Expect) {
        Write-Output ("CASE_FAIL name=" + $Name + " got=" + $value + " expect=" + $Expect)
        $script:failed = $true
    } else {
        Write-Output ("CASE_OK name=" + $Name + " got=" + $value)
    }
}

Assert-Slots -Name "due-before" -Got (Get-DueSlots "11:44") -Expect ""
Assert-Slots -Name "due-1145" -Got (Get-DueSlots "11:45") -Expect "1"
Assert-Slots -Name "due-1214" -Got (Get-DueSlots "12:14") -Expect "1"
Assert-Slots -Name "due-1215" -Got (Get-DueSlots "12:15") -Expect "1,3"
Assert-Slots -Name "due-2044" -Got (Get-DueSlots "20:44") -Expect "1,3"
Assert-Slots -Name "due-2045" -Got (Get-DueSlots "20:45") -Expect "1,3,2"
Assert-Slots -Name "due-2300" -Got (Get-DueSlots "23:00") -Expect "1,3,2"
$defaultTimes = @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
$afternoonTimes = @{ 1 = [TimeSpan]"14:12"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
Assert-Slots -Name "due-calendar-only-1-2" -Got (Get-DueSlots "12:20" $defaultTimes ([int[]]@(1, 2))) -Expect "1"
Assert-Slots -Name "due-calendar-slot3" -Got (Get-DueSlots "12:20" $defaultTimes ([int[]]@(3))) -Expect "3"
$missingSlot1Calendar = @(Get-EffectivePublishSlots -CalendarSlots ([int[]]@(2)))
Assert-Slots -Name "due-missing-slot1-still-included" -Got (Get-DueSlots -Time "12:20" -SlotTimes $defaultTimes -CalendarSlots $missingSlot1Calendar) -Expect "1"
Assert-Slots -Name "missing-required-slot1-detected" -Got (Get-MissingRequiredCalendarSlots -CalendarSlots ([int[]]@(2))) -Expect "1"
Assert-Slots -Name "due-empty-calendar" -Got (Get-DueSlots "12:20" $defaultTimes ([int[]]@())) -Expect ""
Assert-Slots -Name "afternoon-not-yet-due" -Got (Get-DueSlots "11:50" $afternoonTimes ([int[]]@(1))) -Expect ""
Assert-Slots -Name "afternoon-due" -Got (Get-DueSlots "14:30" $afternoonTimes ([int[]]@(1))) -Expect "1"

Assert-Bool -Name "live-success" -Got (Test-LivePostedEntry ([pscustomobject]@{ status = "success"; slot = 1; dry_run = $false })) -Expect $true
Assert-Bool -Name "live-posted-alias" -Got (Test-LivePostedEntry ([pscustomobject]@{ status = "posted"; slot = 2 })) -Expect $true
Assert-Bool -Name "live-dry-run-success" -Got (Test-LivePostedEntry ([pscustomobject]@{ status = "success"; slot = 1; dry_run = $true })) -Expect $false
Assert-Bool -Name "live-failed" -Got (Test-LivePostedEntry ([pscustomobject]@{ status = "failed"; slot = 1 })) -Expect $false
Assert-Bool -Name "live-null" -Got (Test-LivePostedEntry $null) -Expect $false
Assert-Bool -Name "live-missing-status" -Got (Test-LivePostedEntry ([pscustomobject]@{ slot = 1 })) -Expect $false

$dryOnly = @(
    [pscustomobject]@{ status = "success"; slot = 1; dry_run = $true; platform = "instagram" },
    [pscustomobject]@{ status = "success"; slot = 1; dry_run = $true; platform = "facebook" }
)
$drySlots = Get-LivePostedSlots $dryOnly
Assert-Slots -Name "slots-dry-only" -Got $drySlots -Expect ""

$mixed = @(
    [pscustomobject]@{ status = "success"; slot = 1; dry_run = $true; platform = "instagram" },
    [pscustomobject]@{ status = "success"; slot = 1; dry_run = $false; platform = "instagram" },
    [pscustomobject]@{ status = "posted"; slot = 3; dry_run = $false; platform = "facebook" },
    [pscustomobject]@{ status = "failed"; slot = 2; dry_run = $false; platform = "instagram" }
)
$mixedSlots = Get-LivePostedSlots $mixed
Assert-Slots -Name "slots-mixed" -Got $mixedSlots -Expect "1,3"

$single = [pscustomobject]@{ status = "success"; slot = 2; dry_run = $false }
Assert-Slots -Name "slots-single-object" -Got (Get-LivePostedSlots $single) -Expect "2"

$dueNoon = Get-DueSlots "12:20"
$missingDry = Get-MissingDueSlots $dueNoon $drySlots
Assert-Slots -Name "missing-dry-run-silences-not" -Got $missingDry -Expect "1,3"

$missingLive = Get-MissingDueSlots $dueNoon @(1, 3)
Assert-Slots -Name "missing-none-when-live" -Got $missingLive -Expect ""

$missingPartial = Get-MissingDueSlots $dueNoon @(1)
Assert-Slots -Name "missing-slot3" -Got $missingPartial -Expect "3"

# R5 / R1: FB 成功不能代表 IG 已發布；dry_run 不算 live（保留 F19）。
$platformEntries = @(
    [pscustomobject]@{ slot = 1; platform = "facebook"; status = "success"; dry_run = $false },
    [pscustomobject]@{ slot = 1; platform = "instagram"; status = "failed"; dry_run = $false },
    [pscustomobject]@{ slot = 3; platform = "instagram"; status = "success"; dry_run = $true }
)
$livePairs = @(Get-LivePostedPairs $platformEntries)
Assert-Pairs -Name "pairs-platform-isolation" -Got $livePairs -Expect "1:facebook"

$normalizedEntries = @(
    [pscustomobject]@{ slot = 3; platform = "FACEBOOK"; status = "posted" },
    [pscustomobject]@{ slot = 1; platform = "INSTAGRAM"; status = "success" },
    [pscustomobject]@{ slot = 1; platform = "instagram"; status = "success" },
    [pscustomobject]@{ slot = 2; status = "success" },
    [pscustomobject]@{ slot = 2; platform = " "; status = "success" }
)
$normalizedPairs = @(Get-LivePostedPairs $normalizedEntries)
Assert-Pairs -Name "pairs-normalized-dedup" -Got $normalizedPairs -Expect "1:instagram,3:facebook"
$dryPairs = @(Get-LivePostedPairs $dryOnly)
Assert-Pairs -Name "pairs-dry-only" -Got $dryPairs -Expect ""
$emptyPairs = @(Get-LivePostedPairs @())
Assert-Pairs -Name "pairs-empty" -Got $emptyPairs -Expect ""

# R5 / R2: 必須按平台列出缺口，且空 live 配對不能截斷後續陣列。
$missingPairs = @(Get-MissingDuePairs @(1, 3) @("1:facebook"))
Assert-Pairs -Name "missing-per-platform" -Got $missingPairs -Expect "1:instagram,3:facebook,3:instagram"
$missingDryPairs = @(Get-MissingDuePairs $dueNoon $dryPairs)
Assert-Pairs -Name "missing-pairs-dry-run-silences-not" -Got $missingDryPairs -Expect "1:facebook,1:instagram,3:facebook,3:instagram"
$noMissingPairs = @(Get-MissingDuePairs @(1) @("1:facebook", "1:instagram"))
Assert-Pairs -Name "missing-pairs-none-when-live" -Got $noMissingPairs -Expect ""

# R5 / R3: uncertain 要提示人工確認，但 dry_run uncertain 不算。
$uncertainEntries = @(
    [pscustomobject]@{ slot = 1; platform = "instagram"; status = "uncertain"; dry_run = $false },
    [pscustomobject]@{ slot = 3; platform = "instagram"; status = "uncertain"; dry_run = $true },
    [pscustomobject]@{ slot = 2; platform = "facebook"; status = "failed" },
    [pscustomobject]@{ slot = 2; platform = "instagram"; status = "success" }
)
$uncertainPairs = @(Get-UncertainPairs $uncertainEntries)
Assert-Pairs -Name "uncertain-live-only" -Got $uncertainPairs -Expect "1:instagram"
$uncertainNormalizedEntries = @(
    [pscustomobject]@{ slot = 3; platform = "INSTAGRAM"; status = "uncertain" },
    [pscustomobject]@{ slot = 1; platform = "FACEBOOK"; status = "uncertain" },
    [pscustomobject]@{ slot = 1; platform = "facebook"; status = "uncertain" },
    [pscustomobject]@{ slot = 2; status = "uncertain" },
    [pscustomobject]@{ slot = 2; platform = " "; status = "uncertain" }
)
$uncertainNormalizedPairs = @(Get-UncertainPairs $uncertainNormalizedEntries)
Assert-Pairs -Name "uncertain-normalized-dedup" -Got $uncertainNormalizedPairs -Expect "1:facebook,3:instagram"
$noUncertainPairs = @(Get-UncertainPairs @())
Assert-Pairs -Name "uncertain-empty" -Got $noUncertainPairs -Expect ""

# R5 / R4: 通知必須讓店主看得出是哪個平台。
$pairNotice = Format-PublishPairs @("1:instagram", "3:facebook")
Assert-Pairs -Name "notice-platform-labels" -Got $pairNotice -Expect "slot 1 的 IG、slot 3 的 FB"

# SENTINEL-R2: A branch without ig-cloud must skip sync; installing it enables sync.
$syncRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("publish-sentinel-ig-cloud-" + [guid]::NewGuid().ToString("N"))
$syncSourceDir = Join-Path $syncRoot "src"
$syncScript = Join-Path $syncSourceDir "igCloud.ts"
try {
    [void][System.IO.Directory]::CreateDirectory($syncRoot)
    $syncWithoutFile = Test-IgCloudSyncAvailable $syncRoot
    Assert-Bool -Name "ig-cloud-sync-missing-script" -Got $syncWithoutFile -Expect $false

    [void][System.IO.Directory]::CreateDirectory($syncSourceDir)
    [System.IO.File]::WriteAllText($syncScript, "// smoke fixture")
    $syncWithFile = Test-IgCloudSyncAvailable $syncRoot
    Assert-Bool -Name "ig-cloud-sync-present-script" -Got $syncWithFile -Expect $true
} finally {
    foreach ($path in @($syncScript, $syncSourceDir, $syncRoot)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
}

# SENTINEL-R3: Run the production body without replacing its call lines.
$mainRoot = Join-Path ([IO.Path]::GetTempPath()) ("publish-sentinel-main-" + [guid]::NewGuid().ToString("N"))
$probeDate = "2026-10-05"
$utf8Bom = [Text.UTF8Encoding]::new($true)
$utf8NoBom = [Text.UTF8Encoding]::new($false)
$savedEnv = @{}
foreach ($key in @("PATH", "npm_config_offline", "PUBLISH_SENTINEL_DATE", "PUBLISH_SENTINEL_TIME", "PUBLISH_SENTINEL_TOAST_FILE")) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
}

function Write-ProbeFile([string]$Path, [string]$Text, [bool]$Bom = $false) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Path))
    $encoding = if ($Bom) { $utf8Bom } else { $utf8NoBom }
    [IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Read-ProbeFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    # PS 5.1's *>> can mix UTF-16LE with Write-Log's UTF-8. Preserve log text.
    return ([Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($Path)) -replace "`0", "" -replace ([string][char]0xFEFF), "")
}

$catchupStub = @'
$ErrorActionPreference = "Stop"
$fixtureRoot = Split-Path -Parent $PSScriptRoot
& npx.cmd tsx src/postCurrentSlot.ts --all-due --date $env:PUBLISH_SENTINEL_DATE
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$after = Join-Path $fixtureRoot "probe\catchup-posted.json"
if (Test-Path -LiteralPath $after) {
    Copy-Item -LiteralPath $after -Destination (Join-Path $fixtureRoot "data\posted-log\$env:PUBLISH_SENTINEL_DATE.json") -Force
}
exit 0
'@
$npxStub = @'
@echo off
echo NPX_CALLED %*>> "%~dp0..\probe\npx-called.txt"
if "%~2"=="src/postCurrentSlot.ts" echo CATCHUP_CALLED>> "%~dp0..\probe\catchup-called.txt"
if "%~2"=="src/igCloud.ts" if exist "%~dp0..\probe\sync-posted.json" copy /Y "%~dp0..\probe\sync-posted.json" "%~dp0..\data\posted-log\%PUBLISH_SENTINEL_DATE%.json" >nul
exit /b 0
'@

function Invoke-MainCase {
    param(
        [string]$Name, [string]$Posted, [string]$Scheduled = "",
        [bool]$CloudMarker = $false, [string]$AfterCatchup = "", [string]$AfterSync = "",
        [string]$Calendar = "", [string]$PublishTimes = "", [string]$Time = "11:50"
    )
    $caseRoot = Join-Path $mainRoot $Name
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot "output"))
    [void][IO.Directory]::CreateDirectory((Join-Path $caseRoot "probe"))
    Write-ProbeFile (Join-Path $caseRoot "data\posted-log\$probeDate.json") $Posted
    if ($Calendar) { Write-ProbeFile (Join-Path $caseRoot "data\content-calendar\$probeDate.json") $Calendar }
    if ($PublishTimes) { Write-ProbeFile (Join-Path $caseRoot "data\publish-times\$probeDate.json") $PublishTimes }
    Write-ProbeFile (Join-Path $caseRoot "scripts\catchup-publish.ps1") $catchupStub $true
    Write-ProbeFile (Join-Path $caseRoot "bin\npx.cmd") $npxStub
    $scheduledPath = Join-Path $caseRoot "data\scheduled-log\$probeDate.json"
    if ($Scheduled) { Write-ProbeFile $scheduledPath $Scheduled }
    if ($CloudMarker) {
        Write-ProbeFile (Join-Path $caseRoot "data\ig-cloud\queue\$probeDate-slot1.json") '{}'
    }
    if ($AfterCatchup) { Write-ProbeFile (Join-Path $caseRoot "probe\catchup-posted.json") $AfterCatchup }
    if ($AfterSync) {
        Write-ProbeFile (Join-Path $caseRoot "src\igCloud.ts") '// fixture; npx is stubbed'
        Write-ProbeFile (Join-Path $caseRoot "probe\sync-posted.json") $AfterSync
    }
    $toastPath = Join-Path $caseRoot "output\toasts.log"
    $env:PUBLISH_SENTINEL_DATE = $probeDate
    $env:PUBLISH_SENTINEL_TIME = $Time
    $env:PUBLISH_SENTINEL_TOAST_FILE = $toastPath
    $env:npm_config_offline = "true"
    $env:PATH = (Join-Path $caseRoot "bin") + ";" + $savedEnv["PATH"]
    $resolvedNpx = (Get-Command npx.cmd -ErrorAction Stop).Source
    if ($resolvedNpx -ne (Join-Path $caseRoot "bin\npx.cmd")) { throw "npx.cmd resolved to '$resolvedNpx', expected '$caseRoot\bin\npx.cmd'" }

    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $prod -RootPath $caseRoot 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $npxCalls = Read-ProbeFile (Join-Path $caseRoot "probe\npx-called.txt")
    $catchupCalls = Read-ProbeFile (Join-Path $caseRoot "probe\catchup-called.txt")
    $scheduledUnchanged = if ($Scheduled) {
        (Test-Path -LiteralPath $scheduledPath) -and (Read-ProbeFile $scheduledPath) -ceq $Scheduled
    } else {
        -not (Test-Path -LiteralPath $scheduledPath)
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Toasts = Read-ProbeFile $toastPath
        Log = Read-ProbeFile (Join-Path $caseRoot "output\publish-sentinel.log")
        CatchupCalls = [regex]::Matches($catchupCalls, "CATCHUP_CALLED").Count
        NpxCalls = [regex]::Matches($npxCalls, "NPX_CALLED").Count
        ScheduledUnchanged = $scheduledUnchanged
    }
}

$fbLive = '{"slot":1,"platform":"facebook","status":"success","dry_run":false}'
$igLive = '{"slot":1,"platform":"instagram","status":"success","dry_run":false}'
$fbUnknown = '{"slot":1,"platform":"facebook","status":"uncertain","dry_run":false}'
$igUnknown = '{"slot":1,"platform":"instagram","status":"uncertain","dry_run":false,"error":"commit point: response lost"}'
$igCloudUnknown = '{"slot":1,"platform":"instagram","status":"uncertain","dry_run":false,"error":"cloud: publish outcome uncertain"}'
$scheduledUnknown = '[{"slot":1,"platform":"facebook","status":"uncertain","scheduled_post_id":"schedule-id"}]'
$scheduledEmptyId = '[{"slot":1,"platform":"facebook","scheduled_post_id":""}]'
$localAdvice = "data\posted-log\$probeDate.json 裡那一列刪掉再跑補發"
$scheduleAdvice = "data\scheduled-log\$probeDate.json 裡這格 facebook 那一列，以及 data\posted-log\$probeDate.json 裡這格 facebook 那一列都刪掉，再跑補發"
$cloudAdvice = "不要刪本機 data\posted-log\$probeDate.json 那一列；去雲端 repo 的 results/$probeDate-slot1.json 看結果，確認雲端沒發，就照 PR 132 README 把開關切 off 讓電腦收回，或等下一輪自動收回"
try {
    $localIg = Invoke-MainCase -Name "local-ig" -Posted "[$fbLive,$igUnknown]"
    Assert-Bool -Name "main-uncertain-toast" -Got ($localIg.Toasts.Contains("發布結果不明:slot 1 的 IG")) -Expect $true
    Assert-Bool -Name "main-local-commit-point-advice" -Got ($localIg.Toasts.Contains($localAdvice) -and -not $localIg.Toasts.Contains("雲端 repo")) -Expect $true
    Assert-Pairs -Name "main-uncertain-no-catchup" -Got $localIg.CatchupCalls -Expect "0"

    $stillMissing = Invoke-MainCase -Name "ig-still-missing" -Posted "[$fbLive]"
    Assert-Bool -Name "main-ig-still-missing-no-success" -Got ($stillMissing.Toasts.Contains("補發成功")) -Expect $false
    Assert-Bool -Name "main-ig-still-missing-log" -Got ($stillMissing.Log.Contains("STILL MISSING after catchup: 1:instagram") -and $stillMissing.Toasts.Contains("slot 1 的 IG 仍未發布")) -Expect $true

    $fbRecovered = Invoke-MainCase -Name "fb-missing" -Posted "[$igLive]" -AfterCatchup "[$fbLive,$igLive]"
    Assert-Pairs -Name "main-fb-missing-catchup-called" -Got "catchup_calls=$($fbRecovered.CatchupCalls);npx_calls=$($fbRecovered.NpxCalls)" -Expect "catchup_calls=1;npx_calls=1"
    Assert-Bool -Name "main-fb-recovered-readback" -Got ($fbRecovered.Toasts.Contains("補發成功") -and -not $fbRecovered.Log.Contains("STILL MISSING")) -Expect $true

    $scheduled = Invoke-MainCase -Name "scheduled-uncertain" -Posted "[$fbUnknown,$igLive]" -Scheduled $scheduledUnknown
    Assert-Bool -Name "main-scheduled-uncertain-advice" -Got ($scheduled.Toasts.Contains($scheduleAdvice) -and -not $scheduled.Toasts.Contains($localAdvice)) -Expect $true
    $emptyId = Invoke-MainCase -Name "scheduled-empty-id" -Posted "[$fbUnknown,$igLive]" -Scheduled $scheduledEmptyId
    Assert-Bool -Name "main-scheduled-empty-id-advice" -Got ($emptyId.Toasts.Contains($scheduleAdvice)) -Expect $true

    $noSchedule = Invoke-MainCase -Name "scheduled-missing" -Posted "[$fbUnknown,$igLive]"
    Assert-Bool -Name "main-scheduled-missing-fallback" -Got ($noSchedule.Toasts.Contains($localAdvice) -and -not $noSchedule.Toasts.Contains($scheduleAdvice)) -Expect $true
    $badSchedule = Invoke-MainCase -Name "scheduled-unreadable" -Posted "[$fbUnknown,$igLive]" -Scheduled '{bad json'
    Assert-Bool -Name "main-scheduled-unreadable-fallback" -Got ($badSchedule.Toasts.Contains($localAdvice) -and -not $badSchedule.Toasts.Contains($scheduleAdvice)) -Expect $true
    $unrelatedSchedule = Invoke-MainCase -Name "scheduled-other-pairs" -Posted "[$fbUnknown,$igLive]" -Scheduled '[{"slot":3,"platform":"facebook","status":"uncertain","scheduled_post_id":""},{"slot":1,"platform":"instagram","status":"uncertain","scheduled_post_id":""}]'
    Assert-Bool -Name "main-scheduled-other-pairs-fallback" -Got ($unrelatedSchedule.Toasts.Contains($localAdvice) -and -not $unrelatedSchedule.Toasts.Contains($scheduleAdvice)) -Expect $true
    $confirmedSchedule = Invoke-MainCase -Name "scheduled-confirmed" -Posted "[$fbUnknown,$igLive]" -Scheduled '[{"slot":1,"platform":"facebook","scheduled_post_id":"confirmed-id"}]'
    Assert-Bool -Name "main-scheduled-confirmed-fallback" -Got ($confirmedSchedule.Toasts.Contains($localAdvice) -and -not $confirmedSchedule.Toasts.Contains($scheduleAdvice)) -Expect $true

    $cloudMarker = Invoke-MainCase -Name "cloud-marker" -Posted "[$fbLive,$igUnknown]" -CloudMarker $true
    Assert-Bool -Name "main-cloud-marker-advice" -Got ($cloudMarker.Toasts.Contains($cloudAdvice) -and -not $cloudMarker.Toasts.Contains($localAdvice)) -Expect $true
    Assert-Pairs -Name "main-cloud-uncertain-no-catchup" -Got $cloudMarker.CatchupCalls -Expect "0"
    $cloudError = Invoke-MainCase -Name "cloud-error" -Posted "[$fbLive,$igCloudUnknown]"
    Assert-Bool -Name "main-cloud-error-advice" -Got ($cloudError.Toasts.Contains($cloudAdvice) -and -not $cloudError.Toasts.Contains($localAdvice)) -Expect $true
    $otherCloudError = Invoke-MainCase -Name "cloud-other-pair" -Posted "[$fbLive,$igUnknown,{`"slot`":3,`"platform`":`"instagram`",`"status`":`"uncertain`",`"error`":`"cloud: other slot`"}]"
    Assert-Bool -Name "main-cloud-error-scoped-to-pair" -Got ($otherCloudError.Toasts.Contains("slot 1 的 IG 是本機送出後未確認：把 $localAdvice") -and $otherCloudError.Toasts.Contains("results/$probeDate-slot3.json")) -Expect $true

    # S07 regression: the catchup stub reintroduces an uncertain FB row.
    $scheduledAfter = Invoke-MainCase -Name "scheduled-after-catchup" -Posted "[$igLive]" -Scheduled $scheduledUnknown -AfterCatchup "[$fbUnknown,$igLive]"
    Assert-Bool -Name "main-scheduled-after-catchup-advice" -Got ($scheduledAfter.Toasts.Contains($scheduleAdvice) -and -not $scheduledAfter.Toasts.Contains("補發成功") -and $scheduledAfter.CatchupCalls -eq 1) -Expect $true
    $cloudAfter = Invoke-MainCase -Name "cloud-after-catchup" -Posted "[$fbLive]" -AfterCatchup "[$fbLive,$igCloudUnknown]"
    Assert-Bool -Name "main-cloud-after-catchup-advice" -Got ($cloudAfter.Toasts.Contains($cloudAdvice) -and -not $cloudAfter.Toasts.Contains("補發成功")) -Expect $true
    $cloudSync = Invoke-MainCase -Name "cloud-after-sync" -Posted "[$fbLive]" -CloudMarker $true -AfterSync "[$fbLive,$igCloudUnknown]"
    Assert-Bool -Name "main-cloud-after-sync-advice" -Got ($cloudSync.Toasts.Contains($cloudAdvice) -and $cloudSync.NpxCalls -eq 1 -and $cloudSync.CatchupCalls -eq 0) -Expect $true

    $twoSlotCalendar = Invoke-MainCase -Name "calendar-slots-1-2" -Posted "[$fbLive,$igLive]" -Calendar '{"date":"2026-10-06","slots":[{"slot":1},{"slot":2}]}' -Time "12:20"
    Assert-Bool -Name "main-calendar-1-2-no-slot3-gap" -Got ($twoSlotCalendar.CatchupCalls -eq 0 -and -not $twoSlotCalendar.Log.Contains("MISSING") -and [string]::IsNullOrWhiteSpace($twoSlotCalendar.Toasts)) -Expect $true
    $slot3Calendar = Invoke-MainCase -Name "calendar-slot3" -Posted "[]" -Calendar '{"date":"2026-10-06","slots":[{"slot":3}]}' -Time "12:20"
    Assert-Bool -Name "main-calendar-slot3-still-due" -Got ($slot3Calendar.Log.Contains("MISSING pairs: 3:facebook,3:instagram")) -Expect $true
    $missingSlot1Main = Invoke-MainCase -Name "calendar-missing-slot1" -Posted "[]" -Calendar '{"date":"2026-10-06","slots":[{"slot":2}]}' -Time "12:20"
    Assert-Bool -Name "main-missing-slot1-still-due-and-hard-fails" -Got ($missingSlot1Main.ExitCode -eq 1 -and $missingSlot1Main.Log.Contains("MISSING pairs: 1:facebook,1:instagram") -and $missingSlot1Main.Toasts.Contains("缺少必備 slot 1") -and $missingSlot1Main.CatchupCalls -eq 0) -Expect $true
    $badCalendar = Invoke-MainCase -Name "calendar-unreadable" -Posted "[$fbLive,$igLive]" -Calendar '{bad json'
    Assert-Bool -Name "main-calendar-unreadable-fallback" -Got ($badCalendar.Log.Contains("行事曆讀不到、用預設到期格") -and $badCalendar.CatchupCalls -eq 0) -Expect $true
    $assignedTime = [ordered]@{ date = $probeDate; experiment = "afternoon-vs-usual-2026-10"; assigned_at = "2026-10-03T13:40:12.345Z"; slots = @([ordered]@{ slot = 1; time = "14:12"; arm = "afternoon" }) } | ConvertTo-Json -Depth 5 -Compress
    $notDueAfternoon = Invoke-MainCase -Name "assigned-1412-before" -Posted "[]" -Calendar '{"date":"2026-10-06","slots":[{"slot":1},{"slot":2}]}' -PublishTimes $assignedTime -Time "11:50"
    Assert-Bool -Name "main-assigned-1412-not-due-at-1150" -Got ($notDueAfternoon.CatchupCalls -eq 0 -and -not $notDueAfternoon.Log.Contains("MISSING")) -Expect $true
    $dueAfternoon = Invoke-MainCase -Name "assigned-1412-after" -Posted "[]" -Calendar '{"date":"2026-10-06","slots":[{"slot":1},{"slot":2}]}' -PublishTimes $assignedTime -Time "14:30"
    Assert-Bool -Name "main-assigned-1412-due-at-1430" -Got ($dueAfternoon.CatchupCalls -eq 1 -and $dueAfternoon.Log.Contains("MISSING pairs: 1:facebook,1:instagram")) -Expect $true

    $scheduleResults = @($localIg, $stillMissing, $fbRecovered, $scheduled, $emptyId, $noSchedule, $badSchedule, $unrelatedSchedule, $confirmedSchedule, $cloudMarker, $cloudError, $otherCloudError, $scheduledAfter, $cloudAfter, $cloudSync, $twoSlotCalendar, $slot3Calendar, $missingSlot1Main, $badCalendar, $notDueAfternoon, $dueAfternoon)
    Assert-Bool -Name "main-scheduled-log-read-only" -Got (@($scheduleResults | Where-Object { -not $_.ScheduledUnchanged }).Count -eq 0) -Expect $true
} finally {
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], "Process") }
    # Remove only this run's resolved Temp directory.
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedMainRoot = [IO.Path]::GetFullPath($mainRoot)
    if (-not $resolvedMainRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected Temp fixture path" }
    if (Test-Path -LiteralPath $resolvedMainRoot) { Remove-Item -LiteralPath $resolvedMainRoot -Recurse -Force }
}

if ($failed) {
    Write-Output "SMOKE_FAIL"
    Write-Output '{"ok":false}'
    Write-SmokeElapsed
    exit 1
}

Write-Output "SMOKE_OK"
# R5: JSON 保留 F19 欄位，並回報新案例的實際結果。
[ordered]@{
    ok = $true
    dry_run_counts = $false
    posted_alias = $true
    due_1145 = "1"
    due_1215 = "1,3"
    due_2045 = "1,3,2"
    missing_dry_noon = "1,3"
    live_pairs = ($livePairs -join ",")
    normalized_pairs = ($normalizedPairs -join ",")
    dry_pairs = ($dryPairs -join ",")
    empty_pairs = ($emptyPairs -join ",")
    missing_pairs = ($missingPairs -join ",")
    missing_dry_pairs = ($missingDryPairs -join ",")
    no_missing_pairs = ($noMissingPairs -join ",")
    uncertain_pairs = ($uncertainPairs -join ",")
    uncertain_normalized_pairs = ($uncertainNormalizedPairs -join ",")
    no_uncertain_pairs = ($noUncertainPairs -join ",")
    pair_notice = $pairNotice
    ig_cloud_sync_missing = $syncWithoutFile
    ig_cloud_sync_present = $syncWithFile
} | ConvertTo-Json -Compress
Write-SmokeElapsed
exit 0
