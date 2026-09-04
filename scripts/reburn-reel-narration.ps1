# Reburns a Reel's spoken narration (TTS + assemble + subtitles) into a staging
# folder. Official run raw/reels, docs, data, calendars and review files are
# never written. Visuals stay the original before/after clips; only voice and
# burned 旁白字幕 change. Owner re-review of video_sha256 is out of scope.
#
# H1(b): same edge-tts call as produce-next-reel.ps1, not npm run tts.
# H7: three-act when raw\<id>-middle-graded.mp4 exists; never copy -middle.mp4.
param(
    [Parameter(Mandatory = $true)][string]$ConceptIds,
    [Parameter(Mandatory = $true)][string]$Date,
    [string]$Run = "",
    [string]$OutDir = "",
    [string]$Voice = "zh-TW-YunJheNeural",
    [string]$Rate = "+8%",
    [switch]$WhatIf,
    [switch]$DryRunStubs
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
if (-not $Run) { $Run = Join-Path $root "output\reels-run\2026-07-29" }
$Run = [IO.Path]::GetFullPath($Run)
if (-not $OutDir) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmm"
    $OutDir = Join-Path $root ("output\reel-reburn\" + $stamp)
}
$OutDir = [IO.Path]::GetFullPath($OutDir)
$stagingRun = Join-Path $OutDir "run"

function Test-IsUnderPath([string]$child, [string]$parent) {
    $childFull = [IO.Path]::GetFullPath($child).TrimEnd([char[]]@([char]92, [char]47))
    $parentFull = [IO.Path]::GetFullPath($parent).TrimEnd([char[]]@([char]92, [char]47))
    if ($childFull.Equals($parentFull, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $parentFull + [IO.Path]::DirectorySeparatorChar
    return $childFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

if (Test-IsUnderPath $OutDir $Run) {
    Write-Host ("ERROR | OutDir is under Run; refusing to write | OutDir={0} | Run={1}" -f $OutDir, $Run)
    exit 3
}

$ids = @()
foreach ($piece in $ConceptIds.Split(",")) {
    $trimmed = $piece.Trim()
    if ($trimmed) { $ids += $trimmed }
}
if ($ids.Count -eq 0) { throw "-ConceptIds is empty" }

function Find-PathTool([string]$fileName) {
    foreach ($dir in @($env:PATH -split ";")) {
        if (-not $dir) { continue }
        $candidate = Join-Path $dir $fileName
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    return $null
}

function Resolve-AssembleScript {
    if ($DryRunStubs) {
        $stub = Find-PathTool "assemble-reel.ps1"
        if (-not $stub) { throw "DryRunStubs requires assemble-reel.ps1 on PATH" }
        return $stub
    }
    return Join-Path $PSScriptRoot "assemble-reel.ps1"
}

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

function Invoke-Captured([string]$FilePath, [string[]]$ArgList) {
    $prevEa = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $raw = & $FilePath @ArgList 2>&1
        $code = $LASTEXITCODE
        $lines = @($raw | ForEach-Object { "$_" }) | Where-Object {
            $_ -and ($_ -notmatch "^\(node:\d+\) Warning:") -and ($_ -notmatch "^Use ``node --trace-warnings")
        }
        return @{ ExitCode = $code; Text = ($lines -join "`n") }
    } finally {
        $ErrorActionPreference = $prevEa
    }
}

function Invoke-NpmSilent([string]$ScriptName, [string[]]$ExtraArgs) {
    Push-Location $root
    $savedForce = $env:FORCE_COLOR
    $savedNoColor = $env:NO_COLOR
    Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue
    Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue
    try {
        return Invoke-Captured "npm.cmd" (@("run", "--silent", $ScriptName, "--") + @($ExtraArgs))
    } finally {
        if ($null -ne $savedForce) { $env:FORCE_COLOR = $savedForce } else { Remove-Item Env:FORCE_COLOR -ErrorAction SilentlyContinue }
        if ($null -ne $savedNoColor) { $env:NO_COLOR = $savedNoColor } else { Remove-Item Env:NO_COLOR -ErrorAction SilentlyContinue }
        Pop-Location
    }
}

function Invoke-Python([string[]]$PyArgs) {
    $exe = "python"
    if ($DryRunStubs) {
        $cmd = Find-PathTool "python.cmd"
        if (-not $cmd) { throw "DryRunStubs requires python.cmd on PATH" }
        $exe = $cmd
    }
    return Invoke-Captured $exe $PyArgs
}

function Get-ClipSeconds([string]$path) {
    if ($DryRunStubs) { return $null }
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

function Find-GainInObject($obj) {
    if ($null -eq $obj) { return $null }
    if ($obj -is [string]) { return $null }
    $dict = $null
    try { $dict = $obj.PSObject } catch { $dict = $null }
    if ($dict -and $dict.Properties) {
        $names = @($dict.Properties | ForEach-Object { $_.Name })
        $rName = $names | Where-Object { $_ -eq "GainR" -or $_ -eq "gain_r" -or $_ -eq "gainR" } | Select-Object -First 1
        $gName = $names | Where-Object { $_ -eq "GainG" -or $_ -eq "gain_g" -or $_ -eq "gainG" } | Select-Object -First 1
        $bName = $names | Where-Object { $_ -eq "GainB" -or $_ -eq "gain_b" -or $_ -eq "gainB" } | Select-Object -First 1
        if ($rName -and $gName -and $bName) {
            return @{
                GainR = [double]$obj.$rName
                GainG = [double]$obj.$gName
                GainB = [double]$obj.$bName
            }
        }
        foreach ($prop in $dict.Properties) {
            $hit = Find-GainInObject $prop.Value
            if ($hit) { return $hit }
        }
    }
    if ($obj -is [System.Collections.IEnumerable]) {
        foreach ($item in @($obj)) {
            $hit = Find-GainInObject $item
            if ($hit) { return $hit }
        }
    }
    return $null
}

function Convert-GainFromText([string]$text) {
    if ($text -match "-GainR\s+([\d.]+)\s+-GainG\s+([\d.]+)\s+-GainB\s+([\d.]+)") {
        return @{
            GainR = [double]$Matches[1]
            GainG = [double]$Matches[2]
            GainB = [double]$Matches[3]
        }
    }
    return $null
}

function Get-RecordedGain([string]$runDir, [string]$conceptId) {
    $files = New-Object System.Collections.ArrayList
    $manDir = Join-Path $runDir "manifests"
    if (Test-Path -LiteralPath $manDir) {
        Get-ChildItem -LiteralPath $manDir -Filter "*.json" -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.BaseName -like "*$conceptId*") { [void]$files.Add($_) }
        }
    }
    Get-ChildItem -LiteralPath $runDir -Filter "report*.json" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Name -like "*$conceptId*" -or $_.Name -eq "report.json") { [void]$files.Add($_) }
    }
    foreach ($file in $files) {
        try {
            $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
            $fromText = Convert-GainFromText $text
            if ($fromText) {
                $rel = $file.FullName.Substring($runDir.Length).TrimStart([char[]]@([char]92, [char]47))
                return @{ GainR = $fromText.GainR; GainG = $fromText.GainG; GainB = $fromText.GainB; Source = "run-manifest:$rel" }
            }
            $obj = $text | ConvertFrom-Json
            $fromObj = Find-GainInObject $obj
            if ($fromObj) {
                $rel = $file.FullName.Substring($runDir.Length).TrimStart([char[]]@([char]92, [char]47))
                return @{ GainR = $fromObj.GainR; GainG = $fromObj.GainG; GainB = $fromObj.GainB; Source = "run-manifest:$rel" }
            }
        } catch {
            continue
        }
    }
    return $null
}

function Measure-PairGain([string]$beforePath, [string]$afterPath) {
    $py = Join-Path $root "scripts\measure-pair-gain.py"
    $call = Invoke-Python @($py, $beforePath, $afterPath)
    $parsed = Convert-GainFromText $call.Text
    if ($call.ExitCode -ne 0 -or -not $parsed) {
        return $null
    }
    return $parsed
}

function Clamp-Gain($gains) {
    foreach ($channel in @("GainR", "GainG", "GainB")) {
        if ($gains[$channel] -gt 2.0) { $gains[$channel] = 2.0 }
    }
    return $gains
}

$wroteOutput = $false
function Ensure-OutputDirs {
    if ($script:wroteOutput) { return }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "raw") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "references") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "reels") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $stagingRun "tts") | Out-Null
    $script:wroteOutput = $true
}

