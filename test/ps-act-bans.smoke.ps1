# PS-layer smoke for Get-ActBans in scripts/produce-next-reel.ps1.
# Extracts the production function via AST (does not run the script body).
# F33 leftover: after must ban cloth/wiping/scrubbing; middle still works.
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
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-ActBans"
    }, $true)
if (-not $fn) {
    Write-Output "EXTRACT_FAIL=Get-ActBans not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $fn.Name)
$paramNames = @($fn.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Write-Output ("PARAMS=" + ($paramNames -join ","))
if ($paramNames -notcontains "State") {
    Write-Output "PARAM_FAIL=expected State"
    exit 1
}

. ([scriptblock]::Create($fn.Extent.Text))

$failed = $false

function Write-LogLine([string]$Line) {
    [Console]::Out.WriteLine($Line)
}

function Invoke-BanCase {
    param([string]$Name, [string]$State, [string[]]$MustHave, [string[]]$MustNot)
    $got = [string](Get-ActBans $State)
    Write-LogLine ("CASE name=" + $Name + " state=" + $State + " len=" + $got.Length)
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
    return $got
}

$before = Invoke-BanCase -Name "before" -State "before" `
    -MustHave @("Do not clean") `
    -MustNot @("hand-wiping", "Hands stay anatomically correct")
$middle = Invoke-BanCase -Name "middle" -State "middle" `
    -MustHave @("Hands stay anatomically correct") `
    -MustNot @("Do not introduce any cloth, hand-wiping, or scrubbing motion")
$after = Invoke-BanCase -Name "after" -State "after" `
    -MustHave @("Do not introduce any cloth, hand-wiping, or scrubbing motion", "No cleaning-in-progress", "Do not re-soil") `
    -MustNot @("Hands stay anatomically correct", "Do not clean, repair or transform")

if ($after -eq $middle) {
    Write-LogLine "CASE_FAIL name=after same_as_middle"
    $failed = $true
}
if ($after -eq $before) {
    Write-LogLine "CASE_FAIL name=after same_as_before"
    $failed = $true
}

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok               = $true
    params           = ($paramNames -join ",")
    after_len        = [int]$after.Length
    after_bans_wipe  = [bool]($after -match "hand-wiping")
    middle_allows_work = [bool]($middle -match "Hands stay anatomically correct")
    before_forbids_clean = [bool]($before -match "Do not clean")
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
