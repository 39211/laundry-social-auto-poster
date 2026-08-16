# One-time replacement of the boutique-look slot 1 images.
#
# Every calendar written before the realism fix stored the old prompt text, and
# the images generated from them show pristine items in showroom interiors --
# the opposite of what this shop's captions describe. The manifest sanitizer
# now rewrites those prompts, so rebuilding the manifest and regenerating the
# slot 1 images swaps each day to the honest-wear look. Slot 2 is never
# touched: it holds reviewed, scheduled Reels.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($date in "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-07", "2026-08-09") {
    Write-Host "=== $date ==="
    cmd /c "npm.cmd run generate-image-manifest -- --date $date 2>&1" | ForEach-Object { Write-Host $_ }
    Get-ChildItem "docs\assets\$date" -Filter "slot-01*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
    & (Join-Path $PSScriptRoot "generate-missing-images.ps1") -Date $date
    if ($LASTEXITCODE -ne 0) { Write-Host "$date failed; stopping so the fault is visible."; exit 1 }
    cmd /c "npm.cmd run publish-pages -- --date $date --skip-audit 2>&1" | Select-String -Pattern "Published|Mirror" | Select-Object -First 2
}
Write-Host "All boutique-look images replaced and published."
