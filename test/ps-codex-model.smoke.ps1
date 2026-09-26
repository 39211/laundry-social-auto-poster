# PS-layer smoke for Get-LaundryCodexModel.
# Extracts each production function via AST (does not run the script body)
# and calls it for the three model cases.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot

function Get-ProdFunctionText {
    param([string]$RelativePath)
    $prod = Join-Path $root $RelativePath
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
    $all = @($ast.FindAll({
                param($node)
                $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-LaundryCodexModel"
            }, $true))
    if ($all.Count -ne 1) {
        Write-Output ("EXTRACT_FAIL=" + $RelativePath + " count=" + $all.Count)
        exit 2
    }
    Write-Host ("EXTRACT_OK script=" + $RelativePath)
    return $all[0].Extent.Text
}

function Measure-CodexModelCases {
    Remove-Item Env:\LAUNDRY_CODEX_MODEL -ErrorAction SilentlyContinue
    $unset = [string](Get-LaundryCodexModel)
    $env:LAUNDRY_CODEX_MODEL = "gpt-6-sol"
    $named = [string](Get-LaundryCodexModel)
    $env:LAUNDRY_CODEX_MODEL = "   "
    $blank = [string](Get-LaundryCodexModel)
    Remove-Item Env:\LAUNDRY_CODEX_MODEL -ErrorAction SilentlyContinue
    return @{ unset = $unset; named = $named; blank = $blank }
}

function Format-JsonString([string]$Value) {
    if ($null -eq $Value) { $Value = "" }
    return '"' + ($Value.Replace('\', '\\').Replace('"', '\"')) + '"'
}

function Format-CaseJson($Cases) {
    return '{"unset":' + (Format-JsonString $Cases.unset) + ',"gpt-6-sol":' + (Format-JsonString $Cases.named) + ',"blank":' + (Format-JsonString $Cases.blank) + '}'
}

$generateText = Get-ProdFunctionText "scripts\generate-missing-images.ps1"
. ([scriptblock]::Create($generateText))
$generateCases = Measure-CodexModelCases

$dailyText = Get-ProdFunctionText "scripts\daily-generate.ps1"
. ([scriptblock]::Create($dailyText))
$dailyCases = Measure-CodexModelCases

$json = '{"generate-missing-images.ps1":' + (Format-CaseJson $generateCases) + ',"daily-generate.ps1":' + (Format-CaseJson $dailyCases) + '}'
Write-Output $json
