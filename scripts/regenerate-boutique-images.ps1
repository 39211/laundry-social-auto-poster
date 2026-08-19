# One-time replacement of the boutique-look slot 1 images.
#
# Every calendar written before the realism fix stored the old prompt text, and
# the images generated from them show pristine items in showroom interiors --
# the opposite of what this shop's captions describe. The manifest sanitizer
# now rewrites those prompts, so rebuilding the manifest and regenerating the
# slot 1 images swaps each day to the honest-wear look. Slot 2 is never
# touched: it holds reviewed, scheduled Reels.
[CmdletBinding()]
param([string]$RootOverride)

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = "Continue"
$root = if ($RootOverride) { [IO.Path]::GetFullPath($RootOverride) } else { Split-Path -Parent $PSScriptRoot }
$executingCheckout = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$requestedContractRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
if (-not $executingCheckout.Equals($requestedContractRoot, [StringComparison]::OrdinalIgnoreCase)) {
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $fixtureRoot = $requestedContractRoot + '\'
    if ($env:LAUNDRY_EXECUTABLE_CONTRACT_TEST_SEAM -cne "allow-temp-production-runtime-shims-v1" -or -not $fixtureRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
        [Console]::Error.WriteLine("BLOCKED production contract: RootOverride does not match the executing scripts checkout.")
        exit 1
    }
}
. (Join-Path $PSScriptRoot "_production-contract.ps1")
$productionContract = Test-CleanProductionContract -Root $root
if (-not $productionContract.ok) {
    [Console]::Error.WriteLine("BLOCKED production contract before boutique image regeneration: $($productionContract.reason). No image deletion, generation, or Pages publish was run.")
    exit 1
}
Set-Location $root
$publicPublishBlocked = $false

foreach ($date in "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-07", "2026-08-09") {
    Write-Host "=== $date ==="
    Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --date $date 2>&1 | ForEach-Object { Write-Host $_ }
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "boutique image deletion")) { exit 1 }
    Get-ChildItem "docs\assets\$date" -Filter "slot-01*.png" -ErrorAction SilentlyContinue | Remove-Item -Force
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "boutique image generation")) { exit 1 }
    & (Join-Path $PSScriptRoot "generate-missing-images.ps1") -Date $date -SkipPublicSite -RootOverride $root
    if ($LASTEXITCODE -ne 0) { Write-Host "$date failed; stopping so the fault is visible."; exit 1 }
    if (-not (Assert-CleanProductionContractBeforeAction -Root $root -Stage "Pages publish")) {
        Write-Host "$date blocked: production contract changed before Pages publish."
        exit 1
    }
    $approval = Test-PublicPublicationApproval -Root $root -Date $date
    if (-not $approval.ok) {
        $publicPublishBlocked = $true
        Write-Host "$date local image regeneration is complete; Pages publish blocked: $($approval.reason). $($approval.gaps -join ' | ')"
        continue
    }
    Invoke-TrustedProductionNpm -Root $root run publish-pages -- --date $date --skip-audit 2>&1 | Select-String -Pattern "Published|Mirror" | Select-Object -First 2
}
if ($publicPublishBlocked) {
    Write-Host "Boutique images regenerated locally, but one or more Pages publishes remain blocked pending canonical approval proof."
    exit 1
}
Write-Host "All boutique-look images replaced and published."
