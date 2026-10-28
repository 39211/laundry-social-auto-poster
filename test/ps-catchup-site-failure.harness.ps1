$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

function global:cmd {
    param([string]$Mode, [string]$Command)
    if ($Mode -ne '/c' -or $Command -notmatch '^npm\.cmd run (day-lock|heal-reel-slot|generate-public-site|publish-pages|post-current-slot|first-comment|share-story)\b') {
        throw "Unexpected command: $Mode $Command"
    }
    [IO.File]::AppendAllText($env:CATCHUP_COMMAND_LOG, ($Command + "`n"), [Text.UTF8Encoding]::new($false))
    $global:LASTEXITCODE = 0
    if ($Command -match "^npm\.cmd run $($env:CATCHUP_FAIL_STEP)\b") {
        $global:LASTEXITCODE = [int]$env:CATCHUP_FAIL_EXIT
    }
    Write-Output 'stubbed npm'
}

function global:curl.exe {
    if ($args[-1] -ne 'https://sixiangjialaundry.com/assets/2026-10-28/slot-01.png') { throw 'Unexpected curl target' }
    $global:LASTEXITCODE = 0
    Write-Output '404'
}

& (Join-Path $PSScriptRoot 'catchup-publish.ps1')
exit $LASTEXITCODE
