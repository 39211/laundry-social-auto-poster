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
    $codexOut = $prompt | & $codex exec -C $root -s read-only - 2>&1
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
    if (-not $image) {
        $codexTail = @($codexOut | Select-Object -Last 20) -join " | "
        Write-Step "Codex returned no new image for slot $($item.slot). Codex said: $codexTail"
        exit 1
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $image.FullName $target -Force
    Write-Step "Saved slot $($item.slot)."

    # A carousel slot has one record per slide, so the path identifies which
    # image was just written. Marking by slot alone left three of four slides
    # of every carousel without a source record, which the publish gate reads
    # as an unverified image.
    Push-Location $root
    $markOut = cmd /c "npm.cmd run mark-image-source -- --date $Date --slot $($item.slot) --path $($item.target_path) --source gpt-image-2 2>&1"
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
