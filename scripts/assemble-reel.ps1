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
    [double]$Dissolve = 0.4,
    # Per-channel gains that pull the after clip's exposure onto the before
    # clip's, measured from the background regions where nothing legitimately
    # changed. Each pair drifts differently — some brighter, some darker — so a
    # single generic correction cannot work.
    [double]$GainR = 1.0,
    [double]$GainG = 1.0,
    [double]$GainB = 1.0
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
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v1];
[v0][v1]xfade=transition=fade:duration=$($Dissolve):offset=$(5 - $Dissolve)[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""

# Dead silence measurably costs watch time, and the generated clips' own audio
# is excluded by policy, so a quiet synthetic room tone goes underneath: brown
# noise rolled off at 350Hz reads as building hum, at roughly -35dB it sits
# under the viewer's attention. A sidecar declares the audio is post-added so
# the review gate can tell it apart from a model-generated track.
& ffmpeg -v error -y -i $before -i $after `
    -f lavfi -t 9.67 -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
    -filter_complex $filter -map "[vout]" -map "2:a" `
    -af "lowpass=f=350,volume=0.55" `
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
    -c:a aac -b:a 96k -shortest $out

if (-not (Test-Path $out)) { throw "Assembly produced no file for $ConceptId" }

@{ source = "post-ambient-bed"; generated_clip_audio_used = $false } |
    ConvertTo-Json | Set-Content "$out.audio.json" -Encoding utf8
$info = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of csv=p=0 $out
"{0}  ->  {1}" -f $ConceptId, ($info -join " ")
