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
    $plain = " PLAIN OBJECT RULE: the featured object is completely plain: no logos, no brand marks, no logo-like stripes, curves, swooshes or patches, no readable text anywhere on it."
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
    $ask = "Read the file $promptFile. Call your generate_image tool exactly once with Prompt = that file content verbatim, AspectRatio '3:4', ImageName 'laundry_slot_photo'.$refClause Then copy the generated image file to $outFile and reply only with that absolute path and the file size in bytes. Do nothing else."
    $t0 = Get-Date
    $agyOut = & $agy --dangerously-skip-permissions --output-format json --add-dir $work --print=$ask 2>&1
    if ($LogFile) { $agyOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    $secs = [int]((Get-Date) - $t0).TotalSeconds
    if ((Test-Path $outFile) -and (Get-Item $outFile).Length -gt 0) {
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
    $prompt = @"
Generate exactly one image from the prompt below using the built-in image model. Do not read any workspace file and do not run any shell command; the local sandbox cannot decrypt and will only stall you. Leave the image in your own output directory and report its filename.

$($item.prompt)
"@

    $before = Get-Date
    # DPAPI root-fix (2026-08-22): codex's Windows "elevated" sandbox depends on
    # two dedicated local accounts whose stored credentials this machine's DPAPI
    # can no longer decrypt (CryptUnprotectData / NTE_BAD_KEY_STATE) -- switching
    # to the "unelevated" sandbox mode uses the current login's own restricted
    # token instead, sidestepping that broken credential store entirely.
    $codexOut = $prompt | & $codex exec -C $root -s read-only -c 'windows.sandbox="unelevated"' - 2>&1
    if ($LogFile) { $codexOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    else { $codexOut | ForEach-Object { Write-Host $_ } }

    $session = Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $image = $null
    if ($session) {
        $image = Get-ChildItem $session.FullName -File |
            Where-Object { $_.LastWriteTime -ge $before } |
            Sort-Object LastWriteTime | Select-Object -Last 1
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
    Write-Step "Saved slot $($item.slot) from $source."

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
