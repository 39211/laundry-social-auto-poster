# Produces one Reel a day, one batch ahead of what is publishing.
#
# Batch one publishes 2026-07-29 to 08-03. Waiting until it finishes to start
# the next six would leave a gap from 08-04, so this runs daily from the first
# publishing day: by the time the last of batch one goes out, batch two is made.
#
# Every step is resumable. The script does the next unfinished thing for the
# next unfinished concept and stops, so a failed day costs that day only. It
# never approves and never publishes.
$ErrorActionPreference = "Continue"
# Under Task Scheduler the console codepage is cp950, which mangles the UTF-8
# JSON that npm prints: the 14:00 run parsed an empty concept id out of it and
# produced nothing. Interactive runs never hit this because the session is
# already UTF-8.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$run = Join-Path $root "output\reels-run\2026-07-29"
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")

$logDir = Join-Path $root "output\reel-production-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "$date.log"

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

# --- pick the next concept that still needs work -----------------------------
Push-Location $root
$statusJson = cmd /c "npm.cmd run reel-concepts 2>&1"
Pop-Location
$m = [regex]::Match(($statusJson -join "`n"), '(?s)\{.*\}')
if (-not $m.Success) { Write-Log "Could not read concept status."; exit 1 }
$status = $m.Value | ConvertFrom-Json

# Running out of concepts looks identical to a healthy quiet day, so the runway
# is reported on every run and warned about while there is still time to write
# more. The 90-day programme runs well past the current schedule.
$runway = $status.runway
Write-Log "Runway: $($runway.days_of_runway) scheduled days left, last is $($runway.last_scheduled_date)."
if ($runway.needs_new_concepts) {
    Show-Toast "排程剩 $($runway.days_of_runway) 天($($runway.last_scheduled_date) 之後就沒有了),需要再想新主題。"
}

# A concept counts as done only when its finished reel exists. Judging by
# stills would skip a concept forever if a later stage failed after the stills
# were saved. Concepts arrive already sorted by publishing date, so production
# always builds the one that runs out first.
$pending = @($status.concepts | Where-Object { -not (Test-Path (Join-Path $run "reels\$($_.id).mp4")) })

if ($pending.Count -eq 0) {
    Write-Log "Every scheduled concept is built. Nothing to produce."
    exit 0
}

$concept = $pending[0].id
$conceptInfo = $pending[0]
Write-Log "Next concept: $concept  ($($pending.Count) remaining)"

# --- stills ------------------------------------------------------------------
$objectType = $conceptInfo.object_type
$libDir = Join-Path $root "data\reference-photos\$objectType"
New-Item -ItemType Directory -Force -Path $libDir | Out-Null

if ($conceptInfo.ready) {
    Write-Log "Stills already exist for $concept."
} else {
    Push-Location $root
    $promptText = cmd /c "npm.cmd run reel-concepts -- --concept $concept --prompts 2>&1"
    Pop-Location
    $promptBody = ($promptText | Where-Object { $_ -notmatch "^>|^$|npm" }) -join "`n"

    $header = @"
Do not read any workspace file and do not run any shell command; the local shell is broken and will only stall you. Use the built-in image model only. Generate exactly two images from the two prompts below, the before first and then the after. Produce the after by editing the before image so both share the same camera, lighting, counter and framing, with only the object's state changing. Do not save into the repository: leave both in your output directory and report the two filenames in order.

"@

    Write-Log "Generating stills through Codex."
    ($header + $promptBody) | & "$env:APPDATA\npm\codex.cmd" exec -C $root -s read-only - *>$null

    # Codex cannot write into the repo from its sandbox, so the images are
    # collected from its output directory here.
    $session = Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $images = @()
    if ($session) { $images = @(Get-ChildItem $session.FullName -File | Sort-Object LastWriteTime | Select-Object -Last 2) }

    # Codex returning instantly means it produced nothing new and the newest
    # session is stale; the timestamp check refuses those leftovers.
    if ($images.Count -ne 2 -or $images[0].LastWriteTime -lt (Get-Date).AddMinutes(-30)) {
        Write-Log "Codex did not return two fresh images for $concept."
        Show-Toast "$concept 的素材生成失敗，今天沒有產出新 Reel。"
        exit 1
    }

    Copy-Item $images[0].FullName (Join-Path $libDir "$concept-before.png") -Force
    Copy-Item $images[1].FullName (Join-Path $libDir "$concept-after.png") -Force
    Write-Log "Stills saved for $concept."
}

