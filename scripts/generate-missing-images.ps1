# Generates the images a day's calendar asks for but does not yet have.
#
# Codex cannot write into the workspace from its sandbox on this machine --
# `CryptUnprotectData failed: 2148073483` -- so asking it to save the files
# itself fails and it reports the day as blocked. It can still generate: the
# images land in its own output directory, and this script places them. That is
# the same route the Reel stills already take.
#
# Generation only. Nothing here approves or publishes.
param(
    [Parameter(Mandatory = $true)][string]$Date,
    [string]$LogFile = "",
    [switch]$QaOnly
)

$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$m) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    if ($LogFile) { $line | Out-File -FilePath $LogFile -Append -Encoding utf8 }
}

# Every carousel image the shop has ever published is 1122x1402 -- portrait 4:5,
# which is what Instagram needs every slide of one carousel to share. The prompt
# asks for "one portrait 4:5 photo", but that is a request, not a guarantee:
# 2026-09-10 two of seventeen came back 896x1200 (3:4) from the same prompt text
# that produced 4:5 for the other fifteen. Mixed ratios inside one carousel get
# cropped by the platform, and nothing in the pipeline was looking. This is a
# deterministic check, so it decides on its own rather than asking a model.
# Show-Toast is defined here rather than reused from daily-generate.ps1 because
# this script also runs standalone (-QaOnly, manual backfill). A warning that
# only reaches a log file is not a warning.
function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家圖片生成")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($text)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryImageGen").Show($toast)
    } catch {
        Write-Step ("Toast failed: " + $_.Exception.Message)
    }
}
# Ratio math lives here so PS-layer smoke can invoke it without ffprobe.
# 4:5 ±0.01 is the carousel gate; 3:4 (1080x1440) must stay outside that band
# (2026-09-10: same prompt returned 4:5 fifteen times and 3:4 twice).
function Get-PortraitFourFiveVerdict([double]$Width, [double]$Height) {
    if ($Width -le 0 -or $Height -le 0) { return $null }
    $aspect = 4.0 / 5.0
    return [pscustomobject]@{
        Width = [int]$Width
        Height = [int]$Height
        Ok = ([math]::Abs(($Width / $Height) - $aspect) -le 0.01)
    }
}

function Test-PortraitFourFive([string]$Path) {
    try {
        $probe = & ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $Path 2>$null
        $parts = ("$probe").Trim().Split(",")
        if ($parts.Count -lt 2) { return $null }
        $w = [double]$parts[0]
        $h = [double]$parts[1]
        return Get-PortraitFourFiveVerdict $w $h
    } catch { return $null }
}

function Get-CarouselSlotItems($Items, [int]$Slot) {
    $group = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($Items)) {
        if ([int]$item.slot -eq $Slot) { [void]$group.Add($item) }
    }
    # PS 5.1: @() over a generic List of PSCustomObjects throws
    # "Argument types do not match" (ICollection copy path). ToArray plus the
    # unary comma returns a real array without touching that path.
    # 2026-08-18 06:30 first flight died here silently on every slot.
    return ,($group.ToArray())
}

