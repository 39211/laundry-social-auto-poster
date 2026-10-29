# ASCII-only entry point for Windows PowerShell 5.1 / Pester 3.4.
[CmdletBinding()]
param([string[]]$Tag)
$ErrorActionPreference = 'Stop'
Import-Module Pester -MinimumVersion 3.4 -ErrorAction Stop
$pesterArgs = @{ Script = (Join-Path $PSScriptRoot 'tests/Recovery.Tests.ps1'); PassThru = $true }
if ($Tag) { $pesterArgs.Tag = $Tag }
$result = Invoke-Pester @pesterArgs
Write-Output ('A5_TEST_RESULT total={0} passed={1} failed={2}' -f $result.TotalCount, $result.PassedCount, $result.FailedCount)
if ($result.FailedCount -gt 0 -or $result.TotalCount -eq 0) { exit 1 }
exit 0
