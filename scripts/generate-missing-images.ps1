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
    [switch]$QaOnly,
    [switch]$SkipPublicSite,
    [string]$RootOverride = ""
)

$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = if ($RootOverride) { [IO.Path]::GetFullPath($RootOverride) } else { Split-Path -Parent $PSScriptRoot }
$executingCheckout = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$requestedContractRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
if (-not $executingCheckout.Equals($requestedContractRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $fixtureRoot = $requestedContractRoot + '\'
    if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or -not $fixtureRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        [Console]::Error.WriteLine("BLOCKED production contract: RootOverride does not match the executing scripts checkout.")
        exit 1
    }
}
. (Join-Path $PSScriptRoot "_production-contract.ps1")
$productionContract = Test-CleanProductionContract -Root $root
if (-not $productionContract.ok) {
    [Console]::Error.WriteLine("BLOCKED production contract before image generation: $($productionContract.reason). No Codex, image write, visual QA, or public-site generation was run.")
    exit 1
}
$ProductionContractVerified = $true

function Write-Step([string]$m) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    if ($LogFile) { $line | Out-File -FilePath $LogFile -Append -Encoding utf8 }
}

function Write-CapturedOutput([object[]]$Output, [string]$LogPath) {
    if ($LogPath) { @($Output) | Out-File -FilePath $LogPath -Append -Encoding utf8 }
    else { @($Output) | ForEach-Object { Write-Host $_ } }
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
    if ($group.Count -lt 2) { return $true }
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
        return $true
    }

    # visualQaCli is deliberately preparation/evaluation only.  It must never
    # select PATH python/ffmpeg or an APPDATA Codex trampoline.  Refuse before
    # even creating QA artifacts when either immutable child runtime is absent.
    if (-not (Resolve-TrustedProductionFfmpegExecutable -Root $RootPath)) {
        [Console]::Error.WriteLine("BLOCKED carousel visual QA: trusted allowlisted ffmpeg runtime could not be established. No QA child or public-site action was run.")
        return $false
    }
    if (-not (Resolve-TrustedProductionCodexExecutable -Root $RootPath)) {
        [Console]::Error.WriteLine("BLOCKED carousel visual QA: trusted immutable Codex runtime could not be established. No QA child or public-site action was run.")
        return $false
    }
    if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "carousel visual QA prepare")) { return $false }

    Write-Step "Carousel visual-qa (warning) for slot $Slot"
    try {
        $prepareOut = @(Invoke-TrustedProductionTsx -Root $RootPath $cli --carousel --prepare --dir $assetDir --slot $Slot --topic-file $topicFile --out $outPath --date $Date 2>&1)
        $prepareExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "after carousel visual QA prepare")) { return $false }
        if ($prepareExit -ne 0) {
            Write-Step "Carousel visual-qa script error for slot $Slot (warning mode continues)."
            Write-CapturedOutput -Output $prepareOut -LogPath $LogFile
            return $true
        }

        $qaDir = Join-Path $RootPath "output\visual-qa\carousel\$Date\slot-$pad"
        $promptPath = Join-Path $qaDir "judge-prompt.txt"
        $stdoutPath = Join-Path $qaDir "judge-stdout.txt"
        $sidecarPath = Join-Path $qaDir "sidecar.json"
        $judgeImages = @(Get-ChildItem -LiteralPath $qaDir -Filter "*.png" -File -ErrorAction SilentlyContinue | Sort-Object Name)
        if (-not (Test-Path -LiteralPath $promptPath) -or -not (Test-Path -LiteralPath $sidecarPath) -or $judgeImages.Count -ne $group.Count) {
            Write-Step "Carousel visual-qa preparation did not produce the expected canaries for slot $Slot (warning mode continues)."
            Write-CapturedOutput -Output $prepareOut -LogPath $LogFile
            return $true
        }

        $prompt = [IO.File]::ReadAllText($promptPath, [Text.UTF8Encoding]::new($false))
        if ($prompt -match "Generate exactly|Use the built-in image model") {
            throw "QA prompt contains image-generation language; refusing to call Codex."
        }
        $codexArgs = @("exec", "-C", $RootPath, "-s", "read-only")
        foreach ($judgeImage in $judgeImages) { $codexArgs += @("-i", $judgeImage.FullName) }
        $codexArgs += "-"
        $judgeOut = @(Invoke-TrustedProductionCodex -Root $RootPath -StandardInput $prompt @codexArgs 2>&1)
        $judgeExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "after carousel visual QA judge")) { return $false }
        if ($judgeExit -ne 0) {
            Write-Step "Carousel visual-qa judge error for slot $Slot (warning mode continues)."
            Write-CapturedOutput -Output $judgeOut -LogPath $LogFile
            return $true
        }
        [IO.File]::WriteAllText($stdoutPath, ((@($judgeOut) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
        if (-not (Test-Path -LiteralPath $stdoutPath) -or (Get-Item -LiteralPath $stdoutPath).Length -eq 0) {
            Write-Step "Carousel visual-qa judge wrote no stdout for slot $Slot (warning mode continues)."
            return $true
        }

        $promptHash = (Get-FileHash -LiteralPath $promptPath -Algorithm SHA256).Hash.ToLowerInvariant()
        $evaluateOut = @(Invoke-TrustedProductionTsx -Root $RootPath $cli --carousel --evaluate --stdout-file $stdoutPath --sidecar $sidecarPath --qa-dir $qaDir --prompt-hash $promptHash --run-id "carousel-$Date-slot-$pad" 2>&1)
        $evaluateExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "after carousel visual QA evaluation")) { return $false }
        if ($evaluateExit -ne 0) {
            Write-CapturedOutput -Output $evaluateOut -LogPath $LogFile
            Write-Step "Carousel visual-qa.json write failed for slot $Slot (warning mode continues)."
            return $true
        }
        $recordLines = @($evaluateOut | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith("{") })
        if ($recordLines.Count -ne 1) {
            Write-CapturedOutput -Output $evaluateOut -LogPath $LogFile
            Write-Step "Carousel visual-qa returned no unambiguous record for slot $Slot (warning mode continues)."
            return $true
        }
        try {
            $record = $recordLines[0] | ConvertFrom-Json
            foreach ($required in @("verdict", "fail_class", "prompt_hash", "run_id", "slides")) {
                if ($record.PSObject.Properties.Name -notcontains $required) { throw "record is missing $required" }
            }
            if ($record.prompt_hash -cne $promptHash -or $record.run_id -cne "carousel-$Date-slot-$pad") {
                throw "record binding does not match the prepared prompt/run"
            }
        } catch {
            Write-CapturedOutput -Output $evaluateOut -LogPath $LogFile
            Write-Step "Carousel visual-qa returned an invalid record for slot $Slot (warning mode continues)."
            return $true
        }
        if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "carousel visual QA record write")) { return $false }
        [IO.File]::WriteAllText($outPath, ($recordLines[0].Trim() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
        Write-CapturedOutput -Output $evaluateOut -LogPath $LogFile
        if (-not (Test-Path -LiteralPath $outPath)) {
            Write-Step "Carousel visual-qa.json write failed for slot $Slot (warning mode continues)."
            return $true
        }
        Write-Step "Carousel visual-qa wrote $outPath (warning mode; publish is not blocked)"
        return $true
    } catch {
        if (-not (Assert-CleanProductionContractBeforeAction -Root $RootPath -Stage "after carousel visual QA failure")) { return $false }
        Write-Step "Carousel visual-qa script error for slot $Slot (warning mode continues)."
        return $true
    }
}

