# Generate every outstanding clip for the SOLESO-rhythm film, one at a time.
#
# SERIAL ON PURPOSE. On 2026-09-12 a launch was mistakenly started twice and
# burned double Grok credit; the rule since then is one generate_shot at a time,
# and "did it start" is answered from the process table, never from an exit code.
#
# Static shots are skipped by reading the cut list, not by guessing: the loop
# seam and the two studio cards are built by holding their stills, because
# nothing in those frames has any reason to move and handing them to a video
# model is how the last film grew a lace that swung between two shoes on its own.
#
# Skips any clip already on disk, so a stopped run resumes by being run again.
#
# ASCII only; the file carries a UTF-8 BOM so cp950 cannot eat it.
#
# Usage: run-soleso-clips.ps1 -JobDir <dir>

param([Parameter(Mandatory = $true)][string]$JobDir)

$ErrorActionPreference = "Continue"
$hv = "C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$gs = "C:\Users\cyc39\AI-Lanes\wt-reel-v2\scripts\reel-v2\generate_shot.py"
$logDir = "C:\Users\cyc39\laundry-repo\output\reel-production-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "soleso-clips.log"

$cut = Get-Content (Join-Path $JobDir "cut-list.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$todo = @($cut.shots | Where-Object { -not $_.static })

("[{0:HH:mm:ss}] run starts, {1} clip(s) to consider" -f (Get-Date), $todo.Count) |
    Out-File -FilePath $log -Append -Encoding utf8

$made = 0; $skipped = 0; $failed = 0
foreach ($shot in $todo) {
    $id = $shot.id
    $out = Join-Path $JobDir $shot.clip
    if (Test-Path $out) {
        $skipped++
        ("[{0:HH:mm:ss}] skip {1} (already on disk)" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        continue
    }
    $manifest = Join-Path $JobDir "$id.json"
    if (-not (Test-Path $manifest)) {
        ("[{0:HH:mm:ss}] SKIP {1}: no manifest" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        $failed++
        continue
    }

    ("[{0:HH:mm:ss}] generating {1}" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
    $result = & $hv $gs $manifest
    $result | Out-File -FilePath $log -Append -Encoding utf8

    if (Test-Path $out) {
        $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
        $made++
        ("[{0:HH:mm:ss}] ok {1} ({2} MB)  [{3} made]" -f (Get-Date), $id, $mb, $made) |
            Out-File -FilePath $log -Append -Encoding utf8
    } else {
        # One bad clip must not cost the other twenty. Record it and carry on;
        # the run is resumable, so a second pass picks up whatever is missing.
        $failed++
        ("[{0:HH:mm:ss}] FAILED {1} -- continuing" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
    }
}

("[{0:HH:mm:ss}] ALL DONE: {1} made, {2} skipped, {3} failed" -f (Get-Date), $made, $skipped, $failed) |
    Out-File -FilePath $log -Append -Encoding utf8
Write-Host "ALL DONE: $made made, $skipped skipped, $failed failed"
exit 0
