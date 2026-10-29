# Generate every still for the On Cloudtilt film, one at a time.
#
# SERIAL ON PURPOSE. Codex writes into a single per-session generated_images
# directory and codex_still.ps1 picks the newest file written after the attempt
# started; two concurrent runs pick each other's frames. That was observed on
# 2026-08-21 and is recorded as F30.
#
# Usage: run_cloudtilt_stills.ps1 [-Only s03-04p03,s07-08p00] [-Force]

param(
    [string[]]$Only,
    [switch]$Force
)

$ErrorActionPreference = "Continue"
$job = "C:\Users\cyc39\laundry-repo\output\reel-cloudtilt-20260916"
$gen = "C:\Users\cyc39\laundry-repo\scripts\reel-v3\codex_still.ps1"

$shots = Get-Content (Join-Path $job "prompts\shots.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Only) { $shots = $shots | Where-Object { $Only -contains $_.id } }

$ok = 0; $fail = @(); $skip = 0
$t0 = Get-Date
foreach ($s in $shots) {
    $dest = Join-Path $job "$($s.id).png"
    if ((Test-Path $dest) -and -not $Force) { $skip++; Write-Host "SKIP  $($s.id) exists"; continue }
    Write-Host ("=" * 70)
    Write-Host ("{0}  {1}s  dirt {2}  {3}" -f $s.id, $s.seconds, $s.dirt, $s.scene)
    $args = @{ JobDir = $job; Id = $s.id; PromptFile = "prompts\shots.json" }
    if ($Force) { $args.Force = $true }
    & $gen @args | Select-String -Pattern "SHOT|REFS|PROMPT |RESULT|^OK|ASPECT|MISSING|NO " |
        ForEach-Object { Write-Host ("  " + $_.Line.Trim()) }
    if (Test-Path $dest) { $ok++ } else { $fail += $s.id }
}

$mins = [math]::Round(((Get-Date) - $t0).TotalMinutes, 1)
Write-Host ("=" * 70)
Write-Host ("DONE  {0} generated, {1} skipped, {2} failed, {3} min" -f $ok, $skip, $fail.Count, $mins)
if ($fail.Count) { Write-Host ("FAILED: " + ($fail -join ", ")) }
exit $fail.Count