$engine = "edge-tts"
$voiceTag = ($Voice -replace '^zh-TW-', '' -replace 'Neural$', '').ToLower()
$items = New-Object System.Collections.ArrayList
$failed = 0

Write-Host ("PLAN_HEADER | id | before | after | middle | variants | engine | voice | rate | output")

foreach ($id in $ids) {
    $entry = [ordered]@{
        id             = $id
        narration      = $null
        engine         = $engine
        voice          = $Voice
        rate           = $Rate
        source_before  = (Join-Path $Run "raw\$id-before.mp4")
        source_after   = (Join-Path $Run "raw\$id-after.mp4")
        output_mp4     = (Join-Path $stagingRun "reels\$id.mp4")
        sha256         = $null
        duration_sec   = $null
        burned         = $false
        gain_r         = $null
        gain_g         = $null
        gain_b         = $null
        gain_source    = $null
        three_act      = $false
        error          = $null
    }
    try {
        $planCall = Invoke-NpmSilent "reel-reburn-plan" @($id, "--date", $Date, "--run", $Run)
        if ($planCall.ExitCode -ne 0) {
            throw "reel-reburn-plan exit $($planCall.ExitCode): $($planCall.Text)"
        }
        $plan = Get-JsonPayload $planCall.Text
        $entry.narration = [string]$plan.narration
        $beforeOk = Test-SourceClip $entry.source_before
        $afterOk = Test-SourceClip $entry.source_after
        $middleGradedPath = Join-Path $Run "raw\$id-middle-graded.mp4"
        $middleOk = Test-SourceClip $middleGradedPath
        $entry.three_act = [bool]$middleOk
        if ($middleOk) {
            $entry.output_mp4 = Join-Path $stagingRun "reels\$id-15s.mp4"
        }
        $variants = @()
        if ($plan.variant_assets) { $variants = @($plan.variant_assets | ForEach-Object { [string]$_ }) }
        $variantText = if ($variants.Count -gt 0) { ($variants -join ",") } else { "(none)" }
        Write-Host ("PLAN | {0} | before={1} | after={2} | middle={3} | variants={4} | engine={5} | voice={6} | rate={7} | out={8}" -f `
            $id, $(if ($beforeOk) { "yes" } else { "MISSING" }), $(if ($afterOk) { "yes" } else { "MISSING" }), `
            $(if ($middleOk) { "yes" } else { "no" }), $variantText, $engine, $Voice, $Rate, $entry.output_mp4)
        $nonMain = @($variants | Where-Object { $_ -ne "$id.mp4" -and $_ -ne "$id-15s.mp4" })
        if ($nonMain.Count -gt 0) {
            Write-Host ("VARIANT_TODO | {0} | 先只重燒主檔 {1}; variant 不硬做: {2}" -f $id, $(Split-Path -Leaf $entry.output_mp4), ($nonMain -join ","))
        }

        if ($WhatIf) {
            [void]$items.Add([pscustomobject]$entry)
            continue
        }

        if (-not $beforeOk -or -not $afterOk) {
            throw "missing raw clips before=$beforeOk after=$afterOk"
        }

        Ensure-OutputDirs
        Copy-Item -LiteralPath $entry.source_before -Destination (Join-Path $stagingRun "raw\$id-before.mp4") -Force
        Copy-Item -LiteralPath $entry.source_after -Destination (Join-Path $stagingRun "raw\$id-after.mp4") -Force
        $middleStaging = $null
        if ($middleOk) {
            $middleStaging = Join-Path $stagingRun "raw\$id-middle-graded.mp4"
            Copy-Item -LiteralPath $middleGradedPath -Destination $middleStaging -Force
        }
        $refBefore = Join-Path $Run "references\$id-before.png"
        if (Test-Path -LiteralPath $refBefore) {
            Copy-Item -LiteralPath $refBefore -Destination (Join-Path $stagingRun "references\$id-before.png") -Force
        }

        $narrPath = Join-Path $stagingRun "tts\$id-$voiceTag.mp3"
        $ttsCall = Invoke-Python @(
            "-m", "edge_tts",
            "--voice", $Voice,
            ("--rate=" + $Rate),
            "--text", [string]$plan.narration,
            "--write-media", $narrPath
        )
        if ($ttsCall.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $narrPath)) {
            throw "edge-tts failed (exit $($ttsCall.ExitCode)): $($ttsCall.Text)"
        }

        $gains = @{ GainR = 1.0; GainG = 1.0; GainB = 1.0 }
        $gainSource = "identity-fallback"
        $recorded = Get-RecordedGain $Run $id
        if ($recorded) {
            $gains.GainR = $recorded.GainR
            $gains.GainG = $recorded.GainG
            $gains.GainB = $recorded.GainB
            $gainSource = [string]$recorded.Source
        } else {
            $measured = Measure-PairGain (Join-Path $stagingRun "raw\$id-before.mp4") (Join-Path $stagingRun "raw\$id-after.mp4")
            if ($measured) {
                $gains.GainR = $measured.GainR
                $gains.GainG = $measured.GainG
                $gains.GainB = $measured.GainB
                $gainSource = "measure-pair-gain.py"
            }
        }
        $gains = Clamp-Gain $gains
        $entry.gain_r = $gains.GainR
        $entry.gain_g = $gains.GainG
        $entry.gain_b = $gains.GainB
        $entry.gain_source = $gainSource

        $assembleScript = Resolve-AssembleScript
        if ($middleStaging) {
            & $assembleScript -ConceptId $id -Hook ([string]$plan.hook) -Close ([string]$plan.close) `
                -NarrationFile $narrPath -NarrationText ([string]$plan.narration) -Run $stagingRun `
                -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
                -MiddleClip $middleStaging
        } else {
            & $assembleScript -ConceptId $id -Hook ([string]$plan.hook) -Close ([string]$plan.close) `
                -NarrationFile $narrPath -NarrationText ([string]$plan.narration) -Run $stagingRun `
                -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB
        }
        $outMp4 = $entry.output_mp4
        $audioJson = "$outMp4.audio.json"
        if (-not (Test-Path -LiteralPath $outMp4)) { throw "assemble-reel produced no $outMp4" }
        if (-not (Test-Path -LiteralPath $audioJson)) { throw "assemble-reel produced no $audioJson" }
        $entry.sha256 = (Get-FileHash -LiteralPath $outMp4 -Algorithm SHA256).Hash.ToLower()
        $entry.duration_sec = Get-ClipSeconds $outMp4
        $subs = "$outMp4.subs.json"
        $burnError = "missing $subs"
        if (Test-Path -LiteralPath $subs) {
            $marker = Get-Content -LiteralPath $subs -Raw -Encoding UTF8 | ConvertFrom-Json
            $entry.burned = [bool]$marker.burned
            if ($marker.PSObject.Properties["error"] -and $marker.error) {
                $burnError = [string]$marker.error
            } elseif (-not $entry.burned) {
                $burnError = "marker burned=false"
            }
        } else {
            $entry.burned = $false
        }
        if (-not $entry.burned) {
            $failed += 1
            $entry.error = $burnError
            Write-Host ("ERROR | {0} | subtitles not burned: {1}" -f $id, $burnError)
        }
    } catch {
        $failed += 1
        $entry.error = $_.Exception.Message
        $entry.burned = $false
        Write-Host ("ERROR | {0} | {1}" -f $id, $entry.error)
    }
    [void]$items.Add([pscustomobject]$entry)
}

if ($wroteOutput) {
    $manifest = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        source_run   = $Run
        run_dir      = $stagingRun
        engine       = $engine
        voice        = $Voice
        rate         = $Rate
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
