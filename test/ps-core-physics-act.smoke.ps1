# PS-layer smoke for Get-CorePhysics in scripts/produce-next-reel.ps1.
# Extracts the production function via AST (does not run the script body).
# F33: after must be settled/still; middle/before keep working physics.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\produce-next-reel.ps1"
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

$fn = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-CorePhysics"
    }, $true)
if (-not $fn) {
    Write-Output "EXTRACT_FAIL=Get-CorePhysics not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $fn.Name)
$paramNames = @($fn.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Write-Output ("PARAMS=" + ($paramNames -join ","))
if ($paramNames -notcontains "ObjectType" -or $paramNames -notcontains "Act") {
    Write-Output "PARAM_FAIL=expected ObjectType,Act"
    exit 1
}

. ([scriptblock]::Create($fn.Extent.Text))

$failed = $false
$results = @{}
$processNeedles = @(
    "wets darker then lightens",
    "A cloth works the underarm yellow patch",
    "A cloth follows the inner collar band",
    "A cloth compresses the handle leather",
    "Brush tips bend"
)

function Write-LogLine([string]$Line) {
    [Console]::Out.WriteLine($Line)
}

function Invoke-Case {
    param([string]$Name, [string]$ObjectType, [string]$Act, [string[]]$MustHave, [string[]]$MustNot)
    $got = [string](Get-CorePhysics $ObjectType $Act)
    $script:results[$Name] = $got
    Write-LogLine ("CASE name=" + $Name + " act=" + $Act + " len=" + $got.Length)
    foreach ($needle in @($MustHave)) {
        if ($got -notmatch [regex]::Escape($needle)) {
            Write-LogLine ("CASE_FAIL name=" + $Name + " missing=" + $needle)
            $script:failed = $true
        }
    }
    foreach ($needle in @($MustNot)) {
        if ($got -match [regex]::Escape($needle)) {
            Write-LogLine ("CASE_FAIL name=" + $Name + " forbidden=" + $needle)
            $script:failed = $true
        }
    }
}

Invoke-Case -Name "sweater-middle" -ObjectType "sweater" -Act "middle" `
    -MustHave @("A cloth works the underarm yellow patch", "wets darker then lightens") `
    -MustNot @("settled and still")
Invoke-Case -Name "sweater-after" -ObjectType "sweater" -Act "after" `
    -MustHave @("settled and still", "No wiping, scrubbing, wetting-then-lightening") `
    -MustNot $processNeedles
Invoke-Case -Name "shirt-after" -ObjectType "shirt" -Act "after" `
    -MustHave @("settled and still") `
    -MustNot @("A cloth follows the inner collar band", "wets darker then lightens")
Invoke-Case -Name "shirt-middle" -ObjectType "shirt" -Act "middle" `
    -MustHave @("A cloth follows the inner collar band") `
    -MustNot @("settled and still")
Invoke-Case -Name "sweater-before" -ObjectType "sweater" -Act "before" `
    -MustHave @("A cloth works the underarm yellow patch") `
    -MustNot @("settled and still")

$sweaterMiddle = [string]$results["sweater-middle"]
$sweaterAfter = [string]$results["sweater-after"]
$shirtAfter = [string]$results["shirt-after"]
$shirtMiddle = [string]$results["shirt-middle"]
$beforeKeeps = [string]$results["sweater-before"]

if ($sweaterAfter -eq $sweaterMiddle) {
    Write-LogLine "CASE_FAIL name=sweater-after same_as_middle"
    $failed = $true
}
if ($shirtAfter -eq $shirtMiddle) {
    Write-LogLine "CASE_FAIL name=shirt-after same_as_middle"
    $failed = $true
}

$objectTypes = @(
    "white-shoe", "handbag", "leather-shoe", "plush-doll", "duvet", "leather-bag",
    "shirt", "suit", "curtain", "luggage", "backpack", "canvas-shoe", "down-jacket",
    "wool-coat", "suede-shoe", "high-heel", "leather-belt", "mattress-pad", "blanket",
    "denim", "wallet", "kids-shoe", "hiking-boot", "sweater"
)
$allAfterSettled = $true
foreach ($ot in $objectTypes) {
    $afterText = Get-CorePhysics $ot "after"
    $middleText = Get-CorePhysics $ot "middle"
    if ($afterText -notmatch "settled and still") {
        Write-LogLine ("CASE_FAIL name=after-settled object=" + $ot)
        $failed = $true
        $allAfterSettled = $false
    }
    if ($afterText -eq $middleText) {
        Write-LogLine ("CASE_FAIL name=after-equals-middle object=" + $ot)
        $failed = $true
        $allAfterSettled = $false
    }
}

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                  = $true
    params              = ($paramNames -join ",")
    sweater_after_len   = [int]$sweaterAfter.Length
    sweater_same        = [bool]($sweaterAfter -eq $sweaterMiddle)
    all_after_settled   = [bool]$allAfterSettled
    before_keeps_work   = [bool]($beforeKeeps -match "A cloth works the underarm yellow patch")
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
