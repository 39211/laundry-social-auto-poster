# Produces one Reel a day, one batch ahead of what is publishing.
#
# Dual-length A/B: each ab-test-plan day needs a noon and evening Reel at either
# 10s or 15s. This script (1) fills missing 15s assets for the next three plan
# days first, then (2) falls back to the next unfinished 10s concept, and
# (3) schedules both plan halves for the days those assets serve.
#
# Every step is resumable. The script does the next unfinished thing and stops,
# so a failed day costs that day only. It never approves and never live-publishes
# to Meta (publish-pages only pushes the public asset host).
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

# --- pick work: prefer missing 15s for the next 3 plan days ------------------
$windowDays = Get-PlanDaysInWindow $now.Date 3
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
        # Still try to schedule any plan day in the window whose assets are ready.
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
    if ($targetVariant -eq "15s" -and -not (Test-Path $middlePng)) {
        # Middle still: same scene as before, tools entering frame, object state
        # between before and after. Edit from the before so camera/lighting hold.
        $middleHeader = @"
Do not read any workspace file and do not run any shell command; the local shell is broken and will only stall you. Use the built-in image model only. Edit the supplied before image into ONE middle-state still for a laundry-shop before/middle/after Reel. Keep the exact same camera, lighting, counter and framing. The object's condition must sit between dirty and cleaned. Include shop tools or hands-with-tools entering the frame in a natural work moment. No readable text, logos, or captions. Do not save into the repository: leave the image in your output directory and report the filename.

"@
        Write-Log "Generating middle still through Codex (from before reference)."
        $genStart = Get-Date
        # Codex image edit: pass path context in the prompt; the before file is
        # available under the read-only sandbox root for models that accept it.
        $middlePrompt = $middleHeader + "Before reference path (read only): $beforePng`nConcept: $concept`nObject type: $objectType`nNarration context: $($conceptInfo.narration)`n"
        $middlePrompt | & "$env:APPDATA\npm\codex.cmd" exec -C $root -s read-only - *>$null

        $images = @(
            Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
                Get-ChildItem -File -Filter *.png |
                Where-Object { $_.LastWriteTime -ge $genStart } |
                Sort-Object LastWriteTime
        )
        if ($images.Count -lt 1) {
            Write-Log "Codex returned no middle still for $concept."
            Show-Toast "$concept 的中段素材生成失敗，今天沒有產出 15s。"
            exit 1
        }
        Copy-Item $images[-1].FullName $middlePng -Force
        Write-Log "Middle still saved for $concept."
    }

    # --- clips: before/after, and middle for 15s -----------------------------
    $states = @("before", "after")
    if ($targetVariant -eq "15s") { $states = @("before", "after", "middle") }

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
    if ($targetVariant -eq "15s") {
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

    if ($targetVariant -eq "15s") {
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

if ($windowDays.Count -gt 0) {
    foreach ($day in $windowDays) {
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
