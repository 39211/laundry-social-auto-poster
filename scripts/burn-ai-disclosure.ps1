# Burns the "AI 情境演示" disclosure label into a finished video.
#
# Red line #4 of luxury_restoration_ai_video_master_plan.md: no generated
# footage may be published without this label. The label is persistent rather
# than a title card on purpose -- viewers scrub, platforms auto-clip for
# previews, and people re-share fragments; a label that only appears in the
# first two seconds is absent for everyone who arrives any other way.
#
# Placement is top-left under the safe-area margin so it never collides with
# the centered工法 title cards (y=200) or platform UI at the bottom.
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$Label = "AI 情境演示",
    [int]$FontSize = 40
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

if (-not (Test-Path -LiteralPath $InputPath)) { throw "Input video not found: $InputPath" }

# Same escaping and font the reel assembler uses: no fontconfig on this
# machine, so the font file must be spelled out, and the drive colon has to be
# escaped for the filter parser.
$FontFile = "C\:/Windows/Fonts/msjhbd.ttc"

# ffmpeg's drawtext with a CJK literal goes through the filter parser, and any
# stray quote or colon there is a parse error rather than a visible mistake.
# Passing the text through a UTF-8 file with textfile= avoids the whole class.
$textFile = Join-Path ([IO.Path]::GetTempPath()) ("ai-disclosure-" + [Guid]::NewGuid().ToString("N") + ".txt")
[IO.File]::WriteAllText($textFile, $Label, [Text.UTF8Encoding]::new($false))
$escapedTextFile = $textFile.Replace("\", "/").Replace(":", "\:")

try {
    $draw = "drawtext=fontfile='$FontFile':textfile='$escapedTextFile':fontsize=$($FontSize):fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=14:x=48:y=64"

    # Re-encode at CRF 19 to match the pipeline's masters; audio is copied so
    # the narration and ambient bed are bit-identical to what was reviewed.
    & ffmpeg -y -v error -i $InputPath -vf $draw -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p `
        -c:a copy -movflags +faststart $OutputPath
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed with exit code $LASTEXITCODE" }
} finally {
    Remove-Item -LiteralPath $textFile -Force -ErrorAction SilentlyContinue
}

$inDur = & ffprobe -v error -show_entries format=duration -of csv=p=0 $InputPath
$outDur = & ffprobe -v error -show_entries format=duration -of csv=p=0 $OutputPath
Write-Host "Burned '$Label' into $OutputPath (in=${inDur}s out=${outDur}s)"
