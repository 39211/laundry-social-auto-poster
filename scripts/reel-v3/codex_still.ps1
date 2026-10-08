# Generate one shot's still through Codex instead of the browser session.
#
# 2026-09-14. The owner's Codex quota came back, and "生圖一律 Codex" has been the
# standing rule since 2026-09-10. The browser route works but costs a manual
# cycle per shot; this film has twenty-six of them.
#
# The prompt and the reference images come from the job's own files, never from
# anything typed at the call site: prompts/shots-revised.json holds the text that
# passed the deterministic gate, and prompts/reference-map.json holds which
# anchors each shot is conditioned on.
#
# Two things are copied from scripts/generate-missing-images.ps1 because they
# were each earned:
#   * `-c 'windows.sandbox="unelevated"'` -- the elevated sandbox's own account
#     can no longer decrypt the credential store (NTE_BAD_KEY_STATE), so every
#     run stalls without this.
#   * the reference wording that names the attachment as an IDENTITY chart and
#     disowns it as a COMPOSITION -- without the second half Codex returns a
#     near-duplicate of the reference instead of a new frame.
#
# Usage: codex_still.ps1 -JobDir <dir> -Id a02-unwrap

param(
    [Parameter(Mandatory = $true)][string]$JobDir,
    [Parameter(Mandatory = $true)][string]$Id,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = "C:\Users\cyc39\laundry-repo"
$codex = (Get-Command codex -ErrorAction Stop).Source

$dest = Join-Path $JobDir "$Id.png"
if ((Test-Path $dest) -and -not $Force) { Write-Host "EXISTS $dest"; exit 0 }

$shots = Get-Content (Join-Path $JobDir "prompts\shots-revised.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$shot = $shots | Where-Object { $_.id -eq $Id }
if (-not $shot) { Write-Host "NO SUCH SHOT: $Id"; exit 1 }

$map = Get-Content (Join-Path $JobDir "prompts\reference-map.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# An EMPTY list is a deliberate "this shot has no anchor": the first shot of a
# film defines the object and has nothing to be conditioned on. A MISSING key is
# still an error. PowerShell treats @() as falsy, so the two can only be told
# apart by asking whether the property exists, not whether it is truthy.
if ($map.shots.PSObject.Properties.Name -notcontains $Id) {
    Write-Host "NO REFERENCE ENTRY FOR $Id"; exit 1
}
$keys = @($map.shots.$Id)

$imgArgs = @()
foreach ($k in $keys) {
    $rel = $map._anchors.$k
    if (-not $rel) { Write-Host "NO ANCHOR NAMED $k"; exit 1 }
    $p = Join-Path $root ($rel -replace "/", "\")
    if (-not (Test-Path $p)) { Write-Host "REFERENCE MISSING: $p"; exit 1 }
    $imgArgs += @("-i", $p)
}

$refIntro = "IDENTITY REFERENCE: the attached photographs show the exact same people, the exact same pair of shoes and the exact same room as the picture you are about to make, photographed moments earlier by the same person. " +
"COPY FROM THEM: each person's face, build and clothing; the shoes' shape, colour, material, weave and where the dirt sits; the room -- the same counter surface, the same bench, the same background objects in the same positions, the same light. " +
"If the written description below and an attached photograph disagree about what something looks like, the photograph wins. " +
"DO NOT COPY FROM THEM: the camera position, the lens distance, the crop, how large anything sits in the frame, which way anything faces, or where the hands are. " +
"This is a different photograph of the same people and objects taken at a different moment, not a re-render of an attached one. Follow the CAMERA and framing lines below exactly and let them override the attached framing.`n`n"

# With no attachments this preamble is a lie, and Codex correctly refuses: asked
# for the first shot of a film with zero references, it answered "there is no
# image attachment, please re-attach the reference photo" and produced nothing.
# A shot that defines the object has no anchor, so it gets no preamble either.
if ($imgArgs.Count -eq 0) { $refIntro = "" }

$body = $shot.still_prompt

$prompt = @"
Generate exactly one image from the prompt below using the built-in image model. Do not read any workspace file and do not run any shell command; the local sandbox cannot decrypt and will only stall you. Leave the image in your own output directory and report its filename.

$refIntro$body
"@

Write-Host ("SHOT      {0}" -f $Id)
Write-Host ("REFS      {0}" -f ($imgArgs.Count / 2))
Write-Host ("PROMPT    {0} chars" -f $prompt.Length)

$attemptStart = Get-Date
# NO 2>&1 here. PowerShell 5.1 wraps a native command's stderr lines in
# ErrorRecords, and codex writes "Reading prompt from stdin..." to stderr as
# a progress line -- with $ErrorActionPreference = "Stop" that harmless line
# terminated the whole script while codex itself was fine.
$ErrorActionPreference = "Continue"
$codexOut = $prompt | & $codex exec -C $root -s read-only -c 'windows.sandbox="unelevated"' @imgArgs -
$ErrorActionPreference = "Stop"
$codexOut | Select-Object -Last 6 | ForEach-Object { Write-Host ("  codex| {0}" -f $_) }

$session = Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $session) { Write-Host "NO GENERATED_IMAGES SESSION DIRECTORY"; exit 1 }
$candidate = Get-ChildItem $session.FullName -File |
    Where-Object { $_.LastWriteTime -ge $attemptStart } |
    Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $candidate) { Write-Host "CODEX PRODUCED NO NEW FILE in $($session.FullName)"; exit 1 }

# The aspect ratio is the one thing Codex gets wrong at random: the same text
# produced 4:5 fifteen times and 3:4 twice on 2026-09-10. Refuse rather than
# quietly accept a frame that will letterbox in a 9:16 reel.
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($candidate.FullName)
$w = $img.Width; $h = $img.Height; $img.Dispose()
$ratio = [math]::Round($w / $h, 4)
Write-Host ("RESULT    {0}  {1}x{2}  ratio={3}" -f $candidate.Name, $w, $h, $ratio)
if ([math]::Abs($ratio - 0.5625) -gt 0.02) {
    $rej = Join-Path $JobDir "rejected"
    if (-not (Test-Path $rej)) { New-Item -ItemType Directory -Path $rej | Out-Null }
    Copy-Item $candidate.FullName (Join-Path $rej "$Id-wrong-aspect-$ratio.png") -Force
    Write-Host "ASPECT REFUSED: wanted 0.5625 +/-0.02; kept the frame under rejected/ for the record"
    exit 2
}

Copy-Item $candidate.FullName $dest -Force
Write-Host ("OK        {0}  ({1} bytes)" -f $dest, (Get-Item $dest).Length)
exit 0
