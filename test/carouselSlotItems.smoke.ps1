# Executes Get-CarouselSlotItems from scripts/generate-missing-images.ps1 on
# this machine's PowerShell 5.1. ERROR-BOOK F20 fish-1: @($group) over a
# generic List of PSCustomObject throws "Argument types do not match".
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root "scripts\generate-missing-images.ps1"

$tokens = $null
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($srcPath, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) {
    Write-Output '{"ok":false,"error":"parse"}'
    exit 1
}
$fn = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-CarouselSlotItems"
}, $true)
if (-not $fn) {
    Write-Output '{"ok":false,"error":"missing_function"}'
    exit 1
}
Invoke-Expression $fn.Extent.Text

$items = @(
    [pscustomobject]@{ slot = 1; target_path = "docs/assets/x/s1-01.png"; topic = "coat" },
    [pscustomobject]@{ slot = 1; target_path = "docs/assets/x/s1-02.png"; topic = "coat" },
    [pscustomobject]@{ slot = 1; target_path = "docs/assets/x/s1-03.png"; topic = "coat" },
    [pscustomobject]@{ slot = 2; target_path = "docs/assets/x/s2-01.png"; topic = "bag" }
)

try {
    $slot1 = Get-CarouselSlotItems $items 1
    $slot2 = Get-CarouselSlotItems $items 2
    $slot3 = Get-CarouselSlotItems $items 3
} catch {
    Write-Output '{"ok":false,"error":"function_threw"}'
    exit 1
}

$slot1Count = @($slot1).Count
$slot2Count = @($slot2).Count
$slot3Count = @($slot3).Count
$slot1Unique = (@($slot1 | ForEach-Object { [int]$_.slot } | Select-Object -Unique) -join ",")
$slot2IsArray = [bool]($slot2 -ne $null -and $slot2.GetType().IsArray)

if ($slot1Count -ne 3 -or $slot1Unique -ne "1" -or $slot2Count -ne 1 -or $slot3Count -ne 0 -or -not $slot2IsArray) {
    Write-Output ("{`"ok`":false,`"error`":`"unexpected_shape`",`"slot1_count`":$slot1Count,`"slot2_count`":$slot2Count,`"slot3_count`":$slot3Count,`"slot2_is_array`":$slot2IsArray}")
    exit 1
}

Write-Output '{"ok":true,"slot1_count":3,"slot2_count":1,"slot3_count":0,"slot2_is_array":true}'
exit 0
