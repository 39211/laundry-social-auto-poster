# Generate every outstanding still for a film through Codex, one at a time.
#
# SERIAL ON PURPOSE. Two Codex image lanes share ~/.codex/generated_images and
# eat each other's output (2026-08 F30); this loop also picks "the newest file
# written since I started", which is only true if nothing else is writing there.
#
# Stops on the first hard failure rather than burning the rest of the quota, but
# a wrong aspect ratio (exit 2) is retried once, because that is a coin flip on
# the model's side rather than a defect in the prompt.
#
# Usage: run-codex-stills.ps1 -JobDir <dir> [-Only a03-insert-weave,b01-insert-lining]

param(
    [Parameter(Mandatory = $true)][string]$JobDir,
    [string[]]$Only
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$one = Join-Path $here "codex_still.ps1"
$logDir = "C:\Users\cyc39\laundry-repo\output\reel-production-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "codex-stills-$(Split-Path $JobDir -Leaf).log"

$job = Get-Content (Join-Path $JobDir "job.json") -Raw -Encoding UTF8 | ConvertFrom-Json
# A shot carrying reuse_from is copied from an earlier film, not generated:
# on 2026-09-14 the runner tried to generate one of those, found no prompt for
# it and stopped the whole run on its first shot.
$ids = $job.shots | Where-Object { -not $_.reuse_from } | ForEach-Object { $_.file -replace '-raw\.mp4$', '' }
if ($Only) { $ids = $ids | Where-Object { $Only -contains $_ } }

("[{0:HH:mm:ss}] run starts, {1} shot(s) in scope" -f (Get-Date), $ids.Count) | Out-File -FilePath $log -Append -Encoding utf8

$made = 0; $skipped = 0
foreach ($id in $ids) {
    $dest = Join-Path $JobDir "$id.png"
    if (Test-Path $dest) {
        $skipped++
        ("[{0:HH:mm:ss}] skip {1} (already on disk)" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        continue
    }

    $ok = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        ("[{0:HH:mm:ss}] generating {1} (attempt {2})" -f (Get-Date), $id, $attempt) | Out-File -FilePath $log -Append -Encoding utf8
        $out = & $one -JobDir $JobDir -Id $id
        $code = $LASTEXITCODE
        $out | Where-Object { $_ -match '^(SHOT|REFS|RESULT|OK|ASPECT|CODEX|NO |REFERENCE)' } |
            ForEach-Object { "    $_" } | Out-File -FilePath $log -Append -Encoding utf8
        if ($code -eq 0) { $ok = $true; break }
        if ($code -ne 2) { break }   # 2 = wrong aspect, worth one more roll
        ("[{0:HH:mm:ss}] {1} came back the wrong shape; rolling once more" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
    }

    if (-not $ok) {
        ("[{0:HH:mm:ss}] STOPPED at {1}" -f (Get-Date), $id) | Out-File -FilePath $log -Append -Encoding utf8
        Write-Host "STOPPED at $id"
        exit 1
    }
    $made++
    ("[{0:HH:mm:ss}] done {1}  ({2} made, {3} skipped)" -f (Get-Date), $id, $made, $skipped) | Out-File -FilePath $log -Append -Encoding utf8
}

("[{0:HH:mm:ss}] ALL DONE: {1} made, {2} already existed" -f (Get-Date), $made, $skipped) | Out-File -FilePath $log -Append -Encoding utf8
Write-Host "ALL DONE: $made made, $skipped skipped"
exit 0
