# PS-layer smoke for Get-CarouselSlotItems in scripts/generate-missing-images.ps1.
# Extracts the production function via AST (does not run the script body) and
# calls it with the same JSON-shaped objects the 06:30 path feeds it.
#
# CI hardening (2026-08-25): GitHub windows-latest may not reproduce the PS 5.1
# `@($genericListOfPSCustomObject)` throw. Teeth that must work on every host:
#   1. AST return line is ToArray plus unary comma, not @($group)
#   2. A one-item slot comes back as a real array (unary comma), not a scalar
# The wrap-throw is recorded, not required. A host without the bug still
# proves the production wrap; a host with the bug extra-proves why it exists.
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
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-CarouselSlotItems"
    }, $true)
if (-not $fn) {
    Write-Output "EXTRACT_FAIL=Get-CarouselSlotItems not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $fn.Name)
$returnLine = @($fn.Extent.Text -split "`r?`n" | Where-Object { $_ -match "^\s*return\s" } | Select-Object -First 1)
if ($returnLine) {
    Write-Output ("RETURN_LINE=" + $returnLine.Trim())
}

$wrapOk = $false
if ($returnLine -and $returnLine -match 'return\s+,\(\s*\$group\.ToArray\(\)\s*\)' -and $returnLine -notmatch 'return\s+@\(\s*\$group\s*\)') {
    $wrapOk = $true
}

. ([scriptblock]::Create($fn.Extent.Text))

function New-JsonShapedItems {
    param([int[]]$Slots)
    $arr = @()
    $i = 0
    foreach ($slot in @($Slots)) {
        $i++
        $arr += [pscustomobject]@{
            slot        = $slot
            target_path = "img$i.png"
            topic       = "t"
        }
    }
    return , $arr
}

function Invoke-BadListWrap {
    param($Items, [int]$Slot)
    $group = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($Items)) {
        if ([int]$item.slot -eq $Slot) { [void]$group.Add($item) }
    }
    return @($group)
}

function Measure-Returned {
    param($Got)
    $isArray = $Got -is [System.Array]
    $n = 0
    if ($null -eq $Got) { $n = 0 }
    elseif ($isArray) { $n = $Got.Length }
    elseif ($Got -is [System.Collections.ICollection]) { $n = $Got.Count }
    else { $n = 1 }
    return @{ Count = [int]$n; IsArray = [bool]$isArray }
}

$three = New-JsonShapedItems -Slots @(1, 1, 1)
$hostHasListWrapBug = $false
try {
    $null = Invoke-BadListWrap -Items $three -Slot 1
    Write-Output "HOST_LIST_WRAP_BUG=false"
} catch {
    $hostHasListWrapBug = $true
    Write-Output "HOST_LIST_WRAP_BUG=true"
    Write-Output ("BADWRAP_THROW_TYPE=" + $_.Exception.GetType().FullName)
}

$counts = @{}
$arrays = @{}
$prodFailed = $false
function Invoke-ProdCase {
    param([string]$Name, $Items, [int]$Slot, [int]$Expect, [bool]$ExpectArray)
    try {
        $got = Get-CarouselSlotItems $Items $Slot
        $m = Measure-Returned $got
        $script:counts[$Name] = $m.Count
        $script:arrays[$Name] = $m.IsArray
        if ($m.Count -ne $Expect) {
            Write-Output ("PROD_FAIL name=" + $Name + " count=" + $m.Count + " expect=" + $Expect)
            $script:prodFailed = $true
            return
        }
        if ($ExpectArray -and -not $m.IsArray) {
            Write-Output ("PROD_FAIL name=" + $Name + " not_array count=" + $m.Count)
            $script:prodFailed = $true
            return
        }
        Write-Output ("PROD_OK name=" + $Name + " count=" + $m.Count + " is_array=" + $m.IsArray)
    } catch {
        Write-Output ("PROD_THROW name=" + $Name + " " + $_.Exception.Message)
        $script:prodFailed = $true
    }
}

Invoke-ProdCase -Name "three" -Items $three -Slot 1 -Expect 3 -ExpectArray $true
Invoke-ProdCase -Name "one" -Items (New-JsonShapedItems -Slots @(3)) -Slot 3 -Expect 1 -ExpectArray $true
Invoke-ProdCase -Name "zero" -Items (New-JsonShapedItems -Slots @(2)) -Slot 1 -Expect 0 -ExpectArray $true

if ($wrapOk) {
    Write-Output "WRAP_OK=TOARRAY_COMMA"
} else {
    Write-Output ("WRAP_FAIL=" + $(if ($returnLine) { $returnLine.Trim() } else { "no return line" }))
    $prodFailed = $true
}

if ($prodFailed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                  = $true
    wrap                = "toarray_comma"
    host_list_wrap_bug  = $hostHasListWrapBug
    slot1_count         = [int]$counts["three"]
    slot1_is_array      = [bool]$arrays["three"]
    slot2_count         = [int]$counts["one"]
    slot2_is_array      = [bool]$arrays["one"]
    slot3_count         = [int]$counts["zero"]
    slot3_is_array      = [bool]$arrays["zero"]
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
