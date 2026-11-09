# Offline integration smoke: execute a copy of day-audit against synthetic data.
# Replace only effect boundaries (watchdog, command, toast, Python), never guards.
# A removed AuditOnly guard is observable without touching a real task or network.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path $root ('output\operations\ytgap-smoke-' + [Guid]::NewGuid().ToString('N'))
$codeRoot = Join-Path $work 'code'
$scripts = Join-Path $codeRoot 'scripts'
New-Item -ItemType Directory -Force -Path (Join-Path $scripts 'lib') | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$bom = [Text.UTF8Encoding]::new($true)
$global:ytgapEffects = [Collections.Generic.List[string]]::new()
$script:passed = 0
$script:failed = 0

function Start-ScheduledTask {
    [CmdletBinding()] param([string]$TaskName)
    $global:ytgapEffects.Add('scheduler:' + $TaskName)
}
function Get-ScheduledTask {
    [CmdletBinding()] param()
    $global:ytgapEffects.Add('scheduler-query')
}
function Enable-ScheduledTask {
    [CmdletBinding()] param([string]$TaskName)
    $global:ytgapEffects.Add('scheduler-enable:' + $TaskName)
}
function cmd {
    $global:ytgapEffects.Add('cmd:' + ($args -join ' '))
    $global:LASTEXITCODE = 0
    'synthetic command result'
}
function Assert-Equal($Actual, $Expected, [string]$Label) {
    $actualJson = ConvertTo-Json -InputObject $Actual -Depth 12 -Compress
    $expectedJson = ConvertTo-Json -InputObject $Expected -Depth 12 -Compress
    if ($actualJson -cne $expectedJson) {
        throw "$Label got=$actualJson expected=$expectedJson"
    }
}
function Write-Json([string]$Path, $Value) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 12), $utf8)
}
function Get-InputHashes([string]$Fixture) {
    @(Get-ChildItem -LiteralPath (Join-Path $Fixture 'data') -Recurse -File |
        Sort-Object FullName | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }) -join ','
}

$sourcePath = Join-Path $root 'scripts\day-audit.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "PARSE_FAIL=$parseErrors" }
$toast = @($ast.FindAll({ param($n)
    $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Show-Toast'
}, $true))
if ($toast.Count -ne 1) { throw 'Expected exactly one toast boundary' }
$source = $source.Remove($toast[0].Extent.StartOffset, $toast[0].Extent.EndOffset - $toast[0].Extent.StartOffset).Insert(
    $toast[0].Extent.StartOffset, 'function Show-Toast([string]$text) { $global:ytgapEffects.Add("toast") }')
