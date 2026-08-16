# Dumps four story frames beside a finished reel: one per act plus the close.
#
# 2026-08-16: the owner rejected a reel whose acts did not read as one object
# (different-looking laces, a middle act dirtier than the "before"). Channel
# statistics measurably cannot see that axis - a photometric gate calibrated on
# this very case passed it - so the acceptance check is eyes on frames, and
# this script makes that cost one image read instead of one video watch. The
# production loop reads these frames for every fresh reel; a reel whose story
# order fails (defect act missing, object identity drifting between acts) goes
# back for regeneration instead of to the owner.
param(
    [Parameter(Mandatory = $true)][string]$ReelPath
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $ReelPath)) { throw "Reel not found: $ReelPath" }
$probeOut = & ffprobe -v error -show_entries format=duration -of csv=p=0 $ReelPath 2>&1
$probeExit = $LASTEXITCODE
$raw = @($probeOut | Select-Object -First 1)[0]
$duration = 0.0
if ($probeExit -ne 0 -or -not [double]::TryParse([string]$raw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$duration)) {
    throw "ffprobe returned no duration for $ReelPath (exit $probeExit, got '$raw'; $probeOut)"
}
$dir = [IO.Path]::ChangeExtension($ReelPath, $null).TrimEnd('.') + ".frames"
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Act sampling for the 10s two-act and 14s three-act cuts alike: early hook,
# first third, second third, closing card.
$points = @(
    @{ name = "1-hook";   t = [Math]::Min(1.0, $duration * 0.08) },
    @{ name = "2-early";  t = $duration * 0.35 },
    @{ name = "3-middle"; t = $duration * 0.6 },
    @{ name = "4-close";  t = [Math]::Max(0.0, $duration - 1.2) }
)
foreach ($p in $points) {
    $t = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $p.t)
    $framePath = Join-Path $dir "$($p.name).png"
    $ffOut = & ffmpeg -v error -y -ss $t -i $ReelPath -frames:v 1 $framePath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg extract failed at $($p.name) t=$t (exit $LASTEXITCODE): $ffOut"
    }
    if (-not (Test-Path $framePath) -or (Get-Item $framePath).Length -eq 0) {
        throw "ffmpeg extract wrote no frame at $($p.name) t=$t : $ffOut"
    }
}
foreach ($p in $points) {
    $framePath = Join-Path $dir "$($p.name).png"
    if (-not (Test-Path $framePath) -or (Get-Item $framePath).Length -eq 0) {
        throw "Missing expected story frame $($p.name).png in $dir"
    }
}
$made = @(Get-ChildItem $dir -Filter "*.png")
if ($made.Count -lt 4) { throw "Expected 4 story frames, got $($made.Count) in $dir" }
Write-Host "extract-reel-frames: $($made.Count) frames -> $dir"
