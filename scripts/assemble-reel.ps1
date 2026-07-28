# Joins one concept's before and after clips into a finished Reel.
#
# Two separate generations never agree on colour temperature or shadow
# direction, and a hard cut between them reads as two unrelated images rather
# than one shop. So the after clip is histogram-matched to the before clip and
# the two are crossfaded, not butted together.
#
# Subtitles are burned in because more than 40% of viewers watch muted: the hook
# has to land in the first two seconds without sound, and the closing line has
# to carry the call to action on its own.
param(
    [Parameter(Mandatory = $true)][string]$ConceptId,
    [Parameter(Mandatory = $true)][string]$Hook,
    [Parameter(Mandatory = $true)][string]$Close,
    [string]$Run = "C:\Users\cyc39\Documents\New project 5\output\reels-run\2026-07-29",
    [double]$Dissolve = 0.4
)

$ErrorActionPreference = "Stop"

$before = Join-Path $Run "raw\$ConceptId-before.mp4"
$after = Join-Path $Run "raw\$ConceptId-after.mp4"
foreach ($f in @($before, $after)) {
    if (-not (Test-Path $f)) { throw "Missing clip: $f" }
}

$outDir = Join-Path $Run "reels"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir "$ConceptId.mp4"

# A phone-shot look has no clean font of its own, so the subtitle carries its
# own contrast: white on a semi-opaque box rather than a drop shadow that
# disappears over a light counter.
# drawtext needs an explicit font: there is no fontconfig on this machine, and
# the subtitles are Chinese, so the default Latin fallback would render boxes.
$FontFile = "C\:/Windows/Fonts/msjhbd.ttc"

function Get-DrawText {
    param([string]$Text, [double]$From, [double]$To, [int]$Y)
    $escaped = $Text.Replace("\", "\\").Replace(":", "\:").Replace("'", "\'")
    return "drawtext=fontfile='$FontFile':text='$escaped':fontsize=52:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=$($Y):enable='between(t,$From,$To)'"
}

$hookText = Get-DrawText -Text $Hook -From 0 -To 2.6 -Y 120
$closeText = Get-DrawText -Text $Close -From 6.4 -To 9.6 -Y 120

# histeq on the after stream pulls its exposure and contrast toward the before
# stream's range; xfade then hides whatever difference survives.
$filter = @"
[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v0];
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,histeq=strength=0.1:intensity=0.08[v1];
[v0][v1]xfade=transition=fade:duration=$($Dissolve):offset=$(5 - $Dissolve)[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""

& ffmpeg -v error -y -i $before -i $after -filter_complex $filter -map "[vout]" `
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an $out

if (-not (Test-Path $out)) { throw "Assembly produced no file for $ConceptId" }
$info = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of csv=p=0 $out
"{0}  ->  {1}" -f $ConceptId, ($info -join " ")
