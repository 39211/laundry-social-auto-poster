# Generate the six new shoe-wash clips, one at a time.
#
# Sequential on purpose: two generate_shot processes against the same job burned
# double credit on 2026-09-12 when a launch was mistakenly started twice. One at
# a time, each logged, and the loop stops on the first failure rather than
# spending on the rest.

$ErrorActionPreference = "Continue"
$repo = "C:\Users\cyc39\laundry-repo"
$job  = "$repo\output\reel-shoe-wash-20260912"
$hv   = "C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$gs   = "C:\Users\cyc39\AI-Lanes\wt-reel-v2\scripts\reel-v2\generate_shot.py"
$log  = "$repo\output\reel-production-logs\shoewash-clips.log"

"" | Out-File -FilePath $log -Encoding utf8

$manifests = @(
    "s01-intake.json",
    "s02-explain.json",
    "s06-dry.json",
    "s07-inspect.json",
    "s08-pack.json",
    "s09-handover.json"
)

foreach ($m in $manifests) {
    $out = "$job\" + ($m -replace '\.json$', '-raw.mp4')
    if (Test-Path $out) {
        ("[{0:HH:mm:ss}] skip {1} (exists)" -f (Get-Date), $m) | Out-File -FilePath $log -Append -Encoding utf8
        continue
    }
    ("[{0:HH:mm:ss}] generating {1}" -f (Get-Date), $m) | Out-File -FilePath $log -Append -Encoding utf8
    $result = & $hv $gs "$job\$m" 2>&1
    $result | Out-File -FilePath $log -Append -Encoding utf8
    if (-not (Test-Path $out)) {
        ("[{0:HH:mm:ss}] STOPPED: {1} produced no file" -f (Get-Date), $m) | Out-File -FilePath $log -Append -Encoding utf8
        exit 1
    }
    $mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
    ("[{0:HH:mm:ss}] ok {1} ({2} MB)" -f (Get-Date), (Split-Path $out -Leaf), $mb) | Out-File -FilePath $log -Append -Encoding utf8
}

("[{0:HH:mm:ss}] ALL SIX DONE" -f (Get-Date)) | Out-File -FilePath $log -Append -Encoding utf8
exit 0
