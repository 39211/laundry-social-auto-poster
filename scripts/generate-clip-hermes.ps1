# Generates one reel clip through the hermes xai subscription route (F39).
#
# Thin wrapper around scripts/gen_clip_hermes.py so produce-next-reel.ps1 keeps
# a PowerShell-shaped call site with the same contract generate-shot.ps1 had:
# read a manifest, leave the clip at the manifest's output_file, exit non-zero
# on failure. The python side needs the hermes venv (the xai plugin imports
# hermes-agent's own dependencies), not the system python.
param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$Run,
    [string]$OutputReport = ""
)

$ErrorActionPreference = "Stop"

$hermesPython = "C:\Users\cyc39\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
if (-not (Test-Path $hermesPython)) {
    throw "hermes venv python not found at $hermesPython -- is hermes installed?"
}

$genPy = Join-Path $PSScriptRoot "gen_clip_hermes.py"
$genArgs = @($genPy, "--manifest", $Manifest, "--run", $Run)
if ($OutputReport) { $genArgs += @("--report", $OutputReport) }

& $hermesPython @genArgs
exit $LASTEXITCODE
