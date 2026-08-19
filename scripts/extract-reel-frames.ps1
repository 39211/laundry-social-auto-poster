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
    [Parameter(Mandatory = $true)][string]$ReelPath,
    [string]$QaDir = "",
    [string]$Treatment = "auto"
)
$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot
. (Join-Path $PSScriptRoot "_production-contract.ps1")
if (-not (Assert-CleanProductionContractBeforeAction -Root $projectRoot -Stage "Reel frame extraction")) {
    throw "BLOCKED production contract before Reel frame extraction."
}
$trustedFfmpeg = Resolve-TrustedProductionFfmpegExecutable -Root $projectRoot
$trustedFfprobe = Resolve-TrustedProductionFfprobeExecutable -Root $projectRoot
$trustedPython = Resolve-TrustedProductionPythonExecutable -Root $projectRoot
if (-not $trustedFfmpeg -or -not $trustedFfprobe -or -not $trustedPython) {
    throw "BLOCKED Reel frame extraction: trusted allowlisted ffmpeg.exe, ffprobe.exe, or python.exe could not be established."
}

function Assert-ReelFrameContract([string]$Stage) {
    if (-not (Assert-CleanProductionContractBeforeAction -Root $projectRoot -Stage $Stage)) {
        throw "BLOCKED production contract before $Stage."
    }
}
if (-not (Test-Path $ReelPath)) { throw "Reel not found: $ReelPath" }
$probeOut = Invoke-TrustedProductionFfprobe -Root $projectRoot -CommandArguments @("-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", $ReelPath) 2>&1
$probeExit = $LASTEXITCODE
$raw = @($probeOut | Select-Object -First 1)[0]
$duration = 0.0
if ($probeExit -ne 0 -or -not [double]::TryParse([string]$raw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$duration)) {
    throw "ffprobe returned no duration for $ReelPath (exit $probeExit, got '$raw'; $probeOut)"
}
$dir = [IO.Path]::ChangeExtension($ReelPath, $null).TrimEnd('.') + ".frames"
Assert-ReelFrameContract "Reel frame directory replacement"
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
    Assert-ReelFrameContract "Reel story-frame render"
    $ffOut = Invoke-TrustedProductionFfmpeg -Root $projectRoot -CommandArguments @("-v", "error", "-y", "-ss", $t, "-i", $ReelPath, "-frames:v", "1", $framePath) 2>&1
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

# QA copies are a separate directory: human frames stay clean. Each QA frame
# is burned with a random 4-character canary so a silent -i drop cannot PASS.
$qaTarget = $QaDir
if (-not $qaTarget) {
    $qaTarget = [IO.Path]::ChangeExtension($ReelPath, $null).TrimEnd('.') + ".qa-frames"
}
Assert-ReelFrameContract "Reel QA frame directory replacement"
if (Test-Path $qaTarget) { Remove-Item $qaTarget -Recurse -Force }
New-Item -ItemType Directory -Force -Path $qaTarget | Out-Null

$durStr = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $duration)
$planRaw = Invoke-TrustedProductionTsx -Root $projectRoot (Join-Path $projectRoot "src\visualQaCli.ts") --plan-frames --reel $ReelPath --duration $durStr --treatment $Treatment
if ($LASTEXITCODE -ne 0 -or -not $planRaw) {
    throw "visualQaCli --plan-frames failed for $ReelPath : $planRaw"
}
$planLine = @($planRaw | Where-Object { "$_" -match '^\s*\{' } | Select-Object -Last 1)[0]
if (-not $planLine) { throw "visualQaCli --plan-frames returned no JSON: $planRaw" }
$plan = $planLine | ConvertFrom-Json
if (-not $plan.samples -or @($plan.samples).Count -lt 2) {
    throw "visualQaCli returned no scene-aware samples for $ReelPath"
}
Assert-ReelFrameContract "Reel QA canary render"

$font = "C\:/Windows/Fonts/consola.ttf"
if (-not (Test-Path "C:\Windows\Fonts\consola.ttf")) { $font = "C\:/Windows/Fonts/arial.ttf" }
$chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
$planned = @()
foreach ($sample in @($plan.samples)) {
    $t = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.###}", $sample.t)
    $rawFrame = Join-Path $qaTarget ("raw-" + $sample.name + ".png")
    Assert-ReelFrameContract "Reel QA raw-frame render"
    $ffOut = Invoke-TrustedProductionFfmpeg -Root $projectRoot -CommandArguments @("-v", "error", "-y", "-ss", $t, "-i", $ReelPath, "-frames:v", "1", $rawFrame) 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $rawFrame) -or (Get-Item $rawFrame).Length -eq 0) {
        throw "QA ffmpeg extract failed at $($sample.name) t=$t (exit $LASTEXITCODE): $ffOut"
    }
    $code = -join (1..4 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    $qaFrame = Join-Path $qaTarget ($sample.name + ".png")
    $draw = "drawtext=fontfile='$font':text='$code':x=16:y=h-56:fontsize=36:fontcolor=yellow:box=1:boxcolor=black@0.88:boxborderw=8"
    Assert-ReelFrameContract "Reel QA canary render"
    $burnOut = Invoke-TrustedProductionFfmpeg -Root $projectRoot -CommandArguments @("-v", "error", "-y", "-i", $rawFrame, "-vf", $draw, $qaFrame) 2>&1
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $qaFrame) -or (Get-Item $qaFrame).Length -eq 0) {
        throw "QA canary burn failed at $($sample.name) (exit $LASTEXITCODE): $burnOut"
    }
    Assert-ReelFrameContract "Reel QA raw-frame cleanup"
    Remove-Item $rawFrame -Force
    $planned += [ordered]@{
        name   = [string]$sample.name
        act    = [string]$sample.act
        t      = [double]$sample.t
        canary = $code
    }
}

$plannedPath = Join-Path $qaTarget "planned.json"
Assert-ReelFrameContract "Reel QA plan write"
($planned | ConvertTo-Json -Depth 4) | Set-Content -Path $plannedPath -Encoding UTF8
Invoke-TrustedProductionTsx -Root $projectRoot (Join-Path $projectRoot "src\visualQaCli.ts") --build-sidecar --qa-dir $qaTarget --reel $ReelPath --duration $durStr --treatment $plan.treatment --canaries-file $plannedPath
if ($LASTEXITCODE -ne 0) { throw "visualQaCli --build-sidecar failed for $ReelPath" }

$pyListed = @(Invoke-TrustedProductionPython -Root $projectRoot -CommandArguments @((Join-Path $projectRoot "scripts\visual_qa_io.py"), "list-png", $qaTarget))
if ($pyListed.Count -lt 2) {
    throw "Python list-png saw fewer than 2 QA frames in $qaTarget"
}
Write-Host "extract-reel-frames: $($planned.Count) QA canary frames -> $qaTarget (treatment=$($plan.treatment))"
