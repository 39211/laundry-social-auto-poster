# PS-layer smoke for Test-LiveReelPostedEntry / Test-LiveReelHasSlot
# in scripts/youtube-upload.ps1. Extracts the production functions via AST
# (does not run the script body, so it never takes the single-flight lock
# or uploads).
#
# Teeth (F20 fish-1 sister / youtube-upload wrap miss):
#   1. AST pins assign-then-wrap, not @(Get-Content | ConvertFrom-Json)
#   2. Live IG reel success|posted counts; dry_run / facebook / image / failed do not
#   3. A JSON array of mixed rows still finds the live Reel after ConvertFrom-Json
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\youtube-upload.ps1"
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

function Get-ProdFunction([string]$Name) {
    $matches = $ast.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        }, $true)
    foreach ($fn in @($matches)) {
        if ($fn.Name -eq $Name) { return $fn }
    }
    return $null
}

$entryFn = Get-ProdFunction "Test-LiveReelPostedEntry"
$slotFn = Get-ProdFunction "Test-LiveReelHasSlot"
if (-not $entryFn) {
    Write-Output "EXTRACT_FAIL=Test-LiveReelPostedEntry not found"
    exit 2
}
if (-not $slotFn) {
    Write-Output "EXTRACT_FAIL=Test-LiveReelHasSlot not found"
    exit 2
}

Write-Output ("EXTRACT_OK name=" + $entryFn.Name)
Write-Output ("EXTRACT_OK name=" + $slotFn.Name)

$prodText = [IO.File]::ReadAllText($prod)
$wrapOk = $false
if (
    $prodText -match '\$postedParsed = Get-Content \$postedPath -Raw -Encoding utf8 \| ConvertFrom-Json' -and
    $prodText -match 'Test-LiveReelHasSlot \$postedParsed \$slotNumber' -and
    $prodText -notmatch '@\(\s*Get-Content \$postedPath[\s\S]{0,80}ConvertFrom-Json\s*\)'
) {
    $wrapOk = $true
}
if ($wrapOk) {
    Write-Output "WRAP_OK=ASSIGN_THEN_WRAP"
} else {
    Write-Output "WRAP_FAIL=posted-log wrap is not assign-then-Test-LiveReelHasSlot"
}

. ([scriptblock]::Create($entryFn.Extent.Text))
. ([scriptblock]::Create($slotFn.Extent.Text))

$failed = $false

function New-Row {
    param(
        [int]$Slot,
        [string]$Platform = "instagram",
        [string]$Status = "success",
        [string]$Media = "reel",
        [bool]$DryRun = $false
    )
    return [pscustomobject]@{
        slot                   = $Slot
        platform               = $Platform
        status                 = $Status
        published_media_type   = $Media
        dry_run                = $DryRun
    }
}

function Invoke-EntryCase {
    param([string]$Name, $Entry, [int]$Slot, [bool]$Expect)
    $got = [bool](Test-LiveReelPostedEntry $Entry $Slot)
    if ($got -ne $Expect) {
        Write-Output ("CASE_FAIL name=" + $Name + " got=" + $got + " expect=" + $Expect)
        $script:failed = $true
        return
    }
    Write-Output ("CASE_OK name=" + $Name + " got=" + $got)
}

function Invoke-SlotCase {
    param([string]$Name, $Entries, [int]$Slot, [bool]$Expect)
    $got = [bool](Test-LiveReelHasSlot $Entries $Slot)
    if ($got -ne $Expect) {
        Write-Output ("CASE_FAIL name=" + $Name + " got=" + $got + " expect=" + $Expect)
        $script:failed = $true
        return
    }
    Write-Output ("CASE_OK name=" + $Name + " got=" + $got)
}

Invoke-EntryCase -Name "ig-reel-success-s3" -Entry (New-Row -Slot 3) -Slot 3 -Expect $true
Invoke-EntryCase -Name "ig-reel-posted-s2" -Entry (New-Row -Slot 2 -Status "posted") -Slot 2 -Expect $true
Invoke-EntryCase -Name "dry-run-success" -Entry (New-Row -Slot 3 -DryRun $true) -Slot 3 -Expect $false
Invoke-EntryCase -Name "facebook-reel" -Entry (New-Row -Slot 3 -Platform "facebook") -Slot 3 -Expect $false
Invoke-EntryCase -Name "ig-image" -Entry (New-Row -Slot 3 -Media "image") -Slot 3 -Expect $false
Invoke-EntryCase -Name "ig-failed" -Entry (New-Row -Slot 3 -Status "failed") -Slot 3 -Expect $false
Invoke-EntryCase -Name "null-entry" -Entry $null -Slot 3 -Expect $false
Invoke-EntryCase -Name "wrong-slot" -Entry (New-Row -Slot 2) -Slot 3 -Expect $false

