# 執行生產腳本裡的「一輪」分支，不呼叫真的 npm、Codex、排程或發布。
# round-body.ps1 必須是真實腳本檔，抽出的函式才看得到這個目錄的 $PSScriptRoot。
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function global:cmd {
    param(
        [Parameter(Position = 0)][string]$Mode,
        [Parameter(Position = 1)][string]$Command
    )
    if ($Mode -ne '/c') { throw "unexpected cmd mode: $Mode" }
    $utf8 = [Text.UTF8Encoding]::new($false)
    [IO.File]::AppendAllText($env:NPM_CALL_LOG, ($Command + "`n"), $utf8)
    if ($Command -match 'generate-public-site') {
        [IO.File]::AppendAllText($env:DOCS_WRITE_LOG, "docs`n", $utf8)
        if ($env:SITE_EXIT) {
            $global:LASTEXITCODE = [int]$env:SITE_EXIT
            Write-Output 'generate-public-site failed'
            return
        }
    }
    if ($Command -match 'list-missing') {
        $global:LASTEXITCODE = 0
        Write-Output ("Every image for " + $env:ROUND_DATE + " was already present.")
        return
    }
    $global:LASTEXITCODE = 0
    Write-Output 'ok'
}

$root = Split-Path -Parent $PSScriptRoot
if ($env:ROUND_KIND -eq 'direct-site-fail') {
    $logFile = Join-Path $root 'round.log'
    & (Join-Path $PSScriptRoot 'generate-missing-images.ps1') -Date $env:ROUND_DATE -LogFile $logFile
    exit $LASTEXITCODE
}

$daily = Join-Path $PSScriptRoot 'daily-generate.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($daily, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors -and @($parseErrors).Count -gt 0) {
    throw ("parse errors: " + @($parseErrors).Count)
}
$statements = @($ast.EndBlock.Statements)
$functions = @($statements | Where-Object { $_ -is [System.Management.Automation.Language.FunctionDefinitionAst] })
$imagesOnly = @($statements | Where-Object {
    $_ -is [System.Management.Automation.Language.IfStatementAst] -and
    $_.Clauses[0].Item1.Extent.Text -eq '$hasCalendar' -and
    $_.Extent.Text -match 'generating images only'
})
$imagesReady = @($statements | Where-Object {
    $_ -is [System.Management.Automation.Language.IfStatementAst] -and
    $_.Clauses[0].Item1.Extent.Text -eq '$hasCalendar -and $imagesReady'
})
if ($functions.Count -lt 1 -or $imagesOnly.Count -ne 1 -or $imagesReady.Count -ne 1) {
    throw ("extract functions=" + $functions.Count + " only=" + $imagesOnly.Count + " ready=" + $imagesReady.Count)
}

function Get-StatementBodyText($block) {
    $text = $block.Extent.Text.Trim()
    if ($text.StartsWith('{') -and $text.EndsWith('}')) {
        return $text.Substring(1, $text.Length - 2)
    }
    throw 'statement block is missing braces'
}

if ($env:ROUND_KIND -eq 'images-only') {
    $body = Get-StatementBodyText $imagesOnly[0].Clauses[0].Item2
} elseif ($env:ROUND_KIND -eq 'images-ready') {
    $body = Get-StatementBodyText $imagesReady[0].Clauses[0].Item2
} else {
    throw ("unknown round: " + $env:ROUND_KIND)
}

$fnText = ($functions | ForEach-Object { $_.Extent.Text }) -join "`r`n`r`n"
$script = @"
`$ErrorActionPreference = 'Continue'
$fnText

`$root = Split-Path -Parent `$PSScriptRoot
`$date = `$env:ROUND_DATE
`$now = Get-Date
`$logFile = Join-Path `$root 'round.log'

$body
"@
$roundBody = Join-Path $PSScriptRoot 'round-body.ps1'
[IO.File]::WriteAllText($roundBody, $script, [Text.UTF8Encoding]::new($true))
& $roundBody
exit $LASTEXITCODE