function Ensure-CarouselVisualQa($Items, [string]$RootPath, [string]$Date, [string]$LogFile) {
    foreach ($slotNum in 1, 2, 3) {
        if (-not (Test-CarouselSlotComplete $Items $slotNum $RootPath)) { continue }
        $pad = "{0:d2}" -f $slotNum
        $qaPath = Join-Path $RootPath "docs\assets\$Date\slot-$pad.visual-qa.json"
        if (Test-Path -LiteralPath $qaPath) { continue }
        if (-not (Invoke-CarouselVisualQaWarning -Date $Date -Slot $slotNum -Items $Items -RootPath $RootPath -LogFile $LogFile)) {
            return $false
        }
    }
    return $true
}

$manifestPath = Join-Path $root "data\image-prompts\$Date.json"
if ($QaOnly) {
    if (-not (Test-Path $manifestPath)) {
        Write-Step "No image manifest for $Date; skip carousel visual-qa."
        exit 0
    }
    $qaManifest = [IO.File]::ReadAllText($manifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
    $qaItems = if ($qaManifest -is [array]) { $qaManifest } else { $qaManifest.items }
    if (Ensure-CarouselVisualQa $qaItems $root $Date $LogFile) { exit 0 }
    exit 1
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
$listOut = @(Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --list-missing --date $Date 2>&1)
$listExit = $LASTEXITCODE
if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "after image inventory")) { exit 1 }
Write-CapturedOutput -Output $listOut -LogPath $LogFile
if ($listExit -ne 0) {
    Write-Step "list-missing failed for $Date (exit $listExit); refusing image generation and public-site work."
    exit 1
}