$mixedJson = @'
[
  {"slot":1,"platform":"instagram","status":"success","published_media_type":"carousel","dry_run":false},
  {"slot":2,"platform":"instagram","status":"success","published_media_type":"reel","dry_run":true},
  {"slot":3,"platform":"instagram","status":"success","published_media_type":"reel","dry_run":false},
  {"slot":3,"platform":"facebook","status":"success","published_media_type":"reel","dry_run":false}
]
'@
$mixedParsed = $mixedJson | ConvertFrom-Json
Invoke-SlotCase -Name "mixed-array-s3" -Entries $mixedParsed -Slot 3 -Expect $true
Invoke-SlotCase -Name "mixed-array-s2-dry" -Entries $mixedParsed -Slot 2 -Expect $false
Invoke-SlotCase -Name "mixed-array-s1-carousel" -Entries $mixedParsed -Slot 1 -Expect $false

$oneJson = '{"slot":2,"platform":"instagram","status":"posted","published_media_type":"reel","dry_run":false}'
$oneParsed = $oneJson | ConvertFrom-Json
Invoke-SlotCase -Name "single-object-s2" -Entries $oneParsed -Slot 2 -Expect $true
Invoke-SlotCase -Name "single-object-s3" -Entries $oneParsed -Slot 3 -Expect $false

$emptyParsed = '[]' | ConvertFrom-Json
Invoke-SlotCase -Name "empty-array" -Entries $emptyParsed -Slot 3 -Expect $false

# Frozen pre-refactor predicate from youtube-upload.ps1 (d6b9c08e5d45).
# This reference never loads or runs the upload script body.
function Test-LegacyLiveReelHasSlot {
    param($Entries, [int]$Slot)
    $posted = @($Entries)
    $slotNumber = $Slot
    $reelLive = @($posted | Where-Object {
        $_.slot -eq $slotNumber -and $_.platform -eq "instagram" -and -not $_.dry_run -and
        (@("success", "posted") -contains $_.status) -and $_.published_media_type -eq "reel"
    })
    return ($reelLive.Count -gt 0)
}

# One equivalence case: the legacy filter and both production helpers receive
# the same parsed posted-log samples, including optional fields and PS truthiness.
$equivalenceSamples = @(
    [pscustomobject]@{ Name = "mixed-array"; Json = $mixedJson }
    [pscustomobject]@{ Name = "single-object"; Json = $oneJson }
    [pscustomobject]@{ Name = "empty-array"; Json = '[]' }
    [pscustomobject]@{ Name = "null-log"; Json = 'null' }
    [pscustomobject]@{ Name = "excluded-only"; Json = @'
[
  null,
  {},
  {"slot":2,"platform":"facebook","status":"success","published_media_type":"reel","dry_run":false},
  {"slot":3,"platform":"instagram","status":"failed","published_media_type":"reel","dry_run":false},
  {"slot":2,"platform":"instagram","status":"success","published_media_type":"image","dry_run":false},
  {"slot":3,"platform":"instagram","status":"posted","published_media_type":"reel","dry_run":true},
  {"slot":3,"platform":"instagram","status":"success","published_media_type":"reel","dry_run":"false"}
]
'@ }
    [pscustomobject]@{ Name = "scalar-and-optional"; Json = @'
[
  {"slot":"2","platform":"INSTAGRAM","status":"POSTED","published_media_type":"REEL"},
  {"slot":3,"platform":"instagram","status":"success","published_media_type":"reel","dry_run":0},
  {"slot":3,"platform":"instagram","status":null,"published_media_type":"reel","dry_run":false},
  {"slot":3,"platform":null,"status":"success","published_media_type":"reel","dry_run":false},
  {"slot":3,"platform":"instagram","status":"success","published_media_type":null,"dry_run":false},
  {"slot":4,"platform":"instagram","status":"success","published_media_type":"reel","dry_run":false}
]
'@ }
)
$equivalenceFailed = $false
$equivalenceChecks = 0
foreach ($sample in $equivalenceSamples) {
    $sampleParsed = $sample.Json | ConvertFrom-Json
    foreach ($slot in @(1, 2, 3, 4)) {
        $legacy = Test-LegacyLiveReelHasSlot $sampleParsed $slot
        $current = Test-LiveReelHasSlot $sampleParsed $slot
        $equivalenceChecks++
        if ($current -isnot [bool] -or $current -ne $legacy) {
            Write-Output ("CASE_FAIL name=legacy-equivalence sample=" + $sample.Name + " slot=" + $slot)
            $equivalenceFailed = $true
        }
        foreach ($entry in @($sampleParsed)) {
            $legacyEntry = Test-LegacyLiveReelHasSlot $entry $slot
            $currentEntry = Test-LiveReelPostedEntry $entry $slot
            $equivalenceChecks++
            if ($currentEntry -isnot [bool] -or $currentEntry -ne $legacyEntry) {
                Write-Output ("CASE_FAIL name=legacy-entry-equivalence sample=" + $sample.Name + " slot=" + $slot)
                $equivalenceFailed = $true
            }
        }
    }
}
if ($equivalenceFailed) {
    $failed = $true
} else {
    Write-Output ("CASE_OK name=legacy-equivalence samples=" + $equivalenceSamples.Count + " comparisons=" + $equivalenceChecks)
}

if (-not $wrapOk) { $failed = $true }

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                    = $true
    wrap                  = "assign_then_wrap"
    ig_reel_success       = $true
    dry_run_counts        = $false
    facebook_counts       = $false
    image_counts          = $false
    mixed_array_slot3     = $true
    mixed_array_slot2_dry = $false
    single_object_slot2   = $true
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
