# Produces one Reel a day, one batch ahead of what is publishing.
#
# Dual-length A/B: each ab-test-plan day needs a noon and evening Reel at either
# 10s or 15s. This script (1) fills missing 15s assets for the next three plan
# days first, then (2) falls back to the next unfinished 10s concept, and
# (3) schedules both plan halves for the days those assets serve.
#
# Mid-treatment A/B/C (2026-08-12..14): when data/mid-treatment-plan.json maps
# today's date to A/B/C, assembly applies that mid-video treatment, writes
# reels with -tA/-tB/-tC suffix, records treatment on the concept manifest, and
# copies to the scheduleReel standard name. Missing plan -> current three-act
# + warning. -MidTestDryRun writes storyboard timelines only (no paid gen).
#
# Every step is resumable. The script does the next unfinished thing and stops,
# so a failed day costs that day only. It never approves and never live-publishes
# to Meta (publish-pages only pushes the public asset host).
param(
    [switch]$MidTestDryRun
)
$ErrorActionPreference = "Continue"
# Under Task Scheduler the console codepage is cp950, which mangles the UTF-8
# JSON that npm prints: the 14:00 run parsed an empty concept id out of it and
# produced nothing. Interactive runs never hit this because the session is
# already UTF-8.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
# Single-flight (luna, high): the scheduler retry, the patrol rescue and a
# manual run can overlap; this script is not re-entrant. An exclusive-create
# lock file makes the second instance exit instead of racing; a lock older
# than 45 minutes is a crashed run and is reclaimed.
$singleFlight = Join-Path $root ("data\run-locks\" + $MyInvocation.MyCommand.Name + ".lock")
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $singleFlight) | Out-Null
try {
    $fs = [IO.File]::Open($singleFlight, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $fs.Close()
} catch {
    $lockAge = (Get-Date) - (Get-Item $singleFlight).LastWriteTime
    if ($lockAge.TotalMinutes -lt 45) { exit 0 }
    Remove-Item $singleFlight -Force
    $fs = [IO.File]::Open($singleFlight, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    $fs.Close()
}
Register-EngineEvent PowerShell.Exiting -Action { Remove-Item $using:singleFlight -Force -ErrorAction SilentlyContinue } | Out-Null
try {

$run = Join-Path $root "output\reels-run\2026-07-29"
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\reel-production-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"
. (Join-Path $PSScriptRoot "_watchdog.ps1")

function Write-Log([string]$m) {
    $stamp = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $stamp, $m
    Write-Host $line
    # Tee-Object appends UTF-16 in PS 5.1, which turned the log into a mix of
    # encodings once the scheduled task wrote to it.
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Show-Toast([string]$text) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $n = $t.GetElementsByTagName("text")
        $n.Item(0).AppendChild($t.CreateTextNode("私享家 Reel 生產")) | Out-Null
        $n.Item(1).AppendChild($t.CreateTextNode($text)) | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryReelProduction").Show(
            (New-Object Windows.UI.Notifications.ToastNotification($t)))
    } catch { Write-Log ("Toast failed: " + $_.Exception.Message) }
}

function Get-ReelAssetPath([string]$conceptId, [string]$variant) {
    if ($variant -eq "15s") {
        return (Join-Path $run "reels\$conceptId-15s.mp4")
    }
    return (Join-Path $run "reels\$conceptId.mp4")
}

function Get-AbTestPlan {
    $planPath = Join-Path $root "data\ab-test-plan.json"
    if (-not (Test-Path $planPath)) { return @() }
    try {
        $parsed = Get-Content $planPath -Raw -Encoding utf8 | ConvertFrom-Json
        return @($parsed)
    } catch {
        Write-Log ("Could not read ab-test-plan.json: " + $_.Exception.Message)
        return @()
    }
}

function Get-PlanDaysInWindow([datetime]$fromDate, [int]$days) {
    $plan = Get-AbTestPlan
    if ($plan.Count -eq 0) { return @() }
    $end = $fromDate.AddDays($days - 1)
    $fromStr = $fromDate.ToString("yyyy-MM-dd")
    $endStr = $end.ToString("yyyy-MM-dd")
    return @($plan | Where-Object { $_.date -ge $fromStr -and $_.date -le $endStr })
}

# --- mid-treatment A/B/C (watch-time batch 2026-08-12..14) --------------------
function Get-MidTreatment([string]$forDate) {
    $planPath = Join-Path $root "data\mid-treatment-plan.json"
    if (-not (Test-Path $planPath)) {
        Write-Log "WARN: mid-treatment-plan.json missing; falling back to current three-act layout."
        return "none"
    }
    try {
        $parsed = Get-Content $planPath -Raw -Encoding utf8 | ConvertFrom-Json
        $code = $parsed.$forDate
        if ($code -eq "A" -or $code -eq "B" -or $code -eq "C") {
            return [string]$code
        }
        return "none"
    } catch {
        Write-Log ("WARN: could not read mid-treatment-plan.json: " + $_.Exception.Message + "; falling back to current three-act.")
        return "none"
    }
}

function Get-TreatmentSuffix([string]$treatment) {
    if ($treatment -eq "A") { return "-tA" }
    if ($treatment -eq "B") { return "-tB" }
    if ($treatment -eq "C") { return "-tC" }
    return ""
}

function Get-TreatedNarrationText([string]$narration, [string]$treatment) {
    if ($treatment -ne "A" -and $treatment -ne "B") { return $narration }
    $parts = [regex]::Split($narration, '(?<=[。！？])') | Where-Object { $_.Trim().Length -gt 0 }
    if ($parts.Count -lt 2) { return $narration }
    if ($treatment -eq "A") {
        # Judgment first (first sentence is the craftsman diagnostic).
        return ($parts -join "")
    }
    # B: result/consequence sentences first, cause last.
    $head = $parts[0]
    $rest = ($parts[1..($parts.Count - 1)] -join "")
    return ($rest + $head)
}

function Write-TreatmentManifest {
    param(
        [string]$ConceptId,
        [string]$Treatment,
        [string]$ForDate,
        [string]$Variant,
        [string]$TreatedAsset,
        [string]$ScheduledAs,
        [string]$NarrationUsed
    )
    $manifestPath = Join-Path $run "manifests\$ConceptId-treatment.json"
    $payload = [ordered]@{
        concept_id     = $ConceptId
        date           = $ForDate
        treatment      = $Treatment
        suffix         = (Get-TreatmentSuffix $Treatment)
        variant        = $Variant
        treated_asset  = $TreatedAsset
        scheduled_as   = $ScheduledAs
        narration      = $NarrationUsed
        recorded_at    = (Get-Date).ToString("o")
    }
    $payload | ConvertTo-Json -Depth 4 | Set-Content $manifestPath -Encoding utf8
    Write-Log "Treatment manifest: manifests\$ConceptId-treatment.json (treatment=$Treatment)"
}

function Invoke-TreatedAssembly {
    param(
        [string]$ConceptId,
        [string]$Treatment,
        [string]$Hook,
        [string]$Close,
        [string]$NarrationFile,
        [string]$BeforeClip,
        [string]$MiddleClip,
        [string]$AfterClip,
        [string]$OutPath,
        [double]$GainR,
        [double]$GainG,
        [double]$GainB
    )
    if (-not (Test-Path $BeforeClip)) { throw "Missing before clip: $BeforeClip" }
    if (-not (Test-Path $AfterClip)) { throw "Missing after clip: $AfterClip" }
    if (-not (Test-Path $MiddleClip)) { throw "Missing middle clip: $MiddleClip" }

    $FontFile = "C\:/Windows/Fonts/msjhbd.ttc"
    $MaxTextWidth = 648
    $escHook = $Hook.Replace("\", "\\").Replace(":", "\:").Replace("'", "\'")
    $escClose = $Close.Replace("\", "\\").Replace(":", "\:").Replace("'", "\'")
    $hookSize = [Math]::Min(52, [Math]::Floor($MaxTextWidth / [Math]::Max(1, $Hook.Length)))
    $closeSize = [Math]::Min(52, [Math]::Floor($MaxTextWidth / [Math]::Max(1, $Close.Length)))
    $gR = $GainR.ToString([Globalization.CultureInfo]::InvariantCulture)
    $gG = $GainG.ToString([Globalization.CultureInfo]::InvariantCulture)
    $gB = $GainB.ToString([Globalization.CultureInfo]::InvariantCulture)
    $work = Join-Path $run "raw\$ConceptId-treat-work"
    New-Item -ItemType Directory -Force -Path $work | Out-Null

    $scale = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1"
    $totalDur = 14.0
    $narrDelayMs = 500
    $filter = $null
    $inputs = @()

    if ($Treatment -eq "A") {
        # 4 / 6 / 4 — judgment window is 4–6s (narration delayed to 4s).
        $totalDur = 14.0
        $narrDelayMs = 4000
        $closeFrom = 10.8
        $hookText = "drawtext=fontfile='$FontFile':text='$escHook':fontsize=$hookSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,0,2.6)'"
        $closeText = "drawtext=fontfile='$FontFile':text='$escClose':fontsize=$closeSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,$closeFrom,$totalDur)'"
        # Middle is ~5s raw; tpad clones last frame to fill 6s.
        $filter = @"
[0:v]trim=0:4,setpts=PTS-STARTPTS,$scale[v0];
[1:v]trim=0:5,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v1];
[2:v]trim=0:4,setpts=PTS-STARTPTS,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v2];
[v0][v1][v2]concat=n=3:v=1:a=0[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""
        $inputs = @($BeforeClip, $MiddleClip, $AfterClip)
    }
    elseif ($Treatment -eq "B") {
        # before(3) → after(4) → middle(4) → after(3)
        $totalDur = 14.0
        $narrDelayMs = 3000
        $closeFrom = 10.8
        $hookText = "drawtext=fontfile='$FontFile':text='$escHook':fontsize=$hookSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,0,2.6)'"
        $closeText = "drawtext=fontfile='$FontFile':text='$escClose':fontsize=$closeSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,$closeFrom,$totalDur)'"
        $filter = @"
[0:v]trim=0:3,setpts=PTS-STARTPTS,$scale[v0];
[1:v]trim=0:4,setpts=PTS-STARTPTS,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v1];
[2:v]trim=0:4,setpts=PTS-STARTPTS,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v2];
[3:v]trim=0:3,setpts=PTS-STARTPTS,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v3];
[v0][v1][v2][v3]concat=n=4:v=1:a=0[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""
        $inputs = @($BeforeClip, $AfterClip, $MiddleClip, $AfterClip)
    }
    elseif ($Treatment -eq "C") {
        # Middle → 3 close-up quick cuts (2s + 2s + 1.5s), then stitch with before/after.
        $cuPath = Join-Path $work "middle-cu.mp4"
        $cuFilter = @"
[0:v]trim=0:2,setpts=PTS-STARTPTS,crop=iw*0.72:ih*0.48:iw*0.14:ih*0.08,scale=720:1280:flags=lanczos,setsar=1[c1];
[0:v]trim=0:2,setpts=PTS-STARTPTS,crop=iw*0.72:ih*0.48:iw*0.14:ih*0.26,scale=720:1280:flags=lanczos,setsar=1[c2];
[0:v]trim=0:1.5,setpts=PTS-STARTPTS,crop=iw*0.72:ih*0.42:iw*0.14:ih*0.40,scale=720:1280:flags=lanczos,setsar=1[c3];
[c1][c2][c3]concat=n=3:v=1:a=0[vout]
"@ -replace "`r`n", ""
        & ffmpeg -v error -y -i $MiddleClip -filter_complex $cuFilter -map "[vout]" `
            -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an $cuPath 2>&1 | Out-Null
        if (-not (Test-Path $cuPath)) { throw "Treatment C close-up concat failed for $ConceptId" }

        $totalDur = 14.0
        $narrDelayMs = 500
        $closeFrom = 10.8
        $hookText = "drawtext=fontfile='$FontFile':text='$escHook':fontsize=$hookSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,0,2.6)'"
        $closeText = "drawtext=fontfile='$FontFile':text='$escClose':fontsize=$closeSize:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=200:enable='between(t,$closeFrom,$totalDur)'"
        $filter = @"
[0:v]trim=0:4,setpts=PTS-STARTPTS,$scale[v0];
[1:v]$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v1];
[2:v]trim=0:4.5,setpts=PTS-STARTPTS,$scale,colorchannelmixer=rr=${gR}:gg=${gG}:bb=${gB}[v2];
[v0][v1][v2]concat=n=3:v=1:a=0[vx];
[vx]$hookText,$closeText[vout]
"@ -replace "`r`n", ""
        $inputs = @($BeforeClip, $cuPath, $AfterClip)
    }
    else {
        throw "Invoke-TreatedAssembly called with non-treatment: $Treatment"
    }

    $audioDur = [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0:0.##}", $totalDur)
    $ffArgs = @("-v", "error", "-y")
    foreach ($inp in $inputs) { $ffArgs += @("-i", $inp) }
    $ffArgs += @("-f", "lavfi", "-t", $audioDur, "-i", "anoisesrc=colour=brown:amplitude=0.02:seed=7")
    $bedIdx = $inputs.Count
    $hasNarration = $NarrationFile -and (Test-Path $NarrationFile)
    if ($hasNarration) {
        $voiceIdx = $bedIdx + 1
        $ffArgs += @("-i", $NarrationFile)
        $audioGraph = "[${bedIdx}:a]lowpass=f=350,volume=0.55[bed];[${voiceIdx}:a]adelay=${narrDelayMs}:all=1,volume=1.4[voice];[bed][voice]amix=inputs=2:duration=first:normalize=0[aout]"
        $ffArgs += @("-filter_complex", "$filter;$audioGraph", "-map", "[vout]", "-map", "[aout]")
    } else {
        $ffArgs += @("-filter_complex", $filter, "-map", "[vout]", "-map", "${bedIdx}:a", "-af", "lowpass=f=350,volume=0.55")
    }
    $ffArgs += @("-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-b:a", "96k", "-shortest", $OutPath)
    & ffmpeg @ffArgs 2>&1 | Out-Null
    if (-not (Test-Path $OutPath)) { throw "Treated assembly produced no file: $OutPath" }
    @{ source = "post-ambient-bed"; narration = [bool]$hasNarration; generated_clip_audio_used = $false; treatment = $Treatment } |
        ConvertTo-Json | Set-Content "$OutPath.audio.json" -Encoding utf8
}

# --- mid-test dry-run: storyboard+narration timelines only --------------------
if ($MidTestDryRun) {
    Write-Log "Mid-test dry-run: writing storyboard timelines to output/mid-test/"
    Push-Location $root
    cmd /c "npm.cmd run reel-concepts -- --mid-test 2>&1" | ForEach-Object { Write-Log $_ }
    $midExit = $LASTEXITCODE
    Pop-Location
    if ($midExit -ne 0) {
        Write-Log "Mid-test dry-run failed."
        exit 1
    }
    Write-Log "Mid-test dry-run done."
    exit 0
}

# --- concept status (for 10s backlog + stills metadata) ----------------------
Push-Location $root
$statusJson = cmd /c "npm.cmd run reel-concepts 2>&1"
Pop-Location
$m = [regex]::Match(($statusJson -join "`n"), '(?s)\{.*\}')
if (-not $m.Success) { Write-Log "Could not read concept status."; exit 1 }
$status = $m.Value | ConvertFrom-Json

$runway = $status.runway
Write-Log "Runway: $($runway.days_of_runway) scheduled days left, last is $($runway.last_scheduled_date)."
if ($runway.needs_new_concepts) {
    Show-Toast "排程剩 $($runway.days_of_runway) 天($($runway.last_scheduled_date) 之後就沒有了),需要再想新主題。"
}

# Today's mid-treatment (A/B/C or none). Drives assembly + attribution only.
$midTreatment = Get-MidTreatment $date
$midSuffix = Get-TreatmentSuffix $midTreatment
if ($midTreatment -ne "none") {
    Write-Log "Mid-treatment for $date : $midTreatment (suffix $midSuffix)"
} else {
    Write-Log "Mid-treatment for $date : none (current three-act)"
}
$treatmentNeedsMiddle = ($midTreatment -eq "A" -or $midTreatment -eq "B" -or $midTreatment -eq "C")

# --- pick work: prefer missing 15s for the next 3 plan days ------------------
# Four-day window, not three: with one asset produced per run, a day needing
# two 15s cuts (2026-08-14) only entered view 48 hours out, leaving no room for
# a failed generation. Four days keeps a spare day for every plan slot.
$windowDays = Get-PlanDaysInWindow $now.Date 4
$targetVariant = "10s"
$concept = $null
$conceptInfo = $null

$missing15s = @()
foreach ($day in $windowDays) {
    foreach ($halfName in @("noon", "evening")) {
        $half = $day.$halfName
        if ($null -eq $half) { continue }
        if ($half.variant -ne "15s") { continue }
        $asset = Get-ReelAssetPath $half.conceptId "15s"
        if (-not (Test-Path $asset)) {
            $missing15s += [pscustomobject]@{
                conceptId = $half.conceptId
                date      = $day.date
                half      = $halfName
            }
        }
    }
}

if ($missing15s.Count -gt 0) {
    $pick = $missing15s[0]
    $concept = $pick.conceptId
    $targetVariant = "15s"
    $conceptInfo = @($status.concepts | Where-Object { $_.id -eq $concept }) | Select-Object -First 1
    if (-not $conceptInfo) {
        Write-Log "Plan needs 15s for $concept but reel-concepts has no entry; cannot produce."
        Show-Toast "ab-test-plan 需要 $concept 的 15s,但概念表沒有它。"
        exit 1
    }
    Write-Log "Next work: 15s for $concept (needed by plan day $($pick.date) $($pick.half); $($missing15s.Count) 15s gap(s) in 3-day window)."
} else {
    $pending = @($status.concepts | Where-Object { -not (Test-Path (Get-ReelAssetPath $_.id "10s")) })
    if ($pending.Count -eq 0) {
        Write-Log "Every scheduled 10s concept is built and the next 3 plan days have their 15s assets. Nothing to produce."
        # A mid-treatment day still has work even when nothing is missing. The
        # treatment re-cuts clips that already exist; it does not need a new
        # concept. Tying it to "is anything unproduced?" meant 08-12 to 08-14
        # would have run the A/B/C experiment on zero assembled assets and
        # returned "middle treatment had no effect" -- an answer produced by
        # never having treated anything. Pick the concept the plan actually
        # publishes that day so the treatment lands on the reel that airs.
        $todayStr = $now.ToString("yyyy-MM-dd")
        $todayTreatment = Get-MidTreatment $todayStr
        if ($todayTreatment -and $todayTreatment -ne "none") {
            $planRow = @(Get-AbTestPlan | Where-Object { $_.date -eq $todayStr }) | Select-Object -First 1
            $airing = if ($planRow) { $planRow.noon.conceptId } else { $null }
            if ($airing) {
                $conceptInfo = @($status.concepts | Where-Object { $_.id -eq $airing }) | Select-Object -First 1
                if ($conceptInfo) {
                    $concept = $airing
                    $targetVariant = if ($planRow.noon.variant) { $planRow.noon.variant } else { "15s" }
                    Write-Log "Mid-treatment $todayTreatment day: re-cutting $concept ($targetVariant) from existing clips."
                }
            }
            if (-not $concept) {
                Write-Log "Mid-treatment $todayTreatment day but no airing concept resolved for $todayStr; no treatment produced."
                Show-Toast "$todayStr 是治療 $todayTreatment 日,但找不到當天要播的概念,治療沒有產出。"
            }
        }
    } else {
        $concept = $pending[0].id
        $conceptInfo = $pending[0]
        $targetVariant = "10s"
        Write-Log "Next concept (10s): $concept  ($($pending.Count) remaining)"
    }
}

# --- production body (skipped when nothing to build) -------------------------
if ($concept -and $conceptInfo) {
    $objectType = $conceptInfo.object_type
    $libDir = Join-Path $root "data\reference-photos\$objectType"
    New-Item -ItemType Directory -Force -Path $libDir | Out-Null
    $refs = Join-Path $run "references"
    New-Item -ItemType Directory -Force -Path $refs | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $run "raw") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $run "manifests") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $run "tts") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $run "reels") | Out-Null

    # --- stills: before/after (and middle when building 15s) ------------------
    $beforePng = Join-Path $libDir "$concept-before.png"
    $afterPng = Join-Path $libDir "$concept-after.png"
    $needBeforeAfter = -not ((Test-Path $beforePng) -and (Test-Path $afterPng))

    if ($needBeforeAfter) {
        Push-Location $root
        $promptText = cmd /c "npm.cmd run reel-concepts -- --concept $concept --prompts 2>&1"
        Pop-Location
        $promptBody = ($promptText | Where-Object { $_ -notmatch "^>|^$|npm" }) -join "`n"

        $header = @"
Do not read any workspace file and do not run any shell command; the local shell is broken and will only stall you. Use the built-in image model only. Generate exactly two images from the two prompts below, the before first and then the after. Produce the after by editing the before image so both share the same camera, lighting, counter and framing, with only the object's state changing. Do not save into the repository: leave both in your output directory and report the two filenames in order.

"@

        Write-Log "Generating before/after stills through Codex."
        $genStart = Get-Date
        ($header + $promptBody) | & "$env:APPDATA\npm\codex.cmd" exec -C $root -s read-only - *>$null

        $images = @(
            Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
                Get-ChildItem -File -Filter *.png |
                Where-Object { $_.LastWriteTime -ge $genStart } |
                Sort-Object LastWriteTime
        )

        if ($images.Count -lt 2) {
            Write-Log "Codex returned $($images.Count) fresh image(s) for $concept; need 2."
            Show-Toast "$concept 的素材生成失敗，今天沒有產出新 Reel。"
            exit 1
        }

        Copy-Item $images[0].FullName $beforePng -Force
        Copy-Item $images[-1].FullName $afterPng -Force
        Write-Log "Stills saved for $concept ($($images.Count) fresh files, first and last kept)."
    } else {
        Write-Log "Before/after stills already exist for $concept."
    }

    $middlePng = Join-Path $libDir "$concept-middle.png"
    # Treatments A/B/C all need a middle act; force middle still even when the
    # plan only asked for 10s on a treatment day.
    if (($targetVariant -eq "15s" -or $treatmentNeedsMiddle) -and -not (Test-Path $middlePng)) {
        # Middle still: edit the BEFORE image, do not invent a new scene. Pure
        # generation was adopted on 08-10 after an edit-by-reference prompt
        # failed three days running -- but that prompt told Codex "do not read
        # any workspace file" and then asked it to edit a workspace file, so it
        # returned nothing. The contradiction was the bug, not the approach.
        #
        # Pure generation cost continuity: the white-shoe reel cut from leather
        # shoes on one counter to a canvas shoe on another, and fourteen seconds
        # in which the object changes identity is most of what the owner meant
        # by "it doesn't look real". Editing the before image is what holds the
        # object, counter, background and light across the cut. Generation is
        # kept as the fallback so a refused edit still costs continuity rather
        # than the whole Reel.
        $middleHeader = @"
Read the image file at the path given below and EDIT it. Keep the same camera position, the same counter, the same background, the same light direction and the same white balance as that image. The featured item must remain the SAME physical object: same material, same colour, same fittings or laces, same wear marks. Add one adult hand entering from the right holding one shop tool (soft cloth, soft-bristle brush, or steam tool as fits the object), the tool in contact with the worn area the narration is about, and a small partially-cleaned patch already visible at that exact spot while the rest of the item stays in its original condition. Fingers anatomically correct: five fingers, no fusing, no second hand. Portrait 4:5. No readable text, no logo, no watermark, no faces. Leave the edited image in your output directory and report the filename.

"@

        Write-Log "Generating middle still by editing the before still."
        $genStart = Get-Date
        $middlePrompt = $middleHeader + "Image to edit: $beforePng`nObject/concept: $concept`nObject type: $objectType`nNarration context: $($conceptInfo.narration)`n"
        $middlePrompt | & "$env:APPDATA\npm\codex.cmd" exec -C $root -s read-only - *>$null

        $images = @(
            Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
                Get-ChildItem -File -Filter *.png |
                Where-Object { $_.LastWriteTime -ge $genStart } |
                Sort-Object LastWriteTime
        )
        if ($images.Count -lt 1) {
            # An edit can be refused where a generation would have succeeded, so
            # fall back rather than lose the Reel -- 2026-08-09 lost its noon
            # slot to exactly this. The fallback costs continuity, which is a
            # worse cut, not a missing one, so it is logged loudly enough to be
            # noticed in the day's report.
            Write-Log "Edit-by-reference returned nothing for $concept; falling back to pure generation (continuity will be weaker)."
            $genStart = Get-Date
            $fallback = @"
Use the built-in image model only. Do not read any workspace file. Generate ONE portrait 4:5 photo of the object below in a MID-CLEANING state, on the inspection counter of a Taiwanese laundry and shoe-care shop: a light counter with a pink cutting mat, white slat-wall panels behind, shelves of fabric-care bottles softly out of focus. One adult hand and one shop tool entering frame, partial cleaning progress at a specific worn spot, the rest of the item still soiled. Shot on a phone main camera about 26mm equivalent, chest height angled 20-35 degrees down, handheld with imperfect framing, item filling 45-65% of frame height and sharp, background readable. Storefront window key light from one side, weak fluorescent fill, continuous hard contact shadow under the item. Not cinematic, not studio, no film grain, no waxy surfaces, no readable text, no logo, no faces. Leave the image in your output directory and report the filename.

"@
            $fallback + "Object/concept: $concept`nObject type: $objectType`nNarration context: $($conceptInfo.narration)`n" |
                & "$env:APPDATA\npm\codex.cmd" exec -C $root -s read-only - *>$null
            $images = @(
                Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
                    Get-ChildItem -File -Filter *.png |
                    Where-Object { $_.LastWriteTime -ge $genStart } |
                    Sort-Object LastWriteTime
            )
            if ($images.Count -lt 1) {
                Write-Log "Codex returned no middle still for $concept, edit and generation both."
                Show-Toast "$concept 的中段素材生成失敗，今天沒有產出 15s。"
                exit 1
            }
            Show-Toast "$concept 中段改用純生成，三幕連續性會變弱，請抽幀確認是不是同一個物件。"
        }
        Copy-Item $images[-1].FullName $middlePng -Force
        Write-Log "Middle still saved for $concept."
    }

    # --- clips: before/after, and middle for 15s or mid-treatment ------------
    $states = @("before", "after")
    if ($targetVariant -eq "15s" -or $treatmentNeedsMiddle) { $states = @("before", "after", "middle") }

    foreach ($state in $states) {
        $src = Join-Path $libDir "$concept-$state.png"
        if (-not (Test-Path $src)) {
            Write-Log "Missing still for $concept-$state at $src"
            Show-Toast "$concept 缺少 $state 靜態圖。"
            exit 1
        }
        $dst = Join-Path $refs "$concept-$state.png"
        & ffmpeg -v error -y -i $src -vf "crop=ih*9/16:ih,scale=720:1280:flags=lanczos" $dst 2>&1 | Out-Null

        $manifest = Join-Path $run "manifests\$concept-$state.json"
        $out = Join-Path $run "raw\$concept-$state.mp4"
        if (Test-Path $out) { Write-Log "Clip already exists: $concept-$state"; continue }

        $generated = $false
        foreach ($attempt in 1, 2) {
            $template = Get-Content (Join-Path $run "manifests\white-shoe-yellowing-before.json") -Raw | ConvertFrom-Json
            # Middle generation_id carries _middle_ so Hermes idempotency never
            # collides with before/after of the same concept.
            if ($state -eq "middle") {
                $template.generation_id = "sixiangjia_$($concept -replace '-','_')_middle_v{0:d2}" -f $attempt
            } else {
                $template.generation_id = "sixiangjia_$($concept -replace '-','_')_$($state)_v{0:d2}" -f $attempt
            }
            $template.source_shot_id = "$concept-$state"
            $template.input_image = "references/$concept-$state.png"
            $template.output_file = "raw/$concept-$state.mp4"
            # Per-act camera direction (船長 method, digest sections C+D). All
            # three acts used to share one generic push-in, so the opening
            # three seconds carried no question -- the distribution report's
            # root cause #2. Each act now has its own beat, its own focus lock
            # and its own stopping point.
            $actDirection = switch ($state) {
                "before" {
                    "One restrained continuous action: a slow push-in that ends framed on the worn area the topic is about, so the viewer's eye lands on the problem within the first two seconds. Total camera travel about 10-15cm, slow enough to be barely perceptible, with slight natural handheld shake. The focal plane stays locked on the object from the first frame to the last -- no focus drift, no rack focus, no zoom. The motion completes and settles; it does not drift on afterwards."
                }
                "middle" {
                    "One restrained continuous action: the hand and tool already in the frame continue their working motion for the length of the shot -- the cloth keeps wiping, the brush keeps its stroke -- with believable weight and a contact shadow that moves with the touch. The camera holds nearly still with slight natural handheld shake. The focal plane stays locked on the contact point between tool and object -- no focus drift, no zoom. Fingers stay anatomically correct: five fingers, no fusing, no extra hand entering."
                }
                "after" {
                    "One restrained continuous action: an extremely gentle pull-back that opens a little breathing room around the cleaned object, letting it settle in frame. Total camera travel about 10-15cm, slow and even, with slight natural handheld shake. The focal plane stays locked on the object -- no focus drift, no zoom. The final frame is stable and holds."
                }
                default { "One restrained continuous action: an extremely gentle push-in with slight natural handheld shake." }
            }
            # Field order and the fields themselves come from the reference
            # repository's prompt structure: a fixed opening, style stated up
            # front in blocks rather than trailing adjectives, an asset handle,
            # an explicit shot count, then per-shot action summary, framing,
            # camera, motion and sound in that order.
            #
            # Two of its rules cannot be followed here and it is worth saying
            # why. It requires a continuous unit to be one prompt with internal
            # shot timings, but grok-imagine-video-1.5 caps a generation at five
            # seconds, so three acts remain three generations; continuity is
            # bought at the stills stage instead, where all three now come from
            # editing one image. And it writes prompts in Chinese because its
            # target model is Chinese -- the structure is what transfers, not
            # the language, and English is what this model has been producing
            # good stills from for a month.
            $sceneSound = switch ($state) {
                "middle" { "Sound: the brush or cloth moving against the surface, faint room tone, nothing else. No music, no voice." }
                default { "Sound: faint room tone only. No music, no voice." }
            }
            $actSummary = switch ($state) {
                "before" { "Shot summary: the object sits untouched and the camera finds the worn area the topic is about." }
                "middle" { "Shot summary: a hand and a shop tool are already working on that same worn area, and the work continues." }
                "after"  { "Shot summary: the same object, cleaned, settles in frame." }
                default  { "Shot summary: the object holds in frame." }
            }
            $template.prompt = "No music, no on-screen text, no subtitles, no captions. " +
                "[Overall look] Handheld phone photography, real physics, ordinary shop lighting; not cinematic, not a studio, no 3D-render or game-engine look, no illustration. " +
                "[Material] Keep the object's exact material, colour, wear marks, fittings and laces as supplied -- leather grain, fabric weave, rubber edge and every existing mark stay identical. " +
                "[Light] Keep the supplied image's light: window key from one side, weak fluorescent fill, uneven counter brightness, same colour temperature throughout. " +
                "[Core physics] The object has weight and a continuous contact shadow that stays attached to it; anything touching it deforms slightly at the point of contact. " +
                "Source: the supplied image is the only reference for object identity, framing and background. " +
                "This clip is exactly ONE continuous shot -- do not add a second shot, do not cut, do not insert an establishing frame. " +
                $actSummary + " " +
                "Framing: preserve the supplied composition and object placement; the object stays in the same third of the frame it starts in. " +
                $actDirection + " " + $sceneSound + " " +
                # Duration, aspect and resolution are manifest fields, and a
                # fixed tail repeating them in the prose spends weight on
                # something the API already knows. What stays here are the
                # failures this model actually makes on this kind of clip.
                "Keep every object in its original position and its original condition. Do not clean, repair, alter or transform the object beyond what the supplied image already shows. Do not add or remove anything. Do not add people or faces. No morphing, warping, flicker, jump cuts, sudden motion or collapsing geometry. Stable first and final frames."
            $template | ConvertTo-Json -Depth 5 | Set-Content $manifest -Encoding utf8

            Write-Log "Generating clip $concept-$state (attempt $attempt)."
            try {
                & (Join-Path $root "..\Codex\2026-06-30\copx\scripts\generate-shot.ps1") `
                    -Manifest $manifest -Root $run -ConfirmPaidRun -PollTimeoutSeconds 900 `
                    -OutputReport (Join-Path $run "report-$concept-$state.json") 2>&1 | Out-Null
            } catch { }
            if (Test-Path $out) { $generated = $true; break }
            Write-Log "Attempt $attempt produced no clip for $concept-$state."
        }

        if (-not $generated) {
            Write-Log "Clip generation failed after 2 attempts: $concept-$state"
            Show-Toast "$concept 的 $state 影片生成失敗，請看 log。"
            exit 1
        }
    }

    # Bake before→middle colour correction into middle-graded.mp4 (like
    # suit-shoulder-middle-graded.mp4). Assemble then uses the graded file.
    $middleRaw = Join-Path $run "raw\$concept-middle.mp4"
    $middleGraded = Join-Path $run "raw\$concept-middle-graded.mp4"
    if ($targetVariant -eq "15s" -or $treatmentNeedsMiddle) {
        if (-not (Test-Path $middleGraded)) {
            $midGainLine = python (Join-Path $root "scripts\measure-pair-gain.py") `
                (Join-Path $run "raw\$concept-before.mp4") $middleRaw 2>&1 |
                Where-Object { $_ -match "^-GainR" } | Select-Object -Last 1
            $mR = 1.0; $mG = 1.0; $mB = 1.0
            if ($midGainLine -match "-GainR ([\d.]+) -GainG ([\d.]+) -GainB ([\d.]+)") {
                $mR = [double]$Matches[1]; $mG = [double]$Matches[2]; $mB = [double]$Matches[3]
                Write-Log "Middle gains (before->middle): R $mR G $mG B $mB"
            } else {
                Write-Log "Middle gain measurement failed; grading with identity."
            }
            & ffmpeg -v error -y -i $middleRaw `
                -vf "colorchannelmixer=rr=$($mR.ToString([Globalization.CultureInfo]::InvariantCulture)):gg=$($mG.ToString([Globalization.CultureInfo]::InvariantCulture)):bb=$($mB.ToString([Globalization.CultureInfo]::InvariantCulture))" `
                -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -an $middleGraded 2>&1 | Out-Null
            if (-not (Test-Path $middleGraded)) {
                Write-Log "Failed to write middle-graded clip for $concept."
                Show-Toast "$concept 中段校色失敗。"
                exit 1
            }
            Write-Log "Baked middle-graded: raw\$concept-middle-graded.mp4"
        } else {
            Write-Log "Middle-graded already exists for $concept."
        }
    }

    # --- narration, colour match, assembly -----------------------------------
    # Base TTS (control / scheduleReel path). Treatment A/B may also write a
    # rearranged sidecar so attribution keeps both the stock and treated voice.
    $ttsFile = Join-Path $run "tts\$concept.mp3"
    if (-not (Test-Path $ttsFile)) {
        Write-Log "Generating narration."
        python -m edge_tts --voice zh-TW-HsiaoChenNeural --rate=+10% --text $conceptInfo.narration --write-media $ttsFile 2>&1 | Out-Null
        if (-not (Test-Path $ttsFile)) {
            Write-Log "Narration failed for $concept."
            Show-Toast "$concept 的旁白生成失敗，請看 log。"
            exit 1
        }
    }

    $treatedNarrationText = Get-TreatedNarrationText ([string]$conceptInfo.narration) $midTreatment
    $ttsTreated = $ttsFile
    if ($midTreatment -eq "A" -or $midTreatment -eq "B") {
        $ttsTreated = Join-Path $run ("tts\$concept" + $midSuffix + ".mp3")
        if (-not (Test-Path $ttsTreated)) {
            Write-Log "Generating treated narration ($midTreatment)."
            python -m edge_tts --voice zh-TW-HsiaoChenNeural --rate=+10% --text $treatedNarrationText --write-media $ttsTreated 2>&1 | Out-Null
            if (-not (Test-Path $ttsTreated)) {
                Write-Log "Treated narration failed for $concept; using base TTS."
                $ttsTreated = $ttsFile
            }
        }
    }

    $gainLine = python (Join-Path $root "scripts\measure-pair-gain.py") `
        (Join-Path $run "raw\$concept-before.mp4") (Join-Path $run "raw\$concept-after.mp4") 2>&1 |
        Where-Object { $_ -match "^-GainR" } | Select-Object -Last 1
    $gains = @{ GainR = 1.0; GainG = 1.0; GainB = 1.0 }
    if ($gainLine -match "-GainR ([\d.]+) -GainG ([\d.]+) -GainB ([\d.]+)") {
        $gains.GainR = [double]$Matches[1]; $gains.GainG = [double]$Matches[2]; $gains.GainB = [double]$Matches[3]
        Write-Log "Measured gains (before->after): R $($gains.GainR) G $($gains.GainG) B $($gains.GainB)"
    } else {
        Write-Log "Gain measurement failed; assembling uncorrected."
    }

    # Mid-treatment path: three-act treated assembly with -tA/-tB/-tC suffix.
    # scheduleReel keeps the standard name, so we also copy treated -> standard.
    if ($treatmentNeedsMiddle) {
        $beforeClip = Join-Path $run "raw\$concept-before.mp4"
        $afterClip = Join-Path $run "raw\$concept-after.mp4"
        if (-not (Test-Path $middleGraded)) {
            Write-Log "Middle-graded missing; cannot apply treatment $midTreatment."
            Show-Toast "$concept 缺少中段,無法套用治療 $midTreatment。"
            exit 1
        }
        $baseName = if ($targetVariant -eq "15s") { "$concept-15s" } else { $concept }
        $treatedName = $baseName + $midSuffix + ".mp4"
        $treatedOut = Join-Path $run "reels\$treatedName"
        $standardOut = Get-ReelAssetPath $concept $targetVariant
        if (-not (Test-Path $treatedOut)) {
            Write-Log "Assembling mid-treatment $midTreatment -> reels\$treatedName"
            try {
                Invoke-TreatedAssembly -ConceptId $concept -Treatment $midTreatment `
                    -Hook ([string]$conceptInfo.hook) -Close ([string]$conceptInfo.close) `
                    -NarrationFile $ttsTreated `
                    -BeforeClip $beforeClip -MiddleClip $middleGraded -AfterClip $afterClip `
                    -OutPath $treatedOut `
                    -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB
            } catch {
                Write-Log ("Treated assembly failed: " + $_.Exception.Message)
                Show-Toast "$concept 治療 $midTreatment 剪接失敗，請看 log。"
                exit 1
            }
            if (-not (Test-Path $treatedOut)) {
                Write-Log "Treated assembly produced no file for $concept."
                exit 1
            }
        } else {
            Write-Log "Treated reel already exists: reels\$treatedName"
        }
        # scheduleReel still looks up the standard name — copy, do not rename away
        # the attributed -tX asset.
        # The treated cut has to occupy the canonical name for the day it airs,
        # because that is the name the scheduler copies from. But the copy is
        # permanent, and the plan republishes these same concepts well after the
        # experiment window -- shirt-collar and white-shoe both come round again
        # later in August. Without a preserved original, those later airings
        # would quietly ship a treatment cut and nothing would record it. Keep
        # the untreated file beside it the first time it is displaced.
        $preserved = [IO.Path]::ChangeExtension($standardOut, $null).TrimEnd('.') + "-untreated.mp4"
        if ((Test-Path $standardOut) -and -not (Test-Path $preserved)) {
            Copy-Item $standardOut $preserved -Force
            Write-Log "Preserved untreated cut: $(Split-Path -Leaf $preserved)"
        }
        Copy-Item $treatedOut $standardOut -Force
        if (Test-Path "$treatedOut.audio.json") {
            Copy-Item "$treatedOut.audio.json" "$standardOut.audio.json" -Force
        }
        Write-TreatmentManifest -ConceptId $concept -Treatment $midTreatment -ForDate $date `
            -Variant $targetVariant -TreatedAsset ("reels/" + $treatedName) `
            -ScheduledAs ("reels/" + [IO.Path]::GetFileName($standardOut)) `
            -NarrationUsed $treatedNarrationText
        Write-Log "$concept finished treatment $midTreatment : reels\$treatedName (also $([IO.Path]::GetFileName($standardOut)))"

        # When the plan asked for 15s, also keep a 10s control if still missing
        # (untreated two-act — does not carry -tX; pre-8/11 assets untouched).
        if ($targetVariant -eq "15s") {
            $out10 = Get-ReelAssetPath $concept "10s"
            if (-not (Test-Path $out10)) {
                & (Join-Path $root "scripts\assemble-reel.ps1") -ConceptId $concept `
                    -Hook $conceptInfo.hook -Close $conceptInfo.close -Run $run `
                    -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
                    -NarrationFile $ttsFile
            }
        }
    }
    elseif ($targetVariant -eq "15s") {
        $out15 = Get-ReelAssetPath $concept "15s"
        if (-not (Test-Path $out15)) {
            & (Join-Path $root "scripts\assemble-reel.ps1") -ConceptId $concept `
                -Hook $conceptInfo.hook -Close $conceptInfo.close -Run $run `
                -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
                -NarrationFile $ttsFile -MiddleClip $middleGraded
            if (-not (Test-Path $out15)) {
                Write-Log "15s assembly failed for $concept."
                Show-Toast "$concept 15s 剪接失敗，請看 log。"
                exit 1
            }
        } else {
            Write-Log "15s reel already assembled for $concept."
        }
        # Also ensure 10s exists when before/after are ready (cheap; plan days often need both over time).
        $out10 = Get-ReelAssetPath $concept "10s"
        if (-not (Test-Path $out10)) {
            & (Join-Path $root "scripts\assemble-reel.ps1") -ConceptId $concept `
                -Hook $conceptInfo.hook -Close $conceptInfo.close -Run $run `
                -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
                -NarrationFile $ttsFile
        }
        Write-Log "$concept finished 15s: output\reels-run\2026-07-29\reels\$concept-15s.mp4"
    } else {
        $out10 = Get-ReelAssetPath $concept "10s"
        if (-not (Test-Path $out10)) {
            & (Join-Path $root "scripts\assemble-reel.ps1") -ConceptId $concept `
                -Hook $conceptInfo.hook -Close $conceptInfo.close -Run $run `
                -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
                -NarrationFile $ttsFile
            if (-not (Test-Path $out10)) {
                Write-Log "Assembly failed for $concept."
                Show-Toast "$concept 剪接失敗，請看 log。"
                exit 1
            }
        }
        Write-Log "$concept finished: output\reels-run\2026-07-29\reels\$concept.mp4"
    }
}

# --- schedule from ab-test-plan (noon slot 3 + evening slot 2) ---------------
# Schedule every plan day in the 3-day window whose required assets exist.
# When no plan is present, fall back to the legacy single evening schedule for
# the concept just built.
$scheduledAny = $false
$failedSchedule = $false

# A treated cut has to sit at the canonical name to be scheduled, but this loop
# walks four days and every one of them resolves the same canonical name. Left
# alone, the treatment produced for 08-14 would also be scheduled for 08-15's
# untreated occurrence of the same concept -- the experiment contaminating the
# days it is supposed to be compared against, and every later rerun of that
# concept shipping a treatment nobody recorded. Before each day is scheduled,
# the canonical name is pointed at the version that day is entitled to.
function Set-CanonicalForDate {
    param([string]$ForDate, [string]$ConceptId, [string]$Variant)
    $canonical = Get-ReelAssetPath $ConceptId $Variant
    $untreated = [IO.Path]::ChangeExtension($canonical, $null).TrimEnd('.') + "-untreated.mp4"
    $treatment = Get-MidTreatment $ForDate
    $wanted = if ($treatment -and $treatment -ne "none") {
        $suffix = Get-TreatmentSuffix $treatment
        [IO.Path]::ChangeExtension($canonical, $null).TrimEnd('.') + $suffix + ".mp4"
    } else {
        $untreated
    }
    if (-not (Test-Path $wanted)) { return }        # nothing to swap in
    if (-not (Test-Path $canonical)) { return }
    if ((Get-FileHash $wanted -Algorithm SHA256).Hash -eq (Get-FileHash $canonical -Algorithm SHA256).Hash) { return }
    Copy-Item $wanted $canonical -Force
    if (Test-Path "$wanted.audio.json") { Copy-Item "$wanted.audio.json" "$canonical.audio.json" -Force }
    Write-Log "Canonical asset for $ForDate set to $(Split-Path -Leaf $wanted)."
}

if ($windowDays.Count -gt 0) {
    foreach ($day in $windowDays) {
        Set-CanonicalForDate -ForDate $day.date -ConceptId $day.noon.conceptId -Variant $day.noon.variant
        Set-CanonicalForDate -ForDate $day.date -ConceptId $day.evening.conceptId -Variant $day.evening.variant
        $noonAsset = Get-ReelAssetPath $day.noon.conceptId $day.noon.variant
        $eveAsset = Get-ReelAssetPath $day.evening.conceptId $day.evening.variant
        if (-not ((Test-Path $noonAsset) -and (Test-Path $eveAsset))) {
            Write-Log "Plan day $($day.date): assets not both ready (noon $($day.noon.conceptId)/$($day.noon.variant), evening $($day.evening.conceptId)/$($day.evening.variant)); skip schedule."
            continue
        }

        Push-Location $root
        $dayOk = $true
        foreach ($half in @(
            @{ slot = 3; plan = $day.noon; name = "noon" },
            @{ slot = 2; plan = $day.evening; name = "evening" }
        )) {
            $cId = $half.plan.conceptId
            $var = $half.plan.variant
            $slotN = $half.slot
            Write-Log "Scheduling $($day.date) $($half.name) slot $slotN <- $cId ($var)"
            cmd /c "npm.cmd run schedule-reel -- --date $($day.date) --concept $cId --slot $slotN --variant $var 2>&1" | Add-Content -Path $logFile -Encoding UTF8
            if ($LASTEXITCODE -ne 0) {
                Write-Log "schedule-reel failed for $($day.date) slot $slotN."
                $dayOk = $false
                break
            }
            cmd /c "npm.cmd run owner-video-review -- --date $($day.date) --slot $slotN --standing-policy 2>&1" | Add-Content -Path $logFile -Encoding UTF8
            if ($LASTEXITCODE -ne 0) {
                Write-Log "owner-video-review failed for $($day.date) slot $slotN."
                $dayOk = $false
                break
            }
        }
        if ($dayOk) {
            cmd /c "npm.cmd run publish-pages -- --date $($day.date) --skip-audit 2>&1" | Add-Content -Path $logFile -Encoding UTF8
            if ($LASTEXITCODE -ne 0) {
                Write-Log "publish-pages failed for $($day.date)."
                $dayOk = $false
            }
        }
        Pop-Location

        if ($dayOk) {
            $scheduledAny = $true
            Write-Log "Plan day $($day.date) scheduled (noon+$($day.noon.variant), evening+$($day.evening.variant))."
        } else {
            $failedSchedule = $true
            Write-Log "Plan day $($day.date) scheduling incomplete."
        }
    }
} elseif ($concept -and $conceptInfo) {
    # Legacy path: no ab-test-plan → single evening reel on concept publish_date.
    $publishDate = $conceptInfo.publish_date
    if (-not $publishDate) {
        Write-Log "$concept has no publish date; leaving it unscheduled."
        Show-Toast "$concept 成片完成，但排程表沒有它的發布日，需要手動處理。"
        exit 1
    }
    Push-Location $root
    cmd /c "npm.cmd run schedule-reel -- --date $publishDate --concept $concept --slot 2 --variant 10s 2>&1" | Add-Content -Path $logFile -Encoding UTF8
    $scheduled = ($LASTEXITCODE -eq 0)
    $reviewed = $false
    $pushed = $false
    if ($scheduled) {
        cmd /c "npm.cmd run owner-video-review -- --date $publishDate --slot 2 --standing-policy 2>&1" | Add-Content -Path $logFile -Encoding UTF8
        $reviewed = ($LASTEXITCODE -eq 0)
    }
    if ($reviewed) {
        cmd /c "npm.cmd run publish-pages -- --date $publishDate --skip-audit 2>&1" | Add-Content -Path $logFile -Encoding UTF8
        $pushed = ($LASTEXITCODE -eq 0)
    }
    Pop-Location
    if (-not $scheduled -or -not $reviewed -or -not $pushed) {
        Write-Log "Scheduling failed for $concept -> $publishDate (scheduled=$scheduled reviewed=$reviewed pushed=$pushed)."
        Show-Toast "$concept 成片完成但排程或上線失敗，請看 log。"
        exit 1
    }
    $scheduledAny = $true
    Write-Log "$concept scheduled into $publishDate slot 2 under the standing policy."
}

if ($failedSchedule) {
    Show-Toast "Reel 產線有成片，但部分 ab-test-plan 排程失敗，請看 log。"
    exit 1
}

if ($concept) {
    Show-Toast "$concept ($targetVariant) 已處理。發布後請看片，哪裡不足告訴我，隔天改進。"
} elseif ($scheduledAny) {
    Write-Log "No new production; existing assets re-scheduled for plan window."
} else {
    Write-Log "Nothing produced and nothing scheduled."
}
} finally {
    Remove-Item $singleFlight -Force -ErrorAction SilentlyContinue
}
