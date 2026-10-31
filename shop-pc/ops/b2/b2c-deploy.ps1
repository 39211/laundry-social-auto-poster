# B2c: shop_config accepts shop.json["attribution"]; all three services restart once with it ON.
# phase1 B2c (stop 3 + deploy shop_config) -> b2c-config (shop.json + selfcheck, restores on fail)
# -> phase2 B2c ALWAYS (services come back either way) -> LINE webhook/test -> ON evidence.
$ErrorActionPreference = 'Continue'
$jd = 'C:\Users\cyc39\AI-Lanes\api-jobs\shop-deploy-1031'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Shop([string]$cmd) { $o = @(ssh -n shop-pc $cmd 2>&1 | ForEach-Object { $_.ToString() }); $script:rc = $LASTEXITCODE; $o | Where-Object { $_ -notmatch 'Pseudo-terminal' } }
$ps = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File'
$h = (Get-Date).Hour; if ($h -lt 14 -or $h -ge 19) { Say "REFUSED outside 14-19 ($h)"; exit 2 }

# copy: B2c staging (fresh), new selfcheck into B2-staging, patched bundle scripts (old ones kept as .pre-b2c)
$e = (Shop 'if exist C:\LaundryStores\B2c-staging (echo EXISTS) else (echo MISSING)') -join ''
if ($e -match 'EXISTS') { Say 'REFUSED B2c-staging exists'; exit 2 }
Shop 'copy /y C:\LaundryStores\ops\bundle-phase1.ps1 C:\LaundryStores\ops\bundle-phase1.ps1.pre-b2c && copy /y C:\LaundryStores\ops\bundle-phase2.ps1 C:\LaundryStores\ops\bundle-phase2.ps1.pre-b2c' | Out-Null
if ($script:rc -ne 0) { Say 'FAIL backup of bundle scripts'; exit 1 }
scp -r "$jd/stage-B2c" shop-pc:C:/LaundryStores/B2c-staging
scp "$jd/stage-B2/b2_selfcheck.py" shop-pc:C:/LaundryStores/B2-staging/b2_selfcheck.py
scp "$jd/bundle-phase1.ps1" shop-pc:C:/LaundryStores/ops/bundle-phase1.ps1
scp "$jd/bundle-phase2.ps1" shop-pc:C:/LaundryStores/ops/bundle-phase2.ps1
scp "$jd/b2c-evidence.ps1" shop-pc:C:/LaundryStores/ops/b2c-evidence.ps1
scp "$jd/kick-services.ps1" shop-pc:C:/LaundryStores/ops/kick-services.ps1
$want = @(Get-ChildItem -Recurse -File -LiteralPath "$jd\stage-B2c" | ForEach-Object { $_.FullName.Substring("$jd\stage-B2c\".Length) + ' ' + (Get-FileHash -LiteralPath $_.FullName).Hash.Substring(0, 12) } | Sort-Object)
$have = @(Shop "$ps C:\LaundryStores\ops\shop-list-staging.ps1 -Dir C:\LaundryStores\B2c-staging" | ForEach-Object { ($_ -split ' ')[0..1] -join ' ' } | Sort-Object)
if (@(Compare-Object $want $have).Count -ne 0) { Say 'FAIL B2c staging differs'; exit 1 }
$sc = (Shop "$ps C:\LaundryStores\ops\shop-list-staging.ps1 -Dir C:\LaundryStores\B2-staging" | Where-Object { $_ -match '^b2_selfcheck.py ' }) -join ''
Say "shop selfcheck: $sc / local $((Get-FileHash "$jd\stage-B2\b2_selfcheck.py").Hash.Substring(0,12))"
foreach ($f in 'bundle-phase1.ps1', 'bundle-phase2.ps1') { Say ("local {0} {1}" -f $f, (Get-FileHash "$jd\$f").Hash.Substring(0, 12)) }

Say '--- CheckOnly B2c'
Shop "$ps C:\LaundryStores\ops\bundle-phase1.ps1 -Bundle B2c -CheckOnly"
if ($script:rc -ne 0) { Say "STOP CheckOnly rc=$($script:rc)"; exit 1 }

Say '--- PHASE1 B2c (LINE down from here until phase2)'
$p1 = @(Shop "$ps C:\LaundryStores\ops\bundle-phase1.ps1 -Bundle B2c")
$p1rc = $script:rc
$p1
if ($p1rc -ne 0) { Say "STOP phase1 rc=$p1rc (phase1 rolled back and kicked the watchdog itself)"; exit 1 }
$m = [regex]::Match(($p1 -join "`n"), 'PHASE1 OK backup=(\S+)')
if (-not $m.Success) { Say 'STOP no backup path; re-enabling tasks and kicking the watchdog'; Shop "$ps C:\LaundryStores\ops\kick-services.ps1"; exit 1 }
$backup = $m.Groups[1].Value
Say "backup=$backup"

Say '--- B2c config (shop.json attribution + selfcheck)'
Shop "$ps C:\LaundryStores\B2c-staging\b2c-config.ps1 -Backup $backup"
$cfgrc = $script:rc
Say "config rc=$cfgrc (phase2 runs either way)"

Say '--- PHASE2 B2c'
$t2 = Get-Date
Shop "$ps C:\LaundryStores\ops\bundle-phase2.ps1 -Bundle B2c -Backup $backup"
$p2rc = $script:rc

Push-Location C:\Users\cyc39\laundry-repo
powershell -NoProfile -ExecutionPolicy Bypass -File ops\Get-LineEndpoint.ps1 -Test
Pop-Location

Say '--- ON evidence after restart'
Shop "$ps C:\LaundryStores\ops\b2c-evidence.ps1 -Since $($t2.AddSeconds(-5).ToString('yyyy-MM-ddTHH:mm:ss'))"
if ($p2rc -ne 0) { Say "B2c PHASE2 FAIL rc=$p2rc"; exit 1 }
if ($cfgrc -ne 0) { Say 'B2c: services back with attribution OFF (config step failed, shop.json restored)'; exit 1 }
Say 'B2c DEPLOY PASS'
exit 0