function Test-CarouselSlotComplete($Items, [int]$Slot, [string]$RootPath) {
    $group = Get-CarouselSlotItems $Items $Slot
    if ($group.Count -lt 2 -or $group.Count -gt 4) { return $false }
    foreach ($item in $group) {
        $target = Join-Path $RootPath (($item.target_path -replace "/", "\"))
        if (-not (Test-Path $target)) { return $false }
    }
    return $true
}

function Invoke-CarouselVisualQaWarning {
    param(
        [string]$Date,
        [int]$Slot,
        $Items,
        [string]$RootPath,
        [string]$LogFile
    )
    $group = Get-CarouselSlotItems $Items $Slot
    if ($group.Count -lt 2) { return }
    $tsx = Join-Path $RootPath "node_modules\.bin\tsx.cmd"
    $cli = Join-Path $RootPath "src\visualQaCli.ts"
    $assetDir = Join-Path $RootPath "docs\assets\$Date"
    $pad = "{0:d2}" -f $Slot
    $outPath = Join-Path $assetDir "slot-$pad.visual-qa.json"
    $topicFile = Join-Path $env:TEMP ("carousel-qa-topic-" + $Date + "-" + $pad + ".txt")
    $topic = [string]$group[0].topic
    try {
        [IO.File]::WriteAllText($topicFile, $topic, [Text.UTF8Encoding]::new($false))
    } catch {
        Write-Step "Carousel visual-qa topic tempfile write failed for slot $Slot (warning mode continues)."
        return
    }
    Write-Step "Carousel visual-qa (warning) for slot $Slot"
    try {
        $qaOut = & $tsx $cli --carousel --dir $assetDir --slot $Slot --topic-file $topicFile --out $outPath --date $Date 2>&1
        if ($LogFile) { $qaOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
        else { $qaOut | ForEach-Object { Write-Host $_ } }
        if ($LASTEXITCODE -ne 0) {
            Write-Step "Carousel visual-qa script error for slot $Slot (warning mode continues)."
        } elseif (-not (Test-Path -LiteralPath $outPath)) {
            Write-Step "Carousel visual-qa.json write failed for slot $Slot (warning mode continues)."
        } else {
            Write-Step "Carousel visual-qa wrote $outPath (warning mode; publish is not blocked)"
        }
    } catch {
        Write-Step "Carousel visual-qa script error for slot $Slot (warning mode continues)."
    }
}

function Ensure-CarouselVisualQa($Items, [string]$RootPath, [string]$Date, [string]$LogFile) {
    foreach ($slotNum in 1, 2, 3) {
        if (-not (Test-CarouselSlotComplete $Items $slotNum $RootPath)) { continue }
        $pad = "{0:d2}" -f $slotNum
        $qaPath = Join-Path $RootPath "docs\assets\$Date\slot-$pad.visual-qa.json"
        if (Test-Path -LiteralPath $qaPath) { continue }
        Invoke-CarouselVisualQaWarning -Date $Date -Slot $slotNum -Items $Items -RootPath $RootPath -LogFile $LogFile
    }
}

# Second supplier (2026-09-05): the Codex image quota is shared with the review
# fleet and ran dry for three days, which is a dark day per missing slot. The
# Antigravity CLI (`agy`, the owner's Google AI Pro login in ~/.gemini) exposes
# a generate_image tool that accepts reference images, so slides 2-4 are drawn
# against the slot's hero to keep one object across the carousel. The prompt is
# the manifest prompt verbatim plus one plain-object clause: the first Google
# test drew a swoosh on the shoes. The record is stamped google-agy-image, which
# the publish gate accepts (src/imageSources.ts), never relabelled as gpt-image-2.
# 2026-09-12: this asked agy for 3:4 while every carousel the shop has ever
# published is 4:5 (1122x1402). It only surfaced today, because the fallback had
# never had to carry a whole slot before -- the Codex image quota ran out until
# 09-15 and all four of today's slot-1 images came back 896x1200, which is 0.75
# and outside Instagram's 0.8 portrait limit. The aspect gate added on 09-11
# caught and reported it; this is the cause it was pointing at.
function Invoke-AgyImageFallback {
    param($Item, $Items, [string]$RootPath, [string]$Date)
    $agy = Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe"
    if (-not (Test-Path $agy)) { Write-Step "agy.exe not found at $agy; no Google fallback."; return $null }
    $work = Join-Path $env:LOCALAPPDATA "laundry-agy\$Date"
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    $name = Split-Path -Leaf ([string]$Item.target_path)
    $outFile = Join-Path $work $name
    if (Test-Path $outFile) { Remove-Item $outFile -Force }
    $promptFile = Join-Path $work ($name -replace '\.png$', '.prompt.txt')
    # The featured-object clause alone is not enough. 2026-09-06: a set whose
    # subject was a plain duvet still shipped a background display case of
    # sneakers wearing a legible swoosh, plus a stray phone screen mirroring the
    # scene and in-focus care labels covered in garbled pseudo-text. The gate
    # cannot see any of that, so it has to be forbidden in the prompt.
    $plain = " PLAIN OBJECT RULE: the featured object is completely plain: no logos, no brand marks, no logo-like stripes, curves, swooshes or patches, no readable text anywhere on it." +
        " BACKGROUND RULE: nothing else in the frame carries a logo or a logo-like curve either. Shoes on shelves, bottles and packaging are plain and unbranded; every label, tag, receipt and sheet of paperwork is out of focus and unreadable; no phone, screen, camera or mirrored copy of this scene appears anywhere in the frame."
    $refClause = ""
    $text = [string]$Item.prompt + $plain
    if ([int]$Item.slide -gt 1) {
        $hero = @($Items | Where-Object { [int]$_.slot -eq [int]$Item.slot -and [int]$_.slide -eq 1 } | Select-Object -First 1)
        if ($hero.Count -gt 0) {
            $heroPath = Join-Path $RootPath (([string]$hero[0].target_path) -replace "/", "\")
            if (Test-Path $heroPath) {
                $text = "Use the attached photo as the reference: it is the exact same object and the exact same counter scene. Keep the object identity, colours, materials, wear marks and the background identical; only change the framing and focus as described below. " + $text
                $refClause = " Pass ImagePaths=['$heroPath'] as the reference image."
            }
        }
    }
    [IO.File]::WriteAllText($promptFile, $text, [Text.UTF8Encoding]::new($false))
    $ask = "Read the file $promptFile. Call your generate_image tool exactly once with Prompt = that file content verbatim, AspectRatio '4:5', ImageName 'laundry_slot_photo'.$refClause Then copy the generated image file to $outFile and reply only with that absolute path and the file size in bytes. Do nothing else."
    $t0 = Get-Date
    $agyOut = & $agy --dangerously-skip-permissions --output-format json --add-dir $work --print=$ask 2>&1
    if ($LogFile) { $agyOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    if ((Test-Path $outFile) -and (Get-Item $outFile).Length -gt 0) {
        # agy writes JPEG bytes under the .png name it was asked for; the approval
        # gate checks the PNG magic ("not a real PNG"), so re-encode unless the
        # bytes already are PNG. 2026-09-05: all eight first-run files were JPEG.
        $head = [IO.File]::ReadAllBytes($outFile)[0..3]
        $isPng = ($head[0] -eq 0x89 -and $head[1] -eq 0x50 -and $head[2] -eq 0x4E -and $head[3] -eq 0x47)
        if (-not $isPng) {
            $raw = Join-Path $work ($name -replace '\.png$', '.raw.jpg')
            Move-Item $outFile $raw -Force
            & ffmpeg -v error -y -i $raw -pix_fmt rgb24 $outFile 2>&1 | Out-Null
            if (-not (Test-Path $outFile)) {
                Write-Step "Google (agy) returned non-PNG bytes for $name and ffmpeg could not re-encode them."
                return $null
            }
        }
        Write-Step "Google (agy) produced $name in ${secs}s."
        return Get-Item $outFile
    }
    $tail = @($agyOut | Select-Object -Last 5) -join " | "
    Write-Step "Google (agy) produced nothing for $name after ${secs}s: $tail"
    return $null
}

$manifestPath = Join-Path $root "data\image-prompts\$Date.json"
if ($QaOnly) {
    if (-not (Test-Path $manifestPath)) {
        Write-Step "No image manifest for $Date; skip carousel visual-qa."
        exit 0
    }
    $qaManifest = [IO.File]::ReadAllText($manifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $qaItems = if ($qaManifest -is [array]) { $qaManifest } else { $qaManifest.items }
    Ensure-CarouselVisualQa $qaItems $root $Date $LogFile
    exit 0
}
if (-not (Test-Path $manifestPath)) {
    Write-Step "No image manifest for $Date; run generate-image-manifest first."
    exit 1
}

# PowerShell 5.1 reads without a BOM as the ANSI codepage, which mangles the
# Chinese in these prompts. The bytes are UTF-8 either way.
$manifest = [IO.File]::ReadAllText($manifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$items = if ($manifest -is [array]) { $manifest } else { $manifest.items }

# Inventory is the calendar (list-missing), not "every manifest target exists".
# A complete-looking manifest with yesterday's two-ruler day used to print
# "already present" while slot 1 and 2 were still missing.
Push-Location $root
$listOut = cmd /c "npm.cmd run generate-image-manifest -- --list-missing --date $Date 2>&1"
$listExit = $LASTEXITCODE
Pop-Location
if ($LogFile) { $listOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
else { $listOut | ForEach-Object { Write-Host $_ } }

$listText = (@($listOut) | ForEach-Object { "$_" }) -join [Environment]::NewLine
$alreadyPresentLine = "Every image for $Date was already present."
$zeroMissing = $listText.Contains($alreadyPresentLine)
$hasMissingReport = $listText -match "calendar image\(s\) missing"

$codex = Join-Path $env:APPDATA "npm\codex.cmd"
$generated = 0

if ($zeroMissing) {
    Write-Step $alreadyPresentLine
} elseif (-not $hasMissingReport) {
    Write-Step "list-missing did not report inventory for $Date (exit $listExit)."
    exit 1
} else {
$missingPaths = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($line in @($listOut)) {
    if ("$line" -match '^\s*-\s+(\S+)\s+\(') {
        [void]$missingPaths.Add(($Matches[1] -replace '\\', '/'))
    }
}

$known = @{}
foreach ($item in $items) {
    $known[(([string]$item.target_path) -replace '\\', '/')] = $true
}
foreach ($missing in $missingPaths) {
    if (-not $known.ContainsKey($missing)) {
        Write-Step "Calendar missing $missing has no manifest prompt; run generate-image-manifest first."
    }
}

foreach ($item in $items) {
    $relNorm = ([string]$item.target_path) -replace '\\', '/'
    if (-not $missingPaths.Contains($relNorm)) { continue }

    $target = Join-Path $root ($item.target_path -replace "/", "\")
    if (Test-Path $target) { continue }

    Write-Step "Generating slot $($item.slot): $($item.target_path)"

    # Identity reference (2026-09-10). Each slide used to be a stateless call
    # that had never seen the other slides, so "keep the exact featured object
    # consistent across all four photos" was an instruction no single call could
    # obey: the carousel judge found a teddy bear on slide 2 of a rabbit
    # carousel (09-14 slot 1) and dress shirts on slides 2-4 of a sofa carousel
    # (09-11 slot 1). codex-cli 0.153.4 takes `-i`, which the agy fallback below
    # has always used as ImagePaths. Verified 2026-09-10 on 09-14 slot 1 slide 2:
    # attaching the hero reproduced the same lop-eared rabbit, same wear, same
    # counter, at a genuinely different angle.
    #
    # The clause is two-sided on purpose. The first version said only "change the
    # framing" and Codex returned a near-duplicate of the hero -- identity
    # perfect, carousel dead. The reference must be named as an identity chart
    # and disowned as a composition.
    $imgArgs = @()
    foreach ($ref in @($item.reference_images)) {
        if (-not $ref) { continue }
        $refPath = Join-Path $root (([string]$ref) -replace "/", "\")
        if (Test-Path $refPath) { $imgArgs += @("-i", $refPath) }
        else { Write-Step "Reference $ref is not on disk; slot $($item.slot) slide $($item.slide) generates without it." }
    }
    $refIntro = ""
    if ($imgArgs.Count -gt 0) {
        $refIntro = "IDENTITY REFERENCE: the attached photograph shows the exact same physical object, on the same counter, in the same room, photographed moments earlier by the same person. " +
            "COPY FROM IT: the object's type and species, its shape and proportions, its colour, its material and surface texture, its seams and trim, its wear marks in the same places on the same parts, its size relative to the counter, and the room around it -- same counter surface, same background objects in the same positions, same light. " +
            "If the written description below and the attached photograph disagree about what the object looks like, the photograph wins. " +
            "DO NOT COPY FROM IT: the camera position, the lens distance, the crop, how large the object sits in the frame, which way the object faces, or where the hand is. " +
            "This is a different photograph of the same object taken a moment later, not a re-render of the attached one: a viewer flicking between the two must immediately see a new angle and a new crop. Follow the COMPOSITION line below exactly and let it override the attached framing.`n`n"
    }

    $prompt = @"
Generate exactly one image from the prompt below using the built-in image model. Do not read any workspace file and do not run any shell command; the local sandbox cannot decrypt and will only stall you. Leave the image in your own output directory and report its filename.

$refIntro$($item.prompt)
"@

    $before = Get-Date
    # DPAPI root-fix (2026-08-22): codex's Windows "elevated" sandbox depends on
    # two dedicated local accounts whose stored credentials this machine's DPAPI
    # can no longer decrypt (CryptUnprotectData / NTE_BAD_KEY_STATE) -- switching
    # to the "unelevated" sandbox mode uses the current login's own restricted
    # token instead, sidestepping that broken credential store entirely.
    if ($imgArgs.Count -gt 0) { Write-Step "Attaching $($imgArgs.Count / 2) reference image(s)." }
    $image = $null
    # Two attempts, because the wrong aspect ratio is a coin flip on the model's
    # side rather than a defect in the prompt: the same text produced 4:5 fifteen
    # times and 3:4 twice on 2026-09-10. Asking again is the whole fix.
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $attemptStart = Get-Date
        $codexOut = $prompt | & $codex exec -C $root -s read-only -c 'windows.sandbox="unelevated"' @imgArgs - 2>&1
        if ($LogFile) { $codexOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
        else { $codexOut | ForEach-Object { Write-Host $_ } }

        $session = Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $candidate = $null
        if ($session) {
            $candidate = Get-ChildItem $session.FullName -File |
                Where-Object { $_.LastWriteTime -ge $attemptStart } |
                Sort-Object LastWriteTime | Select-Object -Last 1
        }
        if (-not $candidate) { break }

        $size = Test-PortraitFourFive $candidate.FullName
        if ($null -eq $size) {
            Write-Step "ffprobe could not measure $($candidate.Name); accepting it rather than discarding a good image."
            $image = $candidate
            break
        }
        if ($size.Ok) { $image = $candidate; break }
        Write-Step "Attempt ${attempt}: Codex returned $($size.Width)x$($size.Height), not portrait 4:5; discarding and asking again."
    }

    # Without the timestamp filter a failed run would silently republish an
    # older image belonging to a different day.
    $source = "gpt-image-2"
    if (-not $image) {
        $codexTail = @($codexOut | Select-Object -Last 20) -join " | "
        Write-Step "Codex returned no new image for slot $($item.slot); trying Google (agy generate_image). Codex said: $codexTail"
        $image = Invoke-AgyImageFallback -Item $item -Items $items -RootPath $root -Date $Date
        if (-not $image) {
            Write-Step "Google fallback also returned no image for slot $($item.slot)."
            exit 1
        }
        $source = "google-agy-image"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $image.FullName $target -Force
    $saved = Test-PortraitFourFive $target
    if ($null -ne $saved -and -not $saved.Ok) {
        # Both suppliers refused to give a 4:5 frame. Say so loudly instead of
        # letting a mixed-ratio carousel reach the platform: the day is still
        # publishable, but a human has to look at this slide.
        Write-Step "WARNING slot $($item.slot) slide $($item.slide) saved at $($saved.Width)x$($saved.Height), NOT portrait 4:5; this carousel will be cropped unevenly."
        Show-Toast "$Date slot $($item.slot) 第 $($item.slide) 張比例不對($($saved.Width)x$($saved.Height)),輪播會被裁切,請看 log。"
    }
    Write-Step "Saved slot $($item.slot) from $source ($(if ($saved) { "$($saved.Width)x$($saved.Height)" } else { 'size unknown' }))."

    # A carousel slot has one record per slide, so the path identifies which
    # image was just written. Marking by slot alone left three of four slides
    # of every carousel without a source record, which the publish gate reads
    # as an unverified image.
    Push-Location $root
    $markOut = cmd /c "npm.cmd run mark-image-source -- --date $Date --slot $($item.slot) --path $($item.target_path) --source $source 2>&1"
    if ($LogFile) { $markOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    else { $markOut | ForEach-Object { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) {
        Write-Step "mark-image-source failed for slot $($item.slot) (exit $LASTEXITCODE)."
    }
    Pop-Location
    $generated += 1
    $slotNum = [int]$item.slot
    if (Test-CarouselSlotComplete $items $slotNum $root) {
        Invoke-CarouselVisualQaWarning -Date $Date -Slot $slotNum -Items $items -RootPath $root -LogFile $LogFile
    }
}

if ($generated -gt 0) {
    Write-Step "Generated $generated image(s) for $Date."
}
}

Ensure-CarouselVisualQa $items $root $Date $LogFile

Push-Location $root
$siteOut = cmd /c "npm.cmd run generate-public-site 2>&1"
$siteExit = $LASTEXITCODE
if ($LogFile) { $siteOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
else { $siteOut | ForEach-Object { Write-Host $_ } }
if ($siteExit -ne 0) { Write-Step "generate-public-site failed (exit $siteExit)." }
$valOut = cmd /c "npm.cmd run validate-publishable-images -- --date $Date 2>&1"
$ok = ($LASTEXITCODE -eq 0)
if ($LogFile) { $valOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
else { $valOut | ForEach-Object { Write-Host $_ } }
if (-not $ok) { Write-Step "validate-publishable-images failed (exit $LASTEXITCODE)." }
Pop-Location

if ($ok) { Write-Step "All publishable images for $Date are ready."; exit 0 }
Write-Step "Images for $Date are still incomplete."
exit 1
