# Take the still ChatGPT just downloaded and put it in the job, or refuse.
#
# Supersedes place-downloaded-still.ps1, which only ever looked for a .tmp.
# The browser pane sometimes finalises the download with its real filename and
# sometimes leaves it as a random .tmp, and on 2026-09-12 the .tmp-only version
# reported "NO CANDIDATE" for a file that had landed correctly under its own
# name. Look for the named file first, then fall back to the newest .tmp.
#
# Gates, all of which refuse rather than warn:
#   * the bytes actually start with the PNG signature
#   * the aspect is 9:16 within tolerance
#   * the destination does not already exist, so nothing is silently overwritten
#
# Usage: place-chatgpt-still.ps1 -Name s01-intake.png -JobDir <dir>

param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$JobDir,
    [int]$MaxAgeMinutes = 8,
    [double]$TargetRatio = 0.5625,
    [double]$Tolerance = 0.01
)

$ErrorActionPreference = "Stop"

$named = Join-Path "$env:USERPROFILE\Downloads" $Name
if (Test-Path $named) {
    $src = $named
} else {
    $tmp = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "*.tmp" -ErrorAction SilentlyContinue |
           Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-$MaxAgeMinutes) } |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $tmp) { Write-Host "NO CANDIDATE: neither $Name nor a recent .tmp is in Downloads"; exit 1 }
    $src = $tmp.FullName
}

$bytes = [IO.File]::ReadAllBytes($src)
if ($bytes.Length -lt 8) { Write-Host "TOO SMALL: $($bytes.Length) bytes"; exit 1 }
$sig = ($bytes[0..7] | ForEach-Object { $_.ToString('x2') }) -join ''
if ($sig -ne '89504e470d0a1a0a') { Write-Host "NOT A PNG: magic=$sig"; exit 1 }

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($src)
$w = $img.Width; $h = $img.Height; $img.Dispose()
$ratio = [math]::Round($w / $h, 4)
if ([math]::Abs($ratio - $TargetRatio) -gt $Tolerance) {
    Write-Host "ASPECT REFUSED: ${w}x${h} ratio=$ratio, wanted $TargetRatio +/-$Tolerance"
    exit 1
}

$dest = Join-Path $JobDir $Name
if (Test-Path $dest) { Write-Host "REFUSED: $Name already exists in the job; move it aside first"; exit 1 }
Move-Item -LiteralPath $src -Destination $dest -Force
Write-Host ("OK {0}  {1}x{2} ratio={3}  {4} bytes" -f $Name, $w, $h, $ratio, (Get-Item $dest).Length)
exit 0
