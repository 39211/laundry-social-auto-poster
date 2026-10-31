# DEPLOY-B2 steps 5-8 on the shop PC (owner D13: B2 live 10/31 afternoon). ASCII only, PS 5.1.
# Never prints the key, uid, message text or data-file content.
param([Parameter(Mandatory = $true)][string]$Backup)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
$root = 'C:\LaundryStores\fxwash'
$py = 'C:\LaundryStores\python-portable\python.exe'
$st = 'C:\LaundryStores\B2-staging'
$rx = 'LaundryStores\\fxwash\\runtime\\webhook_server\.py'
if (-not (Test-Path -LiteralPath $Backup -PathType Container)) { Say "REFUSED backup dir missing: $Backup"; exit 2 }

# step 6 prerequisites: registry + key tool
foreach ($rel in 'tools\make_attribution_secret.py', 'data\attribution\source-codes.json') {
  $dst = Join-Path $root $rel
  if (-not (Test-Path -LiteralPath $dst)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath (Join-Path $st $rel) -Destination $dst
    Say "copied $rel"
  } else { Say "kept existing $rel" }
  Say ("sha {0} {1}" -f $rel, (Get-FileHash -LiteralPath $dst).Hash.Substring(0, 12))
}

# step 5: key, created once, never overwritten, never printed
$key = Join-Path $root 'secrets\attribution_hmac.key'
if (Test-Path -LiteralPath $key) { Say 'key exists; kept (never overwritten)' }
else {
  Push-Location -LiteralPath $root
  try {
    $ErrorActionPreference = 'Continue'
    $out = @(& $py -I -S -B 'tools\make_attribution_secret.py' 'secrets\attribution_hmac.key' 2>&1 | ForEach-Object { $_.ToString() })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    foreach ($l in $out) { Say "key| $l" }
    if ($rc -ne 0) { Say "FAIL key creation rc=$rc"; exit 1 }
  } finally { Pop-Location }
}
Say ("key file bytes={0}" -f (Get-Item -LiteralPath $key).Length)

# step 7: shop.json key (backup first, minimal insert, parse-checked)
$sj = Join-Path $root 'shop.json'
$bk = Join-Path $Backup 'shop.json.before-B2'
if (-not (Test-Path -LiteralPath $bk)) { Copy-Item -LiteralPath $sj -Destination $bk }
Say ("shop.json backup sha {0} live sha {1}" -f (Get-FileHash -LiteralPath $bk).Hash.Substring(0, 12), (Get-FileHash -LiteralPath $sj).Hash.Substring(0, 12))
$ErrorActionPreference = 'Continue'
$out = @(& $py -I -S -B (Join-Path $st 'b2_shopjson.py') $sj 2>&1 | ForEach-Object { $_.ToString() })
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
foreach ($l in $out) { Say "shopjson| $l" }
if ($rc -ne 0 -and $rc -ne 3) { Say "FAIL shop.json edit rc=$rc (file untouched)"; exit 1 }
# positive evidence before restart: the startup path builds an enabled ledger with this config
Push-Location -LiteralPath $root
try {
  $ErrorActionPreference = 'Continue'
  $out = @(& $py -I -S -B (Join-Path $st 'b2_selfcheck.py') 2>&1 | ForEach-Object { $_.ToString() })
  $rc = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
} finally { Pop-Location }
foreach ($l in $out) { Say "selfcheck| $l" }
if ($rc -ne 0) { Say "FAIL selfcheck rc=$rc; restoring shop.json from backup, webhook NOT restarted"; Copy-Item -LiteralPath $bk -Destination $sj -Force; exit 1 }

# step 8: restart the webhook through the watchdog (shop.json is read once at startup)
$log = Join-Path $root 'logs\webhook_server.log'
$offset = 0L; if (Test-Path -LiteralPath $log) { $offset = (Get-Item -LiteralPath $log).Length }
$t0 = Get-Date
$old = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $rx })
foreach ($p in $old) { Stop-Process -Id $p.ProcessId -Force; Say "stopped webhook pid $($p.ProcessId)" }
$deadline = (Get-Date).AddSeconds(10)
while ((Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
Start-ScheduledTask -TaskName 'FXwash-Watchdog'
Say 'kicked FXwash-Watchdog'
$deadline = (Get-Date).AddSeconds(45)
do {
  Start-Sleep -Seconds 3
  $new = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $rx })
  $listen = Get-NetTCPConnection -LocalPort 18791 -State Listen -ErrorAction SilentlyContinue
} until (($new.Count -eq 1 -and $new[0].CreationDate -ge $t0.AddSeconds(-2) -and $listen) -or (Get-Date) -gt $deadline)
$fails = 0
if ($new.Count -eq 1 -and $new[0].CreationDate -ge $t0.AddSeconds(-2)) { Say ("PASS webhook restarted pid {0} created={1}" -f $new[0].ProcessId, $new[0].CreationDate.ToString('HH:mm:ss')) } else { $fails++; Say "FAIL webhook restart count=$($new.Count)" }
if ($listen) { Say "PASS 18791 listening pid $($listen.OwningProcess)" } else { $fails++; Say 'FAIL 18791 not listening' }
Start-Sleep -Seconds 3
$fresh = ''
if (Test-Path -LiteralPath $log) {
  $fs = New-Object IO.FileStream($log, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try { if ($fs.Length -ge $offset) { [void]$fs.Seek($offset, [IO.SeekOrigin]::Begin) }; $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8); $fresh = $sr.ReadToEnd() } finally { $fs.Dispose() }
}
$disabled = ([regex]::Matches($fresh, '\[ATTRIBUTION_DISABLED\][^\r\n]*') | ForEach-Object { $_.Value })
$tb = ([regex]::Matches($fresh, 'Traceback|ImportError|SyntaxError')).Count
$err = ([regex]::Matches($fresh, '\[ATTRIBUTION_ERROR\][^\r\n]*') | ForEach-Object { $_.Value })
Say ("log since restart bytes={0} disabled_lines={1} attribution_error_lines={2} traceback={3}" -f $fresh.Length, @($disabled).Count, @($err).Count, $tb)
foreach ($d in @($disabled)) { Say "log| $d" }
foreach ($d in @($err)) { Say "log| $d" }
if (@($disabled).Count -gt 0) { $fails++; Say 'FAIL attribution still disabled after restart' } else { Say 'PASS no [ATTRIBUTION_DISABLED] after restart (= ON)' }
if ($tb -gt 0) { $fails++; Say 'FAIL traceback in webhook log' }
$inq = Join-Path $root 'data\inquiries.jsonl'
Say ("inquiries.jsonl exists={0} bytes={1}" -f (Test-Path -LiteralPath $inq), $(if (Test-Path -LiteralPath $inq) { (Get-Item -LiteralPath $inq).Length } else { 0 }))
if ($fails -eq 0) { Say 'B2 ENABLE PASS'; exit 0 } else { Say "B2 ENABLE FAIL fails=$fails"; exit 1 }
