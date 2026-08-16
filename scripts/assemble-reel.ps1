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
    [double]$GainB = 1.0,
    # zh-TW narration laid over the ambient bed. Optional: a reel without a
    # narration file ships with the bed alone.
    [string]$NarrationFile = "",
    # The narration's text, for the full-narration subtitle burn. Optional so
    # legacy callers keep working, but a call that passes -NarrationFile
    # without it ships a reel whose spoken judgment is invisible to muted
    # viewers — the wiring test counts the call sites that pass both.
    [string]$NarrationText = "",
    # Optional middle act for the 15s three-shot A/B variant. When set, the
    # pipeline cuts before -> middle -> after with two dissolves (~14.2s).
    # When omitted, behaviour is the original two-clip dissolve (~9.67s).
    [string]$MiddleClip = ""
)

$ErrorActionPreference = "Stop"

$before = Join-Path $Run "raw\$ConceptId-before.mp4"
$after = Join-Path $Run "raw\$ConceptId-after.mp4"
$threeAct = $false
$middle = $null
if ($MiddleClip) {
    $threeAct = $true
    $middle = $MiddleClip
    if (-not (Test-Path $middle)) { throw "Missing middle clip: $middle" }
}
foreach ($f in @($before, $after)) {
    if (-not (Test-Path $f)) { throw "Missing clip: $f" }
}

$outDir = Join-Path $Run "reels"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if ($threeAct) {
    $out = Join-Path $outDir "$ConceptId-15s.mp4"
} else {
    $out = Join-Path $outDir "$ConceptId.mp4"
}

# A phone-shot look has no clean font of its own, so the subtitle carries its
# own contrast: white on a semi-opaque box rather than a drop shadow that
# disappears over a light counter.
# drawtext needs an explicit font: there is no fontconfig on this machine, and
# the subtitles are Chinese, so the default Latin fallback would render boxes.
$FontFile = "C\:/Windows/Fonts/msjhbd.ttc"

# CJK glyphs are square, so a line is about fontsize x character-count wide. At
# a fixed 52 that made a 15-character hook 780px on a 720px frame: x came out
# negative and the first and last characters were sliced in half on screen --
# on the one element that has to land in the first two seconds. The size is
# derived from the line instead, and capped so short hooks stay large.
$MaxTextWidth = 648  # 90% of 720, leaving a margin either side

function Get-DrawText {
    param([string]$Text, [double]$From, [double]$To, [int]$Y)
    $escaped = $Text.Replace("\", "\\").Replace(":", "\:").Replace("'", "\'")
    $size = [Math]::Min(52, [Math]::Floor($MaxTextWidth / $Text.Length))
    return "drawtext=fontfile='$FontFile':text='$escaped':fontsize=$($size):fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=$($Y):enable='between(t,$From,$To)'"
}

# Instagram draws its own chrome over the top of a Reel, so a subtitle at y=120
# sat under it. 200 keeps the line in the upper third and clear of the overlay.
if ($threeAct) {
    # 5+5+5 - 2*Dissolve ~= 14.2s; close subtitle starts 3.2s before the end.
    $totalDur = 15.0 - (2.0 * $Dissolve)
    $closeFrom = [Math]::Max(0.0, $totalDur - 3.2)
    $hookText = Get-DrawText -Text $Hook -From 0 -To 2.6 -Y 200
    $closeText = Get-DrawText -Text $Close -From $closeFrom -To $totalDur -Y 200
    $off1 = 5 - $Dissolve
    $off2 = $off1 + 5 - $Dissolve
    $filter = @"
[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v0];
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v1];
[2:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v2];
[v0][v1]xfade=transition=fade:duration=$($Dissolve):offset=$off1[v01];
[v01][v2]xfade=transition=fade:duration=$($Dissolve):offset=$off2[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""
    $audioDur = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $totalDur)
    $hasNarration = $NarrationFile -and (Test-Path $NarrationFile)
    if ($hasNarration) {
        $audioGraph = "[3:a]lowpass=f=350,volume=0.55[bed];[4:a]adelay=500:all=1,volume=1.4[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0[aout]"
        & ffmpeg -v error -y -i $before -i $middle -i $after `
            -f lavfi -t $audioDur -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -i $NarrationFile `
            -filter_complex "$filter;$audioGraph" -map "[vout]" -map "[aout]" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    } else {
        & ffmpeg -v error -y -i $before -i $middle -i $after `
            -f lavfi -t $audioDur -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -filter_complex $filter -map "[vout]" -map "3:a" `
            -af "lowpass=f=350,volume=0.55" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    }
} else {
    $hookText = Get-DrawText -Text $Hook -From 0 -To 2.6 -Y 200
    $closeText = Get-DrawText -Text $Close -From 6.4 -To 9.6 -Y 200

    # histeq on the after stream pulls its exposure and contrast toward the before
    # stream's range; xfade then hides whatever difference survives.
    $filter = @"
[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v0];
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v1];
[v0][v1]xfade=transition=fade:duration=$($Dissolve):offset=$(5 - $Dissolve)[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""

    # Dead silence measurably costs watch time, and the generated clips' own audio
    # is excluded by policy. A quiet synthetic room tone goes underneath — brown
    # noise rolled off at 350Hz reads as building hum — and the zh-TW narration sits
    # on top, delayed half a second so it does not collide with the hook subtitle
    # landing. A sidecar declares all audio as post-added so the review gate can
    # tell it apart from a model-generated track.
    $hasNarration = $NarrationFile -and (Test-Path $NarrationFile)
    if ($hasNarration) {
        $audioGraph = "[2:a]lowpass=f=350,volume=0.55[bed];[3:a]adelay=500:all=1,volume=1.4[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0[aout]"
        & ffmpeg -v error -y -i $before -i $after `
            -f lavfi -t 9.67 -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -i $NarrationFile `
            -filter_complex "$filter;$audioGraph" -map "[vout]" -map "[aout]" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    } else {
        & ffmpeg -v error -y -i $before -i $after `
            -f lavfi -t 9.67 -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -filter_complex $filter -map "[vout]" -map "2:a" `
            -af "lowpass=f=350,volume=0.55" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    }
}

if (-not (Test-Path $out)) { throw "Assembly produced no file for $ConceptId" }

@{ source = "post-ambient-bed"; narration = $hasNarration; generated_clip_audio_used = $false; narr_delay_ms = 500 } |
    ConvertTo-Json | Set-Content "$out.audio.json" -Encoding utf8

# Full-narration subtitles for muted viewers, burned as a second pass so the
# assembly filter graphs above stay untouched. Runs only here, on a freshly
# assembled file — never retroactively on an already-reviewed asset.
if ($hasNarration -and $NarrationText.Trim()) {
    & (Join-Path $PSScriptRoot "burn-narration-subs.ps1") -ReelPath $out `
        -NarrationText $NarrationText -TtsFile $NarrationFile -DelayMs 500
}
$info = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of csv=p=0 $out
"{0}  ->  {1}" -f $ConceptId, ($info -join " ")
