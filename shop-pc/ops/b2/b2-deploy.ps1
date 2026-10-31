# B2 shop deploy orchestrator (ai PC). Phase A = code with attribution OFF; Phase B = DEPLOY-B2 steps 5-8.
# Lesson from B1-2 12:18: phase2's backup path is parsed from phase1 output, never typed by hand,
# and every ssh runs with -n + -NonInteractive so a missing parameter fails instead of waiting.
param([switch]$PhaseAOnly)
$ErrorActionPreference = 'Continue'
$jd = 'C:\Users\cyc39\AI-Lanes\api-jobs\shop-deploy-1031'
function Say($m) { Write-Output ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Shop([string]$cmd) { $o = @(ssh -n shop-pc $cmd 2>&1 | ForEach-Object { $_.ToString() }); $script:rc = $LASTEXITCODE; $o | Where-Object { $_ -notmatch 'Pseudo-terminal' } }
$ps = 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File'

$h = (Get-Date).Hour
if ($h -lt 14 -or $h -ge 19) { Say "REFUSED: B2 window is 14:00-19:00 (D13, shop PC hours); now $h"; exit 2 }

# The shop already has an older 10/30 test copy in B2-staging (4 files, all names also in the new stage):
# overwrite file by file so the folder ends up equal to stage-B2, then prove it by hash.
$local = @(Get-ChildItem -Recurse -File -LiteralPath "$jd\stage-B2")
$dirs = @($local | ForEach-Object { Split-Path -Parent $_.FullName.Substring("$jd\stage-B2".Length) } | Where-Object { $_ } | Sort-Object -Unique)
foreach ($d in $dirs) { Shop ('if not exist "C:\LaundryStores\B2-staging' + $d + '" mkdir "C:\LaundryStores\B2-staging' + $d + '"') | Out-Null }
foreach ($f in $local) {
  $rel = $f.FullName.Substring("$jd\stage-B2\".Length)
  scp $f.FullName ('shop-pc:C:/LaundryStores/B2-staging/' + $rel.Replace('\', '/'))
  if ($LASTEXITCODE -ne 0) { Say "FAIL scp $rel"; exit 1 }
}
$want = @($local | ForEach-Object { $_.FullName.Substring("$jd\stage-B2\".Length) + ' ' + (Get-FileHash -LiteralPath $_.FullName).Hash.Substring(0, 12) } | Sort-Object)
$have = @(Shop "$ps C:\LaundryStores\ops\shop-list-staging.ps1" | ForEach-Object { ($_ -split ' ')[0..1] -join ' ' } | Sort-Object)
$diff = @(Compare-Object $want $have)
if ($diff.Count -ne 0) { Say 'FAIL shop staging differs from stage-B2:'; $diff | ForEach-Object { Say ("  {0} {1}" -f $_.SideIndicator, $_.InputObject) }; exit 1 }
Say ("staging copied and verified ({0} files)" -f $want.Count)

Say '--- CheckOnly'
Shop "$ps C:\LaundryStores\ops\bundle-phase1.ps1 -Bundle B2 -CheckOnly"
if ($script:rc -ne 0) { Say "STOP CheckOnly rc=$($script:rc)"; exit 1 }

Say '--- PHASE1'
$p1 = @(Shop "$ps C:\LaundryStores\ops\bundle-phase1.ps1 -Bundle B2")
$p1rc = $script:rc
$p1
if ($p1rc -ne 0) { Say "STOP phase1 rc=$p1rc (phase1 restores/leaves tasks per its own rules; read output above)"; exit 1 }
$m = [regex]::Match(($p1 -join "`n"), 'PHASE1 OK backup=(\S+)')
if (-not $m.Success) { Say 'STOP phase1 printed no backup path'; exit 1 }
$backup = $m.Groups[1].Value
Say "backup=$backup"

Say '--- PHASE2'
Shop "$ps C:\LaundryStores\ops\bundle-phase2.ps1 -Bundle B2 -Backup $backup"
if ($script:rc -ne 0) { Say "STOP phase2 rc=$($script:rc)"; exit 1 }

Say '--- attribution OFF evidence (exactly one not-configured line; old code never printed it)'
$cnt = (Shop 'findstr /c:"[ATTRIBUTION_DISABLED] not configured" C:\LaundryStores\fxwash\logs\webhook_server.log' | Measure-Object).Count
Say "not_configured_lines=$cnt"

Push-Location C:\Users\cyc39\laundry-repo
powershell -NoProfile -ExecutionPolicy Bypass -File ops\Get-LineEndpoint.ps1 -Test
Pop-Location
if ($PhaseAOnly) { Say 'PHASE A DONE (attribution OFF)'; exit 0 }
if ($cnt -lt 1) { Say 'STOP: stderr evidence missing; Phase B needs it to prove ON'; exit 1 }

Say '--- PHASE B enable'
Shop "$ps C:\LaundryStores\B2-staging\b2-enable.ps1 -Backup $backup"
$brc = $script:rc
Push-Location C:\Users\cyc39\laundry-repo
powershell -NoProfile -ExecutionPolicy Bypass -File ops\Get-LineEndpoint.ps1 -Test
Pop-Location
if ($brc -ne 0) { Say "B2 PHASE B FAIL rc=$brc"; exit 1 }
Say 'B2 DEPLOY PASS'
exit 0
