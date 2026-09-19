# Take the still the browser just downloaded and put it in the job, or refuse.
#
# 2026-09-12. The stills for the 2026-09-15 reel are being generated in the
# owner's own ChatGPT session (gpt-image-2.5) because agy is out of quota and
# Codex is out until 09-15. The browser pane writes a blob download into
# Downloads as a .tmp with no extension and no real name, so this claims the
# newest one, proves it is actually a PNG of the right shape, and only then
# moves it into the job directory.
#
# Refusing is the point. A wrong-shaped still is worth more as a stop than as a
# file: 2026-09-11 an image backend silently fell back to 3:4 on a 4:5 pipeline
# and only an aspect gate caught it.
#
# Usage: place-downloaded-still.ps1 -Name shot-04-anchor.png [-MaxAgeMinutes 5]

param(
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$MaxAgeMinutes = 5,
    [string]$JobDir = "C:\Users\cyc39\laundry-repo\output\reel-v3\2026-09-15",
    [double]$TargetRatio = 0.5625,
    [double]$Tolerance = 0.01
)

$ErrorActionPreference = "Stop"

$src = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "*.tmp" -ErrorAction SilentlyContinue |
       Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-$MaxAgeMinutes) } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $src) {
    Write-Host "NO CANDIDATE: no .tmp in Downloads newer than $MaxAgeMinutes minutes"
    exit 1
}

$bytes = [IO.File]::ReadAllBytes($src.FullName)
if ($bytes.Length -lt 8) { Write-Host "TOO SMALL: $($bytes.Length) bytes"; exit 1 }
$sig = ($bytes[0..7] | ForEach-Object { $_.ToString('x2') }) -join ''
if ($sig -ne '89504e470d0a1a0a') {
    Write-Host "NOT A PNG: magic=$sig from $($src.Name)"
    exit 1
}

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($src.FullName)
$w = $img.Width; $h = $img.Height; $img.Dispose()
$ratio = [math]::Round($w / $h, 4)
if ([math]::Abs($ratio - $TargetRatio) -gt $Tolerance) {
    Write-Host "ASPECT REFUSED: ${w}x${h} ratio=$ratio, wanted $TargetRatio +/-$Tolerance"
    exit 1
}

$dest = Join-Path $JobDir $Name
if (Test-Path $dest) {
    Write-Host "REFUSED: $Name already exists; move it aside first so nothing is overwritten by accident"
    exit 1
}
Move-Item -LiteralPath $src.FullName -Destination $dest -Force
Write-Host ("OK {0}  {1}x{2} ratio={3}  {4} bytes" -f $Name, $w, $h, $ratio, (Get-Item $dest).Length)
exit 0
