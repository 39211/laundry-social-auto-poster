# Offline full-entrypoint smoke. Only registry/process inventory/HTTP are faked.
param([string]$Launcher = (Join-Path (Split-Path -Parent $PSScriptRoot) 'line-bot\run_line_bot.ps1'))
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path $root ('output\operations\envguard-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$original = [IO.File]::ReadAllText($Launcher)
$script:passed = 0
function Assert([bool]$Condition, [string]$Label) {
    if (-not $Condition) { throw ('ASSERT_FAIL ' + $Label) }
    $script:passed++
}
function Replace-Function([string]$Source, [string]$Name, [string]$Replacement) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($Source, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'PARSE_FAIL' }
    $nodes = @($ast.FindAll({ param($n)
        $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $Name
    }, $true))
    if ($nodes.Count -ne 1) { throw ('BOUNDARY_MISSING ' + $Name) }
    return $Source.Remove($nodes[0].Extent.StartOffset, $nodes[0].Extent.EndOffset - $nodes[0].Extent.StartOffset).Insert($nodes[0].Extent.StartOffset, $Replacement)
}
$source = Replace-Function $original 'Get-BotUserValue' @'
function Get-BotUserValue {
    param([string]$Name)
    $global:registryReads.Add($Name)
    return $global:fakeRegistry[$Name]
}
'@
$source = Replace-Function $source 'Test-TrackedAlive' @'
function Test-TrackedAlive {
    param([string]$Name)
    if ($Probe) { return $true }
    return (Test-Path (Join-Path $LogDir ($Name + '.pid')))
}
'@
$source = Replace-Function $source 'Get-TrackedPid' 'function Get-TrackedPid { param([string]$Name) return 2468 }'
$source = Replace-Function $source 'Read-BotEndpoint' @'
function Read-BotEndpoint {
    param([string]$Path)
    $global:endpointReads.Add($Path)
    if ($Path -eq '/healthz') { return $global:healthBody }
    if ($global:readyBody -eq 'THROW') { throw 'synthetic-private-marker' }
    return $global:readyBody
}
'@
$python = 'C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe'
$source = $source.Replace('$Python = "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe"', ('$Python = ''' + $python + ''''))
$driver = Join-Path $work 'run_line_bot.ps1'
[IO.File]::WriteAllText($driver, $source, $utf8)
$child = @'
import json, os, time
checks = {
    'GEMINI_API_KEY': os.environ.get('GEMINI_API_KEY') == os.environ['ENVGUARD_EXPECTED'],
    'LAUNDRY_AI_CHAT': os.environ.get('LAUNDRY_AI_CHAT') == 'on',
    'LAUNDRY_FRESH_MINUTES': bool(os.environ.get('LAUNDRY_FRESH_MINUTES')),
    'LINE_UNREVIEWED': 'LINE_UNREVIEWED' not in os.environ,
}
print(json.dumps(checks), flush=True)
time.sleep(4)
'@
foreach ($name in @('line_webhook', 'staff_server', 'tunnel_manager')) {
    [IO.File]::WriteAllText((Join-Path $work ($name + '.py')), $child, $utf8)
}
$global:fakeRegistry = @{}
$global:registryReads = [Collections.Generic.List[string]]::new()
$global:endpointReads = [Collections.Generic.List[string]]::new()
$global:healthBody = 'ok 2468'
$global:readyBody = '{"pid":2468,"vision_configured":true,"ai_chat":true,"missing":[]}'
# Load only the declaration for the whitelist; never dot-source the launcher.
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($original, [ref]$tokens, [ref]$errors)
$decl = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-BotConfigNames' }, $true)
. ([scriptblock]::Create($decl.Extent.Text))
$saved = @{}
foreach ($name in @((Get-BotConfigNames)) + @('LOCALAPPDATA', 'ENVGUARD_EXPECTED', 'LINE_UNREVIEWED')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    foreach ($name in (Get-BotConfigNames)) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    [Environment]::SetEnvironmentVariable('LINE_UNREVIEWED', $null, 'Process')
    $env:LOCALAPPDATA = $work
    $env:ENVGUARD_EXPECTED = [Guid]::NewGuid().ToString('N')
    $global:fakeRegistry = @{ GEMINI_API_KEY = $env:ENVGUARD_EXPECTED; LAUNDRY_AI_CHAT = 'on'; LAUNDRY_FRESH_MINUTES = '90'; LINE_UNREVIEWED = 'exclude' }
    $logs = Join-Path $work 'line-bot'
    & $driver | Out-Null
    Assert ($LASTEXITCODE -eq 0) 'recovered startup exits zero'
    foreach ($name in @('line_webhook', 'staff_server', 'tunnel_manager')) {
        $childId = [int]([IO.File]::ReadAllText((Join-Path $logs ($name + '.pid')))).Trim()
        Wait-Process -Id $childId -Timeout 10 -ErrorAction SilentlyContinue
        $row = ConvertFrom-Json ([IO.File]::ReadAllText((Join-Path $logs ($name + '.log'))))
        foreach ($property in $row.PSObject.Properties) { Assert ($property.Value -eq $true) ('child ' + $name + ' ' + $property.Name) }
    }
    Assert ([string]::IsNullOrEmpty($env:GEMINI_API_KEY)) 'caller restored'
    $receiptPath = Join-Path $logs 'bot_config_receipt.json'
    $raw = [IO.File]::ReadAllText($receiptPath)
    $receipt = ConvertFrom-Json $raw
    Assert (-not $raw.Contains($env:ENVGUARD_EXPECTED)) 'receipt excludes value'
    Assert (-not $raw.Contains('://')) 'receipt excludes address'
    Assert ($receipt.GEMINI_API_KEY.present -eq $true -and $receipt.GEMINI_API_KEY.source -eq 'registry') 'registry provenance'
    Assert ($receipt.LAUNDRY_PHOTO_ESTIMATE.present -eq $false -and $receipt.LAUNDRY_PHOTO_ESTIMATE.source -eq 'missing') 'missing provenance'
    foreach ($property in $receipt.PSObject.Properties) {
        Assert (($property.Value.PSObject.Properties.Name -join ',') -eq 'present,source') ('receipt fields ' + $property.Name)
        Assert ($property.Value.present -is [bool]) ('receipt bool ' + $property.Name)
    }
    Assert (-not $global:registryReads.Contains('LINE_UNREVIEWED')) 'nonallowlisted registry value not read'
    # Existing process values, including explicit off/0, must not be overwritten.
    $env:GEMINI_API_KEY = $env:ENVGUARD_EXPECTED
    $env:LAUNDRY_AI_CHAT = 'off'
    $env:LAUNDRY_PHOTO_ESTIMATE = '0'
    $global:registryReads.Clear()
    $receiptHash = (Get-FileHash $receiptPath).Hash
    foreach ($case in @(
        @{ label='vision'; body='{"pid":2468,"vision_configured":false,"ai_chat":true,"missing":[]}'; code=1 },
        @{ label='healthy'; body='{"pid":2468,"vision_configured":true,"ai_chat":true,"missing":[]}'; code=0 },
        @{ label='chat'; body='{"pid":2468,"vision_configured":true,"ai_chat":false,"missing":[]}'; code=1 },
        @{ label='foreign'; body='{"pid":999,"vision_configured":true,"ai_chat":true,"missing":[]}'; code=1 },
        @{ label='malformed'; body='{}'; code=1 },
        @{ label='boolean-types'; body='{"pid":2468,"vision_configured":"true","ai_chat":true,"missing":[]}'; code=1 },
        @{ label='unavailable'; body='THROW'; code=1 },
        @{ label='missing'; body='{"pid":2468,"vision_configured":true,"ai_chat":true,"missing":["private"]}'; code=1 }
    )) {
        $global:readyBody = $case.body
        $global:endpointReads.Clear(); $global:registryReads.Clear()
        & $driver -Probe | Out-Null
        Assert ($LASTEXITCODE -eq $case.code) ('probe ' + $case.label)
        Assert ($global:endpointReads.Contains('/readyz')) 'probe reads readyz'
        Assert ($global:registryReads.Count -eq 0) 'probe does not read registry'
        Assert ((Get-FileHash $receiptPath).Hash -eq $receiptHash) 'probe preserves receipt'
    }
    $global:readyBody = '{"pid":2468,"vision_configured":false,"ai_chat":false,"missing":["LAUNDRY_AI_CHAT"]}'
    & $driver | Out-Null
    Assert ($LASTEXITCODE -ne 0) 'post-start readiness fails'
    Assert ($env:LAUNDRY_AI_CHAT -eq 'off' -and $env:LAUNDRY_PHOTO_ESTIMATE -eq '0') 'explicit settings retained'
    Assert (-not $global:registryReads.Contains('GEMINI_API_KEY')) 'process precedence does not read registry'
    $receipt = ConvertFrom-Json ([IO.File]::ReadAllText($receiptPath))
    Assert ($receipt.GEMINI_API_KEY.source -eq 'process') 'process provenance'
    Write-Output ('SMOKE_OK assertions=' + $script:passed)
} finally {
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
