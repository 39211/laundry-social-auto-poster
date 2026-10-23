# PS-layer smoke for the "pick work: prefer missing 15s" block in
# scripts/produce-next-reel.ps1 (around line 445-470).
# Extracts the production block by text anchors (it is top-level script code,
# not a function, so AST FunctionDefinitionAst lookup does not apply) and runs
# it with a fixture $windowDays that has one paused 15s half and one unpaused
# 15s half. Before the fix, both are treated as gaps to fill; after the fix,
# the paused half must be skipped.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$prod = Join-Path $root "scripts\produce-next-reel.ps1"
if (-not (Test-Path -LiteralPath $prod)) {
    Write-Output "MISSING_PROD=$prod"
    exit 2
}

$source = Get-Content -LiteralPath $prod -Raw -Encoding UTF8

$startNeedle = '$windowDays = Get-PlanDaysInWindow $date 4'
$endNeedle = 'if ($missing15s.Count -gt 0) {'
$startIdx = $source.IndexOf($startNeedle)
$endIdx = $source.IndexOf($endNeedle)
if ($startIdx -lt 0 -or $endIdx -lt 0 -or $endIdx -le $startIdx) {
    Write-Output "EXTRACT_FAIL=anchors not found (start=$startIdx end=$endIdx)"
    exit 2
}
$block = $source.Substring($startIdx, $endIdx - $startIdx)
Write-Output ("EXTRACT_OK len=" + $block.Length)
if ($block -notmatch [regex]::Escape('$missing15s = @()')) {
    Write-Output "EXTRACT_FAIL=missing15s init not in slice"
    exit 2
}

# --- stubs: isolate the block from disk state and the rest of the script -----
function Get-PlanDaysInWindow {
    param([datetime]$fromDate, [int]$days)
    return $script:fixtureWindowDays
}
function Get-ReelAssetPath([string]$conceptId, [string]$variant) {
    # Every asset "missing" so the only thing that can exclude a gap is the
    # paused guard under test.
    return (Join-Path $env:TEMP "does-not-exist-$conceptId-$variant.mp4")
}
function Test-ConceptRejected([string]$ConceptId) { return $false }
function Write-Log([string]$m) { }

$date = "2026-10-03"

$script:fixtureWindowDays = @(
    [pscustomobject]@{
        date    = "2026-10-03"
        noon    = [pscustomobject]@{ conceptId = "canvas-shoe-mud"; variant = "10s"; paused = $false }
        evening = [pscustomobject]@{ conceptId = "wool-coat-shoulder"; variant = "15s"; paused = $true }
    },
    [pscustomobject]@{
        date    = "2026-10-05"
        noon    = [pscustomobject]@{ conceptId = "suit-shoulder"; variant = "15s"; paused = $false }
        evening = [pscustomobject]@{ conceptId = "heel-tip-scuff"; variant = "15s" }  # paused absent = not paused
    }
)

. ([scriptblock]::Create($block))

$ids = @($missing15s | ForEach-Object { $_.conceptId })
Write-Output ("MISSING15S_COUNT=" + $missing15s.Count)
Write-Output ("MISSING15S_IDS=" + ($ids -join ","))

$failed = $false
if ($ids -contains "wool-coat-shoulder") {
    Write-Output "CASE_FAIL name=paused-15s-not-skipped wool-coat-shoulder should not be a gap (evening.paused=true)"
    $failed = $true
}
if ($ids -notcontains "suit-shoulder") {
    Write-Output "CASE_FAIL name=unpaused-15s-still-found suit-shoulder (paused=false) must still be a gap"
    $failed = $true
}
if ($ids -notcontains "heel-tip-scuff") {
    Write-Output "CASE_FAIL name=absent-paused-still-found heel-tip-scuff (paused absent) must still be a gap"
    $failed = $true
}

if ($failed) {
    Write-Output "SMOKE_FAIL"
    exit 1
}
Write-Output "SMOKE_OK"

$payload = [ordered]@{
    ok                    = $true
    missing15s_count      = [int]$missing15s.Count
    ids                   = ($ids -join ",")
    paused_half_excluded  = [bool](-not ($ids -contains "wool-coat-shoulder"))
    unpaused_half_kept    = [bool]($ids -contains "suit-shoulder")
    absent_paused_kept    = [bool]($ids -contains "heel-tip-scuff")
}
Write-Output ($payload | ConvertTo-Json -Compress)
exit 0
