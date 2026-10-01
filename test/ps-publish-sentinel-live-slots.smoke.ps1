# PS-layer smoke for live-post helpers in scripts/publish-sentinel.ps1.
# Extracts production functions via AST (does not run the script body, so it
# never fires catchup or toasts).
#
# Teeth (F19 / F21 / F22):
#   1. Due windows stay 11:45 -> slot1, 12:15 -> +slot3, 20:45 -> +slot2
#   2. dry_run success does NOT count as posted (would silence the alarm)
#   3. status "posted" counts; failed / null / missing-status do not
#   4. A dry_run-only log still reports the due slot as missing
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\publish-sentinel.ps1"
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

$names = @("Get-DueSlots", "Test-LivePostedEntry", "Get-LivePostedSlots", "Get-MissingDueSlots", "Get-LivePostedPairs", "Get-MissingDuePairs", "Get-UncertainPairs", "Format-PublishPairs")
foreach ($name in $names) {
    $fn = Get-ProdFunction $name
    if (-not $fn) {
        Write-Output "EXTRACT_FAIL=$name not found"
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

if ($failed) {
    Write-Output "SMOKE_FAIL"
    Write-Output '{"ok":false}'
    exit 1
}

Write-Output "SMOKE_OK"
# R5: 最後一行 JSON 保留 F19 欄位，並回報新案例的實際結果。
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
} | ConvertTo-Json -Compress
exit 0