$pythonLiteral = "'C:/Users/cyc39/AppData/Local/Python/pythoncore-3.14-64/python.exe'"
if (-not $source.Contains($pythonLiteral)) { throw 'Missing offline producer boundary' }
$pythonStub = Join-Path $scripts 'python-stub.ps1'
$source = $source.Replace($pythonLiteral, "'" + $pythonStub.Replace("'", "''") + "'")
[IO.File]::WriteAllText($pythonStub, @'
if (@($args | Where-Object { "$_" -like '*bot_readiness_audit.py' }).Count) {
    $global:ytgapEffects.Add('readiness')
    $global:readinessResult | ConvertTo-Json -Compress
    if ($global:readinessResult.status -eq 'fail') { exit 1 }
    exit 0
}
$global:ytgapEffects.Add('level1'); exit 0
'@, $utf8)
[IO.File]::WriteAllText((Join-Path $scripts '_watchdog.ps1'), '$global:ytgapEffects.Add("watchdog")', $utf8)
Copy-Item -LiteralPath (Join-Path $root 'scripts\lib\live-reel.ps1') -Destination (Join-Path $scripts 'lib\live-reel.ps1')
$audit = Join-Path $scripts 'day-audit.ps1'
[IO.File]::WriteAllText($audit, $source, $bom)

function New-Fixture {
    param([string]$Name, [hashtable]$Media, [int[]]$CalendarSlots = @(1, 2),
        [object[]]$YouTube = @(), [switch]$MissingComments, [switch]$Duplicate,
        [string]$Date = '2026-01-31', [string]$Fixture)
    if (-not $Fixture) { $Fixture = Join-Path $work $Name }
    $rows = @()
    foreach ($slot in @($Media.Keys | Sort-Object)) {
        foreach ($platform in @('instagram', 'facebook')) {
            $rows += [ordered]@{ slot = [int]$slot; platform = $platform; status = 'posted';
                dry_run = $false; published_media_type = $Media[$slot] }
        }
    }
    if ($Duplicate) { $rows += $rows | Where-Object { $_.slot -eq 2 } }
    Write-Json (Join-Path $Fixture "data\posted-log\$Date.json") $rows
    # Calendar deliberately disagrees with posted media: actual publication wins.
    $slots = @($CalendarSlots | ForEach-Object { @{ slot = $_; media_type = 'reel' } })
    Write-Json (Join-Path $Fixture "data\content-calendar\$Date.json") @{ slots = $slots }
    $nextDate = [DateTime]::ParseExact($Date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).AddDays(1).ToString('yyyy-MM-dd')
    Write-Json (Join-Path $Fixture "data\content-calendar\$nextDate.json") @{ slots = @() }
    $comments = @(if (-not $MissingComments) { $CalendarSlots | ForEach-Object { @{ slot = $_; comment_id = "fake-$_" } } })
    Write-Json (Join-Path $Fixture "data\first-comments\$Date.json") $comments
    Write-Json (Join-Path $Fixture "data\youtube-log\$Date.json") $YouTube
    Write-Json (Join-Path $Fixture 'data\ab-test-plan.json') @()
    Write-Json (Join-Path $Fixture ('data\leads\' + $Date.Substring(0, 7) + '.json')) @{
        days = @{ $Date = @{ line_clicks_total = 7; source_clicks = @{ instagram = 5; facebook = 2 } } }
    }
    return $Fixture
}

function Invoke-Case {
    param([string]$Name, [hashtable]$Media, [int]$Live, [int]$Uploaded = 0,
        [int[]]$CalendarSlots = @(1, 2), [object[]]$YouTube = @(),
        [switch]$MissingComments, [switch]$Duplicate, [switch]$DefaultMode,
        [string]$ReadyStatus = 'pass', [string]$ReadyReason = 'ready')
    $date = '2026-01-31'
    $fixtureArg = ''
    if ($DefaultMode) {
        $date = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, [TimeZoneInfo]::FindSystemTimeZoneById('Taipei Standard Time')).ToString('yyyy-MM-dd')
        $fixtureArg = $codeRoot
    }
    $fixture = New-Fixture -Name $Name -Media $Media -CalendarSlots $CalendarSlots -YouTube $YouTube `
        -MissingComments:$MissingComments -Duplicate:$Duplicate -Date $date -Fixture $fixtureArg
    $before = Get-InputHashes $fixture
    $global:ytgapEffects.Clear()
    $global:readinessResult = @{ status = $ReadyStatus; reason = $ReadyReason }
    try {
        if ($DefaultMode) { & $audit | Out-Null }
        else { & $audit -RootPath $fixture -Date $date -AuditOnly | Out-Null }
        if ($LASTEXITCODE -ne 0) { throw "Audit exit=$LASTEXITCODE" }
        # Side effects are checked first so M3 fails for the actual scheduler call.
        if (-not $DefaultMode) {
            Assert-Equal @($global:ytgapEffects.ToArray()) @() 'AuditOnly side effects'
        } else {
            $expectedEffects = @('watchdog')
            if ($Live -gt $Uploaded) { $expectedEffects += 'scheduler:Laundry-YouTube-Upload' }
            if ($MissingComments) { $expectedEffects += "cmd:/c npm.cmd run first-comment -- --date $date 2>&1" }
            $expectedEffects += "cmd:/c npm.cmd run ga4-report -- --date $date 2>&1", 'readiness', 'toast', 'level1'
            Assert-Equal @($global:ytgapEffects.ToArray()) $expectedEffects 'default effects'
        }
        $reportPath = Join-Path $fixture "output\day-reports\$date.json"
        $report = ConvertFrom-Json ([IO.File]::ReadAllText($reportPath))
        Assert-Equal $report.youtube.live_reels $Live 'live_reels'
        Assert-Equal $report.youtube.uploaded $Uploaded 'uploaded'
        Assert-Equal ($report.youtube.live_reels - $report.youtube.uploaded) ($Live - $Uploaded) 'youtube gap'
        Assert-Equal $report.ok (($Live -le $Uploaded) -and -not $MissingComments -and ((-not $DefaultMode) -or $ReadyStatus -ne 'fail')) 'ok'
        if ($DefaultMode) {
            Assert-Equal $report.bot_readiness.status $ReadyStatus 'bot readiness status'
            Assert-Equal $report.bot_readiness.reason $ReadyReason 'bot readiness reason'
            if ($ReadyStatus -eq 'fail') {
                $log = [IO.File]::ReadAllText((Join-Path $fixture "output\day-reports\$date.log"))
                Assert-Equal ($log.Contains('FAIL LINE bot readiness: ' + $ReadyReason)) $true 'readiness failure logged'
            }
        } else {
            Assert-Equal $report.bot_readiness.status 'not_applicable' 'offline readiness skipped'
        }
        Assert-Equal $report.date $date 'date'
        Assert-Equal @($report.missing_posts) @() 'missing_posts'
        $expectedMissing = @(if ($MissingComments) { $CalendarSlots })
        Assert-Equal @($report.missing_comments) $expectedMissing 'missing_comments'
        foreach ($slot in 1, 2, 3) {
            Assert-Equal $report.slots."$slot".instagram ($Media.ContainsKey($slot)) "slot $slot IG"
            Assert-Equal $report.slots."$slot".facebook ($Media.ContainsKey($slot)) "slot $slot FB"
        }
        Assert-Equal $report.tomorrow.calendar $true 'tomorrow calendar'
        Assert-Equal $report.tomorrow.reels 'unknown' 'tomorrow reels'
        Assert-Equal $report.line_clicks 7 'line_clicks'
        # Avoid a non-ASCII source file; production uses an ideographic comma.
        Assert-Equal $report.line_click_sources ('instagram 5' + [char]0x3001 + 'facebook 2') 'line_click_sources'
        $actions = @()
        if ($Live -gt $Uploaded) {
            $verb = if ($DefaultMode) { 'started' } else { 'would start' }
            $actions += "$verb YouTube upload ($Uploaded/$Live)"
        }
        if ($DefaultMode -and $MissingComments) { $actions += "posted first comments for slot $($CalendarSlots -join ',')" }
        Assert-Equal @($report.rescue_actions) $actions 'rescue_actions'
        $keys = @('date', 'generated_at', 'ok', 'slots', 'missing_posts', 'missing_comments', 'youtube', 'tomorrow', 'rescue_actions', 'line_clicks', 'line_click_sources', 'bot_readiness')
        Assert-Equal @($report.PSObject.Properties.Name) $keys 'report schema'
        Assert-Equal (Get-InputHashes $fixture) $before 'inputs unchanged'
        if (-not $DefaultMode) {
            Assert-Equal @(Get-ChildItem (Join-Path $fixture 'output') -Recurse -File | ForEach-Object { $_.Name }) @("$date.json") 'report only'
        }
        $script:passed++
        Write-Output "CASE_OK name=$Name live_reels=$Live gap=$($Live - $Uploaded)"
    } catch {
        $script:failed++
        Write-Output "CASE_FAIL name=$Name reason=$($_.Exception.Message)"
    }
}

Invoke-Case -Name 'image-no-youtube-gap' -Media @{ 1 = 'image'; 2 = 'image' } -Live 0
Invoke-Case -Name 'reel-missing-upload' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1
Invoke-Case -Name 'reel-upload-without-video-id' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1 -YouTube @(@{ slot = 2; status = 'pending' })
Invoke-Case -Name 'reel-uploaded' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1 -Uploaded 1 -YouTube @(@{ slot = 2; video_id = 'fake-youtube' })
Invoke-Case -Name 'slot3-ab-reel' -Media @{ 1 = 'image'; 2 = 'image'; 3 = 'reel' } -CalendarSlots @(1, 2, 3) -Live 1
Invoke-Case -Name 'both-reel-slots' -Media @{ 1 = 'image'; 2 = 'reel'; 3 = 'reel' } -CalendarSlots @(1, 2, 3) -Live 2
Invoke-Case -Name 'slot3-without-calendar-entry' -Media @{ 1 = 'image'; 2 = 'image'; 3 = 'reel' } -Live 1
Invoke-Case -Name 'duplicate-posts-count-once' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1 -Duplicate
Invoke-Case -Name 'audit-only-missing-comments' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1 -MissingComments
Invoke-Case -Name 'default-invocation-effects' -Media @{ 1 = 'image'; 2 = 'reel' } -Live 1 -MissingComments -DefaultMode
Invoke-Case -Name 'night-missing-config' -Media @{ 1 = 'image'; 2 = 'image' } -Live 0 -DefaultMode `
    -ReadyStatus 'fail' -ReadyReason 'vision_configured=False: GEMINI_API_KEY LAUNDRY_PHOTO_ESTIMATE'
Invoke-Case -Name 'day-shop-owns' -Media @{ 1 = 'image'; 2 = 'image' } -Live 0 -DefaultMode `
    -ReadyStatus 'not_applicable' -ReadyReason 'shop_day_window'

Write-Output "RESULT passed=$script:passed failed=$script:failed fixtures=$work"
if ($script:failed) { Write-Output 'SMOKE_FAIL'; exit 1 }
Write-Output 'SMOKE_OK'
exit 0
