# Story-continuity visual QA for one reel or its reference-photo stills.
# Warning mode: writes <reel>.visual-qa.json and exits 0. Does not block publish.
param(
    [string]$ReelPath = "",
    [switch]$StillsOnly,
    [string]$ConceptId = "",
    [string]$ObjectType = "",
    [string]$QaDir = "",
    [string]$StdoutFile = "",
    [switch]$SkipExtract,
    [switch]$Isolate,
    [switch]$Strict
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $projectRoot "src\visualQaCli.ts"
$ioPy = Join-Path $projectRoot "scripts\visual_qa_io.py"
$codexCmd = Join-Path $env:APPDATA "npm\codex.cmd"

function Invoke-VisualQaCli {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
    $tsx = Join-Path $projectRoot "node_modules\.bin\tsx.cmd"
    $out = & $tsx $cli @CliArgs
    if ($LASTEXITCODE -ne 0) {
        throw "visualQaCli failed ($LASTEXITCODE): $out"
    }
    return $out
}

function Get-RejectedConceptIds {
    $listPath = Join-Path $projectRoot "data\rejected-concepts.json"
    $ids = @(python $ioPy list-rejected $listPath)
    return @($ids | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}

function Test-ConceptRejected([string]$Id) {
    return ((Get-RejectedConceptIds) -contains $Id)
}

function Isolate-FailedReel {
    param(
        [string]$FailedConceptId,
        [string]$FailedObjectType,
        [string]$ForDate = "",
        [string]$Slot = ""
    )
    $planArgs = @("--isolation-plan", "--concept", $FailedConceptId, "--object-type", $FailedObjectType)
    if ($ForDate) { $planArgs += @("--date", $ForDate) }
    if ($Slot) { $planArgs += @("--slot", $Slot) }
    $planJson = Invoke-VisualQaCli @planArgs
    Write-Host "visual-qa isolation plan (warning mode does not move files):"
    Write-Host $planJson
    return $planJson
}

if ($StillsOnly) {
    if (-not $ConceptId -or -not $ObjectType) {
        throw "StillsOnly requires -ConceptId and -ObjectType"
    }
    $stillsJson = Invoke-VisualQaCli --reference-stills --concept $ConceptId --object-type $ObjectType --root $projectRoot
    $stills = $stillsJson | ConvertFrom-Json
    $qaTarget = $QaDir
    if (-not $qaTarget) {
        $qaTarget = Join-Path $projectRoot ("data\visual-qa-fixtures\stills-" + $ConceptId)
    }
    if (Test-Path $qaTarget) { Remove-Item $qaTarget -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $qaTarget | Out-Null

    $font = "C\:/Windows/Fonts/consola.ttf"
    if (-not (Test-Path "C:\Windows\Fonts\consola.ttf")) { $font = "C\:/Windows/Fonts/arial.ttf" }
    $chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $planned = @()
    $missing = @()
    foreach ($act in @("before", "middle", "after")) {
        $src = $stills.$act
        if (-not (Test-Path $src)) {
            $missing += "$act"
            continue
        }
        $code = -join (1..4 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
        $dst = Join-Path $qaTarget ($act + ".png")
        $draw = "drawtext=fontfile='$font':text='$code':x=16:y=h-56:fontsize=36:fontcolor=yellow:box=1:boxcolor=black@0.88:boxborderw=8"
        $burnOut = & ffmpeg -v error -y -i $src -vf $draw $dst 2>&1
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dst)) {
            throw "still canary burn failed for $act (exit $LASTEXITCODE): $burnOut"
        }
        $planned += [ordered]@{ name = $act; act = $act; t = 0; canary = $code }
    }
    if ($planned.Count -eq 0) {
        throw "No reference-photos stills under data/reference-photos/$ObjectType for $ConceptId"
    }
    $plannedPath = Join-Path $qaTarget "planned.json"
    ($planned | ConvertTo-Json -Depth 4) | Set-Content -Path $plannedPath -Encoding UTF8
    $dummyReel = $stills.before
    if (-not (Test-Path $dummyReel)) { $dummyReel = $stills.after }
    Invoke-VisualQaCli --build-sidecar --qa-dir $qaTarget --reel $dummyReel --duration 0 --treatment 10s --canaries-file $plannedPath | Out-Null
    $ReelPath = $dummyReel
    $QaDir = $qaTarget
    $stillsMissing = ($missing -join ",")
} else {
    if (-not $ReelPath) { throw "-ReelPath is required unless -StillsOnly" }
    if (-not (Test-Path $ReelPath)) { throw "Reel not found: $ReelPath" }
    $stillsMissing = ""
    if (-not $SkipExtract) {
        $extractArgs = @{ ReelPath = $ReelPath }
        if ($QaDir) { $extractArgs.QaDir = $QaDir }
        & (Join-Path $script:PSScriptRoot "extract-reel-frames.ps1") @extractArgs
        if (-not $QaDir) {
            $QaDir = [IO.Path]::ChangeExtension($ReelPath, $null).TrimEnd('.') + ".qa-frames"
        }
    } elseif (-not $QaDir) {
        $QaDir = [IO.Path]::ChangeExtension($ReelPath, $null).TrimEnd('.') + ".qa-frames"
    }
}

$sidecarPath = Join-Path $QaDir "sidecar.json"
if (-not (Test-Path $sidecarPath)) { throw "QA sidecar missing: $sidecarPath" }
$sidecar = Get-Content $sidecarPath -Raw -Encoding UTF8 | ConvertFrom-Json
$frameNames = @($sidecar.frames | ForEach-Object { $_.name })
$frameActs = @($sidecar.frames | ForEach-Object { $_.act })
$hasMiddle = $false
foreach ($act in $frameActs) {
    if ("$act" -like "*middle*") { $hasMiddle = $true }
}
$promptArgs = @(
    "--emit-prompt",
    "--frames", ($frameNames -join ","),
    "--acts", ($frameActs -join ",")
)
if ($hasMiddle) { $promptArgs += "--has-middle" }
if ($stillsMissing) { $promptArgs += @("--stills-missing", $stillsMissing) }
$promptOut = Invoke-VisualQaCli @promptArgs
$promptLines = @($promptOut)
$promptHash = ""
$promptBody = New-Object System.Collections.Generic.List[string]
foreach ($line in $promptLines) {
    if ("$line" -like "PROMPT_HASH=*") {
        $promptHash = "$line".Substring(12)
    } else {
        [void]$promptBody.Add([string]$line)
    }
}
$prompt = [string]::Join("`n", $promptBody)
if ($prompt -match "Generate exactly|EDIT it|Use the built-in image model") {
    throw "QA prompt contains image-generation language; refusing to call Codex."
}

$runId = [guid]::NewGuid().ToString("N")
$stdoutPath = Join-Path $QaDir "judge-stdout.txt"
if ($StdoutFile) {
    Copy-Item $StdoutFile $stdoutPath -Force
} else {
    if (-not (Test-Path $codexCmd)) { throw "codex.cmd not found at $codexCmd" }
    $argsFile = Join-Path $QaDir "judge-args.json"
    # DPAPI root-fix (2026-08-22, ERROR-BOOK): codex's Windows "elevated" sandbox
    # depends on two dedicated local accounts whose stored credentials this
    # machine's DPAPI can no longer decrypt. "unelevated" uses the current
    # login's own restricted token instead, sidestepping that credential store.
    $codexArgs = @($codexCmd, "exec", "-C", $projectRoot, "-s", "read-only", "-c", 'windows.sandbox="unelevated"')
    foreach ($frame in @($sidecar.frames)) {
        $codexArgs += @("-i", (Join-Path $QaDir $frame.name))
    }
    $codexArgs += "-"
    ($codexArgs | ConvertTo-Json -Compress) | python $ioPy write-text $argsFile
    $prompt | python $ioPy run-codex $stdoutPath $argsFile
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $stdoutPath) -or (Get-Item $stdoutPath).Length -eq 0) {
        throw "Codex wrote no stdout (exit $LASTEXITCODE) to $stdoutPath"
    }
}

$outPath = if ($StillsOnly) {
    Join-Path $QaDir "stills.visual-qa.json"
} else {
    "$ReelPath.visual-qa.json"
}
$evalArgs = @(
    "--evaluate",
    "--stdout-file", $stdoutPath,
    "--sidecar", $sidecarPath,
    "--reel", $ReelPath,
    "--qa-dir", $QaDir,
    "--out", $outPath,
    "--prompt-hash", $promptHash,
    "--run-id", $runId
)
if ($stillsMissing) { $evalArgs += @("--stills-missing", $stillsMissing) }
$evalOut = Invoke-VisualQaCli @evalArgs
Write-Host "visual-qa: $evalOut"
Write-Host "visual-qa wrote $outPath (warning mode; publish is not blocked)"

if ($Isolate -and $ConceptId) {
    Isolate-FailedReel -FailedConceptId $ConceptId -FailedObjectType $ObjectType | Out-Null
}

if ($Strict) {
    $record = Get-Content $outPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($record.verdict -ne "PASS") { exit 2 }
}
exit 0
