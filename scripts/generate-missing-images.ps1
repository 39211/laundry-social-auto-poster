# Generates the images a day's calendar asks for but does not yet have.
#
# Codex cannot write into the workspace from its sandbox on this machine --
# `CryptUnprotectData failed: 2148073483` -- so asking it to save the files
# itself fails and it reports the day as blocked. It can still generate: the
# images land in its own output directory, and this script places them. That is
# the same route the Reel stills already take.
#
# Generation only. Nothing here approves or publishes.
param(
    [Parameter(Mandatory = $true)][string]$Date,
    [string]$LogFile = ""
)

$ErrorActionPreference = "Continue"
# Task Scheduler consoles default to cp950, which mangles the UTF-8 JSON npm
# prints and broke a scheduled parse; interactive sessions never hit this.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$m) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $m
    Write-Host $line
    if ($LogFile) { $line | Out-File -FilePath $LogFile -Append -Encoding utf8 }
}

$manifestPath = Join-Path $root "data\image-prompts\$Date.json"
if (-not (Test-Path $manifestPath)) {
    Write-Step "No image manifest for $Date; run generate-image-manifest first."
    exit 1
}

# PowerShell 5.1 reads without a BOM as the ANSI codepage, which mangles the
# Chinese in these prompts. The bytes are UTF-8 either way.
$manifest = [IO.File]::ReadAllText($manifestPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
$items = if ($manifest -is [array]) { $manifest } else { $manifest.items }

$codex = Join-Path $env:APPDATA "npm\codex.cmd"
$generated = 0

foreach ($item in $items) {
    $target = Join-Path $root ($item.target_path -replace "/", "\")
    if (Test-Path $target) { continue }

    Write-Step "Generating slot $($item.slot): $($item.target_path)"
    $prompt = @"
Generate exactly one image from the prompt below using the built-in image model. Do not read any workspace file and do not run any shell command; the local sandbox cannot decrypt and will only stall you. Leave the image in your own output directory and report its filename.

$($item.prompt)
"@

    $before = Get-Date
    $codexOut = $prompt | & $codex exec -C $root -s read-only - 2>&1
    if ($LogFile) { $codexOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    else { $codexOut | ForEach-Object { Write-Host $_ } }

    $session = Get-ChildItem "$env:USERPROFILE\.codex\generated_images" -Directory -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $image = $null
    if ($session) {
        $image = Get-ChildItem $session.FullName -File |
            Where-Object { $_.LastWriteTime -ge $before } |
            Sort-Object LastWriteTime | Select-Object -Last 1
    }

    # Without the timestamp filter a failed run would silently republish an
    # older image belonging to a different day.
    if (-not $image) {
        $codexTail = @($codexOut | Select-Object -Last 20) -join " | "
        Write-Step "Codex returned no new image for slot $($item.slot). Codex said: $codexTail"
        exit 1
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $image.FullName $target -Force
    Write-Step "Saved slot $($item.slot)."

    # A carousel slot has one record per slide, so the path identifies which
    # image was just written. Marking by slot alone left three of four slides
    # of every carousel without a source record, which the publish gate reads
    # as an unverified image.
    Push-Location $root
    $markOut = cmd /c "npm.cmd run mark-image-source -- --date $Date --slot $($item.slot) --path $($item.target_path) --source gpt-image-2 2>&1"
    if ($LogFile) { $markOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
    else { $markOut | ForEach-Object { Write-Host $_ } }
    if ($LASTEXITCODE -ne 0) {
        Write-Step "mark-image-source failed for slot $($item.slot) (exit $LASTEXITCODE)."
    }
    Pop-Location
    $generated += 1
}

if ($generated -eq 0) {
    Write-Step "Every image for $Date was already present."
} else {
    Write-Step "Generated $generated image(s) for $Date."
}

Push-Location $root
$siteOut = cmd /c "npm.cmd run generate-public-site 2>&1"
$siteExit = $LASTEXITCODE
if ($LogFile) { $siteOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
else { $siteOut | ForEach-Object { Write-Host $_ } }
if ($siteExit -ne 0) { Write-Step "generate-public-site failed (exit $siteExit)." }
$valOut = cmd /c "npm.cmd run validate-publishable-images -- --date $Date 2>&1"
$ok = ($LASTEXITCODE -eq 0)
if ($LogFile) { $valOut | Out-File -FilePath $LogFile -Append -Encoding utf8 }
else { $valOut | ForEach-Object { Write-Host $_ } }
if (-not $ok) { Write-Step "validate-publishable-images failed (exit $LASTEXITCODE)." }
Pop-Location

if ($ok) { Write-Step "All publishable images for $Date are ready."; exit 0 }
Write-Step "Images for $Date are still incomplete."
exit 1
