# Generate every outstanding clip for the 2026-09-14 film, one at a time.
#
# SERIAL ON PURPOSE. On 2026-09-12 a launch was mistakenly started twice and
# burned double Grok credit; the rule since then is one generate_shot at a time,
# and "did it start" is answered from the process table, never from an exit code.
#
# Skips any clip already on disk, so a stopped run resumes by being run again.
#
# Usage: run-supbro-clips.ps1 -JobDir <dir>

param([Parameter(Mandatory = $true)][string]$JobDir)

$ErrorActionPreference = "Continue"
$hv  = "C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$gs  = "C:\Users\cyc39\AI-Lanes\wt-reel-v2\scripts\reel-v2\generate_shot.py"
$logDir = "C:\Users\cyc39\laundry-repo\output\reel-production-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "supbro-clips.log"

$job = Get-Content (Join-Path $JobDir "job.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# reuse_from shots are copied from an earlier film, never generated.
$ids = $job.shots | Where-Object { -not $_.reuse_from } | ForEach-Object { $_.file -replace '-raw\.mp4$', '' }

("[{0:HH:mm:ss}] run starts, {1} shot(s)" -f (Get-Date), $ids.Count) | Out-File -FilePath $log -Append -Encoding utf8

$made = 0; $skipped = 0
foreach ($id in $ids) {
    $out = Join-Path $JobDir "$id-raw.mp4"
    if (Test-Path $out) {
        $skipped++
        ("[{0:HH:mm:ss}] skip {1} (already on disk)" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        continue
    }
    $manifest = Join-Path $JobDir "$id.json"
    if (-not (Test-Path $manifest)) {
        ("[{0:HH:mm:ss}] STOPPED: no manifest for {1}" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        Write-Host "STOPPED: no manifest for $id"; exit 1
    }

    ("[{0:HH:mm:ss}] generating {1}" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
    $result = & $hv $gs $manifest
    $result | Out-File -FilePath $log -Append -Encoding utf8

    if (-not (Test-Path $out)) {
        ("[{0:HH:mm:ss}] STOPPED: {1} produced no file" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        Write-Host "STOPPED at $id"; exit 1
    }
    $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
    $made++
    ("[{0:HH:mm:ss}] ok {1} ({2} MB)  [{3} made, {4} skipped]" -f (Get-Date), $id, $mb, $made, $skipped) |
        Out-File -FilePath $log -Append -Encoding utf8
}

("[{0:HH:mm:ss}] ALL DONE: {1} made, {2} skipped" -f (Get-Date), $made, $skipped) | Out-File -FilePath $log -Append -Encoding utf8
Write-Host "ALL DONE: $made made, $skipped skipped"
exit 0
