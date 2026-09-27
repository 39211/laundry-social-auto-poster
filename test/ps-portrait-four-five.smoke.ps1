# PS-layer smoke for Get-PortraitFourFiveVerdict in scripts/generate-missing-images.ps1.
# Extracts the production function via AST (does not run the script body) and
# invokes the ratio gate with known pixel sizes. ffprobe is not required.
#
# Teeth:
#   1. 1080x1350 is exact 4:5 and must pass
#   2. 1080x1440 is 3:4 (the 2026-09-10 coin-flip miss) and must fail
#   3. 0.01 tolerance: 1080x1334 inside, 1080x1333 outside
#   4. Non-positive size returns null, not a fake Ok
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\generate-missing-images.ps1"
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
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-PortraitFourFiveVerdict"
    }, $true)
if (-not $fn) {
    Write-Output "EXTRACT_FAIL=Get-PortraitFourFiveVerdict not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $fn.Name)
$body = $fn.Extent.Text
if ($body -match '\$aspect\s*=\s*4\.0\s*/\s*5\.0' -and $body -match '-le\s+0\.01') {
    Write-Output "PIN_OK=ASPECT_4_5_TOL_0_01"
} else {
    Write-Output "PIN_FAIL=missing 4.0/5.0 or 0.01 tolerance"
    exit 1
}

. ([scriptblock]::Create($body))

$failed = $false
function Invoke-Case {
    param([string]$Name, [double]$Width, [double]$Height, [object]$ExpectOk)
    try {
        $got = Get-PortraitFourFiveVerdict $Width $Height
        if ($null -eq $ExpectOk) {
            if ($null -ne $got) {
                Write-Output ("CASE_FAIL name=" + $Name + " expected_null got_ok=" + $got.Ok)
                $script:failed = $true
                return
            }
            Write-Output ("CASE_OK name=" + $Name + " null=True")
            return
        }
        if ($null -eq $got) {
            Write-Output ("CASE_FAIL name=" + $Name + " got_null expect_ok=" + $ExpectOk)
            $script:failed = $true
            return
        }
        if ([bool]$got.Ok -ne [bool]$ExpectOk) {
            Write-Output ("CASE_FAIL name=" + $Name + " ok=" + $got.Ok + " expect=" + $ExpectOk + " size=" + $got.Width + "x" + $got.Height)
            $script:failed = $true
            return
        }
        if ([int]$got.Width -ne [int]$Width -or [int]$got.Height -ne [int]$Height) {
            Write-Output ("CASE_FAIL name=" + $Name + " size=" + $got.Width + "x" + $got.Height)
            $script:failed = $true
            return
        }
        Write-Output ("CASE_OK name=" + $Name + " ok=" + $got.Ok)
    } catch {
        Write-Output ("CASE_THROW name=" + $Name + " " + $_.Exception.Message)
        $script:failed = $true
    }
}

# Exact 4:5 used by IG carousel portraits.
Invoke-Case -Name "portrait-1080x1350" -Width 1080 -Height 1350 -ExpectOk $true
# The documented coin-flip miss: 3:4 must stay outside ±0.01 of 4:5.
Invoke-Case -Name "three-four-1080x1440" -Width 1080 -Height 1440 -ExpectOk $false
# Landscape of the same pixels is not a portrait 4:5.
Invoke-Case -Name "landscape-1350x1080" -Width 1350 -Height 1080 -ExpectOk $false
# Tolerance band for width=1080: |w/h-0.8|<=0.01 => h in ~1333.33..1367.09
Invoke-Case -Name "just-inside-1080x1334" -Width 1080 -Height 1334 -ExpectOk $true
Invoke-Case -Name "just-outside-1080x1333" -Width 1080 -Height 1333 -ExpectOk $false
Invoke-Case -Name "zero-width" -Width 0 -Height 1350 -ExpectOk $null
Invoke-Case -Name "zero-height" -Width 1080 -Height 0 -ExpectOk $null

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                     = $true
    portrait_1080_1350     = $true
    three_four_1080_1440   = $false
    landscape_1350_1080    = $false
    just_inside_1080_1334  = $true
    just_outside_1080_1333 = $false
    zero_null              = $true
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
