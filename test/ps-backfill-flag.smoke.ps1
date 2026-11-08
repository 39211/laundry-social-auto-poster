# Execute only the parsed production npm-launch function with a fake command.
param([string]$Source = '')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $repo 'scripts\backfill-publish.ps1' }
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Production PowerShell parse failed.' }
$functions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-BackfillNpm'
}, $true))
if ($functions.Count -ne 1) { throw 'Expected one production npm-launch function.' }
$root = Join-Path $repo ('output\operations\ops-l1-10b-flag-' + [guid]::NewGuid().ToString('n'))
[void][IO.Directory]::CreateDirectory($root)
$utf8 = [Text.UTF8Encoding]::new($false)
$NpmTimeoutSec = 15
$NpmCommand = Join-Path $root 'fake-npm.ps1'
[IO.File]::WriteAllText($NpmCommand, @'
[IO.File]::WriteAllText((Join-Path (Get-Location).Path 'argv.json'), (ConvertTo-Json -InputObject @($args)), [Text.UTF8Encoding]::new($false))
exit 0
'@, $utf8)
function Write-Log([string]$Message) { }
# The scheduler/queue body is deliberately never loaded or executed.
. ([scriptblock]::Create($functions[0].Extent.Text))
$code = Invoke-BackfillNpm ([pscustomobject]@{ date = '2026-10-28'; slot = 1 })
if ($code -ne 0) { throw ('Fake npm exited ' + $code) }
$received = Get-Content -LiteralPath (Join-Path $root 'argv.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$expected = @('run', 'post-current-slot', '--', '--date', '2026-10-28', '--slot', '1', '--live', '--backfill')
if (($received -join '|') -cne ($expected -join '|')) { throw 'BACKFILL_FLAG_MISSING_OR_WRONG_ARGUMENTS' }
Write-Output 'CASE_OK BACKFILL_FLAG_REACHED_FAKE_NPM'
