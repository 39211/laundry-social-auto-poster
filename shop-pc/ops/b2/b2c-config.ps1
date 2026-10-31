# B2c step between phase1 (all three services stopped, watchdog disabled) and phase2.
# Adds shop.json["attribution"] and proves load_shop + an enabled ledger; on any failure restores
# shop.json so phase2 brings the services back exactly as before. ASCII only, PS 5.1.
param([Parameter(Mandatory = $true)][string]$Backup)
$ErrorActionPreference = 'Stop'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
$root = 'C:\LaundryStores\fxwash'
$py = 'C:\LaundryStores\python-portable\python.exe'
$b2 = 'C:\LaundryStores\B2-staging'
if (-not (Test-Path -LiteralPath $Backup -PathType Container)) { Say "REFUSED backup dir missing: $Backup"; exit 2 }
$key = Join-Path $root 'secrets\attribution_hmac.key'
if (-not (Test-Path -LiteralPath $key)) { Say 'REFUSED key missing (created 10/31 14:03 by b2-enable)'; exit 2 }
Say ("key file bytes={0} (kept)" -f (Get-Item -LiteralPath $key).Length)
$sj = Join-Path $root 'shop.json'
$bk = Join-Path $Backup 'shop.json.before-B2c'
Copy-Item -LiteralPath $sj -Destination $bk -Force
Say ("shop.json backup sha {0}" -f (Get-FileHash -LiteralPath $bk).Hash.Substring(0, 12))
function Run-Py([string[]]$a, [string]$label) {
  $ErrorActionPreference = 'Continue'
  $o = @(& $py @a 2>&1 | ForEach-Object { $_.ToString() })
  $r = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  # 10/31 14:19 bug: Say inside this function went into the return value and broke the [int] cast.
  # Write straight to the console so the only pipeline output is the exit code (same fix as phase1 Invoke-Py).
  foreach ($l in $o) { [Console]::Out.WriteLine(("[{0}] {1}| {2}" -f (Get-Date -Format 'HH:mm:ss'), $label, $l)) }
  return [int]$r
}
Push-Location -LiteralPath $root
try {
  [int]$rc = Run-Py @('-I', '-S', '-B', (Join-Path $b2 'b2_shopjson.py'), $sj) 'shopjson'
  if ($rc -ne 0 -and $rc -ne 3) { Say "FAIL shop.json edit rc=$rc (file untouched)"; exit 1 }
  [int]$rc = Run-Py @('-I', '-S', '-B', (Join-Path $b2 'b2_selfcheck.py')) 'selfcheck'
} finally { Pop-Location }
if ($rc -ne 0) {
  Copy-Item -LiteralPath $bk -Destination $sj -Force
  Say ("FAIL selfcheck rc=$rc; shop.json restored sha {0}" -f (Get-FileHash -LiteralPath $sj).Hash.Substring(0, 12))
  exit 1
}
Say 'B2c CONFIG OK (attribution key in shop.json, load_shop ok, ledger enabled)'
exit 0
