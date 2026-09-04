# Reburns a Reel's spoken narration (TTS + assemble + subtitles) into a staging
# folder. Official run raw/reels, docs, data, calendars and review files are
# never written. Visuals stay the original before/after clips; only voice and
# burned 旁白字幕 change. Owner re-review of video_sha256 is out of scope.
param(
    [Parameter(Mandatory = $true)][string]$ConceptIds,
    [Parameter(Mandatory = $true)][string]$Date,
    [string]$Run = "",
    [string]$OutDir = "",
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
if (-not $Run) { $Run = Join-Path $root "output\reels-run\2026-07-29" }
if (-not $OutDir) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmm"
    $OutDir = Join-Path $Run "reels-reburn-$stamp"
}
$stagingRun = Join-Path $OutDir "run"
$assembleScript = Join-Path $PSScriptRoot "assemble-reel.ps1"

$ids = @()
foreach ($piece in $ConceptIds.Split(",")) {
    $trimmed = $piece.Trim()
    if ($trimmed) { $ids += $trimmed }
}
if ($ids.Count -eq 0) { throw "-ConceptIds is empty" }

function Get-JsonPayload([string]$text) {
    $startObj = $text.IndexOf("{")
    $startArr = $text.IndexOf("[")
    $start = -1
    if ($startObj -ge 0 -and ($startArr -lt 0 -or $startObj -lt $startArr)) { $start = $startObj }
    elseif ($startArr -ge 0) { $start = $startArr }
    $end = [Math]::Max($text.LastIndexOf("}"), $text.LastIndexOf("]"))
    if ($start -lt 0 -or $end -le $start) { throw "no JSON in npm output: $text" }
    return $text.Substring($start, $end - $start + 1) | ConvertFrom-Json
}

function Invoke-NpmSilent([string]$ScriptName, [string[]]$ExtraArgs) {
    Push-Location $root
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $savedForce = $env:FORCE_COLOR
    $savedNoColor = $env:NO_COLOR
    Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue
    Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
    try {
        $raw = & npm.cmd run --silent $ScriptName -- @ExtraArgs 2>&1
        $code = $LASTEXITCODE
        $lines = @($raw | ForEach-Object { "$_" }) | Where-Object {
            $_ -and ($_ -notmatch "^\(node:\d+\) Warning:") -and ($_ -notmatch "^Use ``node --trace-warnings")
        }
        return @{ ExitCode = $code; Text = ($lines -join "`n") }
    } finally {
        $ErrorActionPreference = $prevEa
        if ($null -ne $savedForce) { $env:FORCE_COLOR = $savedForce } else { Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue }
        if ($null -ne $savedNoColor) { $env:NO_COLOR = $savedNoColor } else { Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue }
        Pop-Location
    }
}

function Get-PlanVoice($plan) {
    if ($null -eq $plan -or $null -eq $plan.voice) { return "" }
    if ($plan.voice.PSObject.Properties["label"]) { return [string]$plan.voice.label }
    return [string]$plan.voice
}

function Get-ClipSeconds([string]$path) {
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $probeOut = & ffprobe -v error -show_entries format=duration -of csv=p=0 $path 2>&1
        $code = $LASTEXITCODE
        $raw = @($probeOut | ForEach-Object { "$_" } | Select-Object -First 1)[0]
        $seconds = 0.0
        if ($code -ne 0 -or -not [double]::TryParse([string]$raw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$seconds)) {
            return $null
        }
        return [Math]::Round($seconds, 3)
    } finally {
        $ErrorActionPreference = $prevEa
    }
}

function Test-SourceClip([string]$path) {
    return (Test-Path -LiteralPath $path)
}

$items = New-Object System.Collections.ArrayList
$failed = 0

Write-Host ("PLAN_HEADER | id | before | after | middle | variants | voice | output")