$listText = (@($listOut) | ForEach-Object { "$_" }) -join [Environment]::NewLine
$alreadyPresentLine = "Every image for $Date was already present."
$zeroMissing = $listText.Contains($alreadyPresentLine)
$hasMissingReport = $listText -match "calendar image\(s\) missing"

$codex = $null
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
    if (-not $codex) { $codex = Resolve-TrustedProductionCodexExecutable -Root $root }
    if (-not $codex) {
        Write-Step "trusted Codex executable could not be established."
        exit 1
    }
    $codexOut = @(Invoke-TrustedProductionCodex -Root $root -StandardInput $prompt exec -C $root -s read-only - 2>&1)
    $codexExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "after image generation")) { exit 1 }
    Write-CapturedOutput -Output $codexOut -LogPath $LogFile
    if ($codexExit -ne 0) {
        Write-Step "Codex image generation failed for slot $($item.slot) (exit $codexExit)."
        exit 1
    }

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

    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "generated image write")) { exit 1 }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $image.FullName $target -Force
    Write-Step "Saved slot $($item.slot)."

    # A carousel slot has one record per slide, so the path identifies which
    # image was just written. Marking by slot alone left three of four slides
    # of every carousel without a source record, which the publish gate reads
    # as an unverified image.
    $markOut = @(Invoke-TrustedProductionNpm -Root $root run mark-image-source -- --date $Date --slot $($item.slot) --path $($item.target_path) --source gpt-image-2 2>&1)
    $markExit = $LASTEXITCODE
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "after image source record")) { exit 1 }
    Write-CapturedOutput -Output $markOut -LogPath $LogFile
    if ($markExit -ne 0) {
        Write-Step "mark-image-source failed for slot $($item.slot) (exit $markExit)."
        exit 1
    }
    $generated += 1
    $slotNum = [int]$item.slot
    if (Test-CarouselSlotComplete $items $slotNum $root) {
        if (-not (Invoke-CarouselVisualQaWarning -Date $Date -Slot $slotNum -Items $items -RootPath $root -LogFile $LogFile)) { exit 1 }
    }
}

if ($generated -gt 0) {
    Write-Step "Generated $generated image(s) for $Date."
}
}

if (-not (Ensure-CarouselVisualQa $items $root $Date $LogFile)) { exit 1 }

$siteDeferred = $false
$siteExit = 0
if ($SkipPublicSite) {
    $siteDeferred = $true
    Write-Step "Public-site generation deferred to the guarded publication stage."
} else {
    $approval = Test-PublicPublicationApproval -Root $root -Date $Date
    if (-not $approval.ok) {
        $siteDeferred = $true
        Write-Step "Public-site generation blocked: $($approval.reason). $($approval.gaps -join ' | ')"
    } else {
        $siteOut = @(Invoke-TrustedProductionNpm -Root $root run generate-public-site 2>&1)
        $siteExit = $LASTEXITCODE
        if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "after public-site generation")) { exit 1 }
        Write-CapturedOutput -Output $siteOut -LogPath $LogFile
        if ($siteExit -ne 0) { Write-Step "generate-public-site failed (exit $siteExit)." }
    }
}
$valOut = @(Invoke-TrustedProductionNpm -Root $root run validate-publishable-images -- --date $Date 2>&1)
$valExit = $LASTEXITCODE
if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "after publishable-image validation")) { exit 1 }
$ok = ($valExit -eq 0)
Write-CapturedOutput -Output $valOut -LogPath $LogFile
if (-not $ok) { Write-Step "validate-publishable-images failed (exit $valExit)." }

if ($ok -and $siteExit -eq 0) {
    if ($siteDeferred) { Write-Step "All publishable images for $Date are ready locally; public-site generation is deferred or blocked pending approval." }
    else { Write-Step "All publishable images for $Date are ready." }
    exit 0
}
Write-Step "Images for $Date are still incomplete."
exit 1
