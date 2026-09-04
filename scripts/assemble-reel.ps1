# Joins one concept's before and after clips into a finished Reel.
#
# Acts are butted together with a HARD CUT. They used to be crossfaded, on the
# theory that a dissolve would hide the colour/shadow drift between two separate
# generations. It did not hide it -- it made something worse and invisible to
# every gate we had. An xfade between two clips of the same subject in the same
# scene renders the object semi-transparent for the length of the dissolve: at
# 2026-08-29 review, leather-shoe-rain showed a full ghost shoe at 4.63-4.88s
# with the shop's hanging garments visible straight through the leather, and
# backpack-base showed the identical defect at the same offset. Every 10s reel
# built by this script carried it.
#
# Why nothing caught it: ffmpeg's scene-change score peaked at 0.048 across the
# whole clip (threshold is normally 0.3), so cut detection is blind to a
# same-scene dissolve, and the 4-frame story QA samples straddled the seam
# window without landing in it. Do not reintroduce a dissolve to "smooth" a
# colour mismatch; fix the mismatch in the per-channel gains instead.
#
# This also matches the owner's 2026-08-27 ruling: single take, no concat
# seams -- a seam reads as "not smooth" to the viewer.
#
# Subtitles are burned in because more than 40% of viewers watch muted: the hook
# has to land in the first two seconds without sound, and the closing line has
# to carry the call to action on its own.
param(
    [Parameter(Mandatory = $true)][string]$ConceptId,
    [Parameter(Mandatory = $true)][string]$Hook,
    [Parameter(Mandatory = $true)][string]$Close,
    [string]$Run = "C:\Users\cyc39\Documents\New project 5\output\reels-run\2026-07-29",
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
$assembledAt = Get-Date
if (Test-Path $out) { Remove-Item $out -Force }

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

# With a hard cut the finished length is just the sum of the acts, but the acts
# are model output and are not exactly 5s each, so it is measured rather than
# assumed. The old constants (9.67 / 15.0 - 2*Dissolve) only ever matched the
# crossfade arithmetic; carrying them into a concat would truncate the video
# against a too-short audio bed via -shortest.
function Get-ClipDuration {
    param([string]$Path)
    $raw = & ffprobe -v error -show_entries format=duration -of csv=p=0 $Path
    if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "ffprobe could not read duration: $Path" }
    return [double]::Parse(([string]$raw).Trim(), [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-DrawText {
    param([string]$Text, [double]$From, [double]$To, [int]$Y)
    $escaped = $Text.Replace("\", "\\").Replace(":", "\:").Replace("'", "\'")
    $size = [Math]::Min(52, [Math]::Floor($MaxTextWidth / $Text.Length))
    return "drawtext=fontfile='$FontFile':text='$escaped':fontsize=$($size):fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=$($Y):enable='between(t,$From,$To)'"
}

# Instagram draws its own chrome over the top of a Reel, so a subtitle at y=120
# sat under it. 200 keeps the line in the upper third and clear of the overlay.
if ($threeAct) {
    # Hard cut: finished length is the three acts end to end.
    $totalDur = (Get-ClipDuration $before) + (Get-ClipDuration $middle) + (Get-ClipDuration $after)
    $closeFrom = [Math]::Max(0.0, $totalDur - 3.2)
    $hookText = Get-DrawText -Text $Hook -From 0 -To 2.6 -Y 200
    $closeText = Get-DrawText -Text $Close -From $closeFrom -To $totalDur -Y 200
    $filter = @"
[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v0];
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v1];
[2:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v2];
[v0][v1][v2]concat=n=3:v=1:a=0[vx];
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
    # Hard cut: finished length is the two acts end to end.
    $totalDur = (Get-ClipDuration $before) + (Get-ClipDuration $after)
    $closeFrom = [Math]::Max(0.0, $totalDur - 3.2)
    $hookText = Get-DrawText -Text $Hook -From 0 -To 2.6 -Y 200
    $closeText = Get-DrawText -Text $Close -From $closeFrom -To $totalDur -Y 200

    # The per-channel gains pull the after stream's exposure onto the before
    # stream's. That correction is now the ONLY thing reconciling the two acts;
    # there is no dissolve behind it to blur a bad match, so a visible jump in
    # brightness at the cut means the measured gains are wrong, not that the
    # cut needs softening.
    $audioDur = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $totalDur)
    $filter = @"
[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1[v0];
[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,colorchannelmixer=rr=$($GainR):gg=$($GainG):bb=$($GainB)[v1];
[v0][v1]concat=n=2:v=1:a=0[vx];
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
            -f lavfi -t $audioDur -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -i $NarrationFile `
            -filter_complex "$filter;$audioGraph" -map "[vout]" -map "[aout]" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    } else {
        & ffmpeg -v error -y -i $before -i $after `
            -f lavfi -t $audioDur -i "anoisesrc=colour=brown:amplitude=0.02:seed=7" `
            -filter_complex $filter -map "[vout]" -map "2:a" `
            -af "lowpass=f=350,volume=0.55" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p `
            -c:a aac -ar 48000 -b:a 96k -shortest $out
    }
}

if ($LASTEXITCODE -ne 0) { throw "Assembly ffmpeg failed (exit $LASTEXITCODE) for $ConceptId" }
if (-not (Test-Path $out)) { throw "Assembly produced no file for $ConceptId" }
if ((Get-Item $out).LastWriteTime -lt $assembledAt) { throw "Assembly left stale output for $ConceptId" }

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