# --- clips -------------------------------------------------------------------
# The generation pipeline rejects a source that is not 9:16 or smaller than
# 720x1280, and still sizes vary between Codex runs, so every reference is
# normalised to exactly 720x1280.
$refs = Join-Path $run "references"
foreach ($state in @("before", "after")) {
    $src = Join-Path $libDir "$concept-$state.png"
    $dst = Join-Path $refs "$concept-$state.png"
    & ffmpeg -v error -y -i $src -vf "crop=ih*9/16:ih,scale=720:1280:flags=lanczos" $dst 2>&1 | Out-Null

    $manifest = Join-Path $run "manifests\$concept-$state.json"
    $out = Join-Path $run "raw\$concept-$state.mp4"
    if (Test-Path $out) { Write-Log "Clip already exists: $concept-$state"; continue }

    # A resubmission under an id the service has already seen comes back as
    # ambiguous rather than as a new clip, so each attempt gets its own id.
    # Two attempts only: a third would burn subscription quota on what is more
    # likely a bad reference image than a transient fault.
    $generated = $false
    foreach ($attempt in 1, 2) {
        $template = Get-Content (Join-Path $run "manifests\white-shoe-yellowing-before.json") -Raw | ConvertFrom-Json
        $template.generation_id = "sixiangjia_$($concept -replace '-','_')_$($state)_v{0:d2}" -f $attempt
        $template.source_shot_id = "$concept-$state"
        $template.input_image = "references/$concept-$state.png"
        $template.output_file = "raw/$concept-$state.mp4"
        $template | ConvertTo-Json -Depth 5 | Set-Content $manifest -Encoding utf8

        Write-Log "Generating clip $concept-$state (attempt $attempt)."
        try {
            & (Join-Path $root "..\Codex\2026-06-30\copx\scripts\generate-shot.ps1") `
                -Manifest $manifest -Root $run -ConfirmPaidRun -PollTimeoutSeconds 900 `
                -OutputReport (Join-Path $run "report-$concept-$state.json") 2>&1 | Out-Null
        } catch { }
        # The pipeline writes progress to stderr and PowerShell raises that as
        # an error even on success, so the file on disk is the only reliable
        # signal.
        if (Test-Path $out) { $generated = $true; break }
        Write-Log "Attempt $attempt produced no clip for $concept-$state."
    }

    if (-not $generated) {
        Write-Log "Clip generation failed after 2 attempts: $concept-$state"
        Show-Toast "$concept 的 $state 影片生成失敗，請看 log。"
        exit 1
    }
}

# --- narration, colour match, assembly ---------------------------------------
$ttsFile = Join-Path $run "tts\$concept.mp3"
if (-not (Test-Path $ttsFile)) {
    Write-Log "Generating narration."
    python -m edge_tts --voice zh-TW-HsiaoChenNeural --text $conceptInfo.narration --write-media $ttsFile 2>&1 | Out-Null
    if (-not (Test-Path $ttsFile)) {
        Write-Log "Narration failed for $concept."
        Show-Toast "$concept 的旁白生成失敗，請看 log。"
        exit 1
    }
}

# Each pair drifts differently in exposure, so the correction is measured from
# this pair's own background rather than reused from another concept.
$gainLine = python (Join-Path $root "scripts\measure-pair-gain.py") `
    (Join-Path $run "raw\$concept-before.mp4") (Join-Path $run "raw\$concept-after.mp4") 2>&1 |
    Where-Object { $_ -match "^-GainR" } | Select-Object -Last 1
$gains = @{ GainR = 1.0; GainG = 1.0; GainB = 1.0 }
if ($gainLine -match "-GainR ([\d.]+) -GainG ([\d.]+) -GainB ([\d.]+)") {
    $gains.GainR = [double]$Matches[1]; $gains.GainG = [double]$Matches[2]; $gains.GainB = [double]$Matches[3]
    Write-Log "Measured gains: R $($gains.GainR) G $($gains.GainG) B $($gains.GainB)"
} else {
    Write-Log "Gain measurement failed; assembling uncorrected."
}

& (Join-Path $root "scripts\assemble-reel.ps1") -ConceptId $concept `
    -Hook $conceptInfo.hook -Close $conceptInfo.close -Run $run `
    -GainR $gains.GainR -GainG $gains.GainG -GainB $gains.GainB `
    -NarrationFile $ttsFile
if (-not (Test-Path (Join-Path $run "reels\$concept.mp4"))) {
    Write-Log "Assembly failed for $concept."
    Show-Toast "$concept 剪接失敗，請看 log。"
    exit 1
}

Write-Log "$concept finished: output\reels-run\2026-07-29\reels\$concept.mp4"
Show-Toast "$concept 成片完成，看過沒問題就會排進發布。"
