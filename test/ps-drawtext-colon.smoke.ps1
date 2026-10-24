# PS-layer smoke for Get-DrawText in scripts/assemble-reel.ps1.
# Extracts the production function via AST (does not run the script body, so it
# never calls ffmpeg or needs clips).
#
# F12: `"fontsize=$hookSize:fontcolor=white"` was parsed as a scope variable,
# expanded empty, and ffmpeg received `fontsize==white`. The production wrap
# is `$($size)` / `$($Y)`.
#
# Teeth:
#   1. AST return line uses $($size) and $($Y), not $size:fontcolor / $Y:enable
#   2. Invoking Get-DrawText with a short hook yields fontsize=N:fontcolor (N>0)
#   3. A 15-char line shrinks below the 52px cap (720px overflow at fontsize 52)
#   4. A colon in the text is escaped as \:
#   5. y=N:enable is present (same colon-trap shape as fontsize)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\assemble-reel.ps1"
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
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Get-DrawText"
    }, $true)
if (-not $fn) {
    Write-Output "EXTRACT_FAIL=Get-DrawText not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $fn.Name)
$paramNames = @($fn.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Write-Output ("PARAMS=" + ($paramNames -join ","))

$returnLine = @($fn.Extent.Text -split "`r?`n" | Where-Object { $_ -match "^\s*return\s" } | Select-Object -First 1)
if ($returnLine) {
    Write-Output ("RETURN_LINE=" + $returnLine.Trim())
}

$wrapOk = $false
if (
    $returnLine -and
    $returnLine -match 'fontsize=\$\(\$size\):fontcolor' -and
    $returnLine -notmatch 'fontsize=\$size:fontcolor' -and
    $returnLine -match 'y=\$\(\$Y\):enable' -and
    $returnLine -notmatch 'y=\$Y:enable'
) {
    $wrapOk = $true
}
if ($wrapOk) {
    Write-Output "WRAP_OK=SUBEXPRESSION_COLON"
} else {
    Write-Output "WRAP_FAIL=expected fontsize=`$(`$size):fontcolor and y=`$(`$Y):enable"
}

. ([scriptblock]::Create($fn.Extent.Text))

# Script-scope values the production function reads. Keep in lockstep with
# assemble-reel.ps1; the TS wrapper also pins $MaxTextWidth = 648.
$MaxTextWidth = 648
$FontFile = "C\:/Windows/Fonts/msjhbd.ttc"

$failed = $false

function Write-LogLine([string]$Line) {
    [Console]::Out.WriteLine($Line)
}

function Invoke-Draw {
    param([string]$Name, [string]$Text, [double]$From, [double]$To, [int]$Y)
    $got = [string](Get-DrawText -Text $Text -From $From -To $To -Y $Y)
    Write-LogLine ("CASE name=" + $Name + " len=" + $got.Length)
    return $got
}

$short = Invoke-Draw -Name "short-hook" -Text "HOOK" -From 0 -To 2.6 -Y 200
if ($short -notmatch 'fontsize=52:fontcolor') {
    Write-LogLine "CASE_FAIL name=short-hook missing=fontsize=52:fontcolor"
    $failed = $true
}
if ($short -match 'fontsize==') {
    Write-LogLine "CASE_FAIL name=short-hook empty-fontsize-colon-trap"
    $failed = $true
}
if ($short -notmatch 'y=200:enable') {
    Write-LogLine "CASE_FAIL name=short-hook missing=y=200:enable"
    $failed = $true
}
if ($short -match 'y==enable') {
    Write-LogLine "CASE_FAIL name=short-hook empty-y-colon-trap"
    $failed = $true
}
if ($short -notmatch "text='HOOK'") {
    Write-LogLine "CASE_FAIL name=short-hook missing=text=HOOK"
    $failed = $true
}

$longText = "123456789012345"
$long = Invoke-Draw -Name "long-line" -Text $longText -From 0 -To 2.6 -Y 200
if ($long -notmatch 'fontsize=43:fontcolor') {
    Write-LogLine "CASE_FAIL name=long-line missing=fontsize=43:fontcolor"
    $failed = $true
}

$colon = Invoke-Draw -Name "colon-escape" -Text "AB:CD" -From 6.4 -To 9.6 -Y 200
if ($colon -notmatch "text='AB\\:CD'") {
    Write-LogLine "CASE_FAIL name=colon-escape missing=escaped-colon"
    $failed = $true
}
if ($colon -match "text='AB:CD'") {
    Write-LogLine "CASE_FAIL name=colon-escape raw-colon-in-text"
    $failed = $true
}

$emptyFontsize = [bool]($short -match 'fontsize==')
$yEnable = [bool]($short -match 'y=200:enable')
$colonEscaped = [bool]($colon -match "text='AB\\:CD'")

if ($failed -or -not $wrapOk) {
    Write-Output "SMOKE_FAIL"
    Write-Output (@{
            ok             = $false
            wrap           = $(if ($wrapOk) { "subexpression_colon" } else { "fail" })
            fontsize_short = $null
            fontsize_long  = $null
            colon_escaped  = $colonEscaped
            y_enable       = $yEnable
            empty_fontsize = $emptyFontsize
        } | ConvertTo-Json -Compress)
    exit 1
}

Write-Output "SMOKE_OK"
Write-Output (@{
        ok             = $true
        wrap           = "subexpression_colon"
        fontsize_short = 52
        fontsize_long  = 43
        colon_escaped  = $true
        y_enable       = $true
        empty_fontsize = $false
    } | ConvertTo-Json -Compress)
exit 0