foreach ($id in $ids) {
    $entry = [ordered]@{
        id             = $id
        narration      = $null
        voice          = $null
        engine         = $null
        source_before  = (Join-Path $Run "raw\$id-before.mp4")
        source_after   = (Join-Path $Run "raw\$id-after.mp4")
        output_mp4     = (Join-Path $stagingRun "reels\$id.mp4")
        sha256         = $null
        duration_sec   = $null
        burned         = $false
        error          = $null
    }
    try {
        $planCall = Invoke-NpmSilent "reel-reburn-plan" @($id, "--date", $Date, "--run", $Run)
        if ($planCall.ExitCode -ne 0) {
            throw "reel-reburn-plan exit $($planCall.ExitCode): $($planCall.Text)"
        }
        $plan = Get-JsonPayload $planCall.Text
        $entry.narration = [string]$plan.narration
        $entry.voice = Get-PlanVoice $plan
        $beforeOk = Test-SourceClip $entry.source_before
        $afterOk = Test-SourceClip $entry.source_after
        $middlePath = Join-Path $Run "raw\$id-middle.mp4"
        $middleOk = Test-SourceClip $middlePath
        $variants = @()
        if ($plan.variant_assets) { $variants = @($plan.variant_assets | ForEach-Object { [string]$_ }) }
        $variantText = if ($variants.Count -gt 0) { ($variants -join ",") } else { "(none)" }
        Write-Host ("PLAN | {0} | before={1} | after={2} | middle={3} | variants={4} | voice={5} | out={6}" -f `
            $id, $(if ($beforeOk) { "yes" } else { "MISSING" }), $(if ($afterOk) { "yes" } else { "MISSING" }), `
            $(if ($middleOk) { "yes" } else { "no" }), $variantText, $entry.voice, $entry.output_mp4)
        $nonMain = @($variants | Where-Object { $_ -ne "$id.mp4" })
        if ($nonMain.Count -gt 0) {
            Write-Host ("VARIANT_TODO | {0} | 先只重燒主檔 {1}.mp4；variant 不硬做: {2}" -f $id, $id, ($nonMain -join ","))
        }

        if ($WhatIf) {
            [void]$items.Add([pscustomobject]$entry)
            continue
        }

        if (-not $beforeOk -or -not $afterOk) {
            throw "missing raw clips before=$beforeOk after=$afterOk"
        }

        New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "raw") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "references") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "reels") | Out-Null
        Copy-Item -LiteralPath $entry.source_before -Destination (Join-Path $stagingRun "raw\$id-before.mp4") -Force
        Copy-Item -LiteralPath $entry.source_after -Destination (Join-Path $stagingRun "raw\$id-after.mp4") -Force
        if ($middleOk) {
            Copy-Item -LiteralPath $middlePath -Destination (Join-Path $stagingRun "raw\$id-middle.mp4") -Force
        }
        $refBefore = Join-Path $Run "references\$id-before.png"
        if (Test-Path -LiteralPath $refBefore) {
            Copy-Item -LiteralPath $refBefore -Destination (Join-Path $stagingRun "references\$id-before.png") -Force
        }

        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
        $narrPath = Join-Path $OutDir "$id.narration.mp3"
        $ttsCall = Invoke-NpmSilent "tts" @("--text", [string]$plan.narration, "--out", $narrPath, "--date", $Date, "--slot", "3")
        if ($ttsCall.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $narrPath)) {
            throw "tts failed (exit $($ttsCall.ExitCode)): $($ttsCall.Text)"
        }
        try {
            $ttsJson = Get-JsonPayload $ttsCall.Text
            if ($ttsJson.voice) { $entry.voice = [string]$ttsJson.voice }
            if ($ttsJson.engine) { $entry.engine = [string]$ttsJson.engine }
        } catch {
            $entry.engine = "unknown"
        }

        & $assembleScript -ConceptId $id -Hook ([string]$plan.hook) -Close ([string]$plan.close) `
            -NarrationFile $narrPath -NarrationText ([string]$plan.narration) -Run $stagingRun
        $outMp4 = $entry.output_mp4
        $audioJson = "$outMp4.audio.json"
        if (-not (Test-Path -LiteralPath $outMp4)) { throw "assemble-reel produced no $outMp4" }
        if (-not (Test-Path -LiteralPath $audioJson)) { throw "assemble-reel produced no $audioJson" }
        $entry.sha256 = (Get-FileHash -LiteralPath $outMp4 -Algorithm SHA256).Hash.ToLower()
        $entry.duration_sec = Get-ClipSeconds $outMp4
        $subs = "$outMp4.subs.json"
        if (Test-Path -LiteralPath $subs) {
            $marker = Get-Content -LiteralPath $subs -Raw -Encoding UTF8 | ConvertFrom-Json
            $entry.burned = [bool]$marker.burned
        } else {
            $entry.burned = $false
        }
    } catch {
        $failed += 1
        $entry.error = $_.Exception.Message
        $entry.burned = $false
        Write-Host ("ERROR | {0} | {1}" -f $id, $entry.error)
    }
    [void]$items.Add([pscustomobject]$entry)
}

if (-not $WhatIf) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $manifest = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        run_dir      = $stagingRun
        items        = @($items.ToArray())
    }
    $json = $manifest | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $OutDir "manifest.json"), $json, [Text.UTF8Encoding]::new($false))
    Write-Host ("MANIFEST | {0}" -f (Join-Path $OutDir "manifest.json"))
}

if ($failed -gt 0) {
    Write-Host ("FAILED {0} concept(s) during 重燒" -f $failed)
    exit 1
}
