# Mutate only this task's uncommitted candidate, always restoring original bytes.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'src\publishRecovery.ts'
$bytes = [IO.File]::ReadAllBytes($target)
$utf8 = [Text.UTF8Encoding]::new($false)
$source = $utf8.GetString($bytes)
$before = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$env:TEMP = Join-Path $root 'output\operations\ops-l1-fixtures'
$env:TMP = $env:TEMP
Set-Location $root
try {
    $a = $source.IndexOf('  const evidence = await readPublicationEvidence(')
    $b = $source.IndexOf('  record.evidence = evidence.state;', $a)
    if ($a -lt 0 -or $b -le $a) { throw 'Readback mutation target not found' }
    $mutant = $source.Substring(0, $a) + "  const evidence = { state: 'absent' as const };`n" + $source.Substring($b)
    [IO.File]::WriteAllText($target, $mutant, $utf8)
    & node --import ./test/helpers/opsBootstrap.mjs node_modules/vitest/vitest.mjs run --config test/ops-l1-offline.config.ts --configLoader native --pool threads test/publishRecovery.test.ts --testNamePattern 'duplicate guard: a matching published post' --reporter=json --outputFile=reports/ops-l1-10-r1-mutation-readback.json
    $result = [IO.File]::ReadAllText((Join-Path $root 'reports\ops-l1-10-r1-mutation-readback.json')) | ConvertFrom-Json
    if ($result.numFailedTests -ne 1) { throw 'Readback mutant was not killed by the duplicate test' }
    Write-Output 'MUTATION_READBACK_RED failed=1 (duplicate send observed)'
    [IO.File]::WriteAllBytes($target, $bytes)
    $needle = 'delivered = await (input.sender ?? existingStaffGroup(input.root))(message, key);'
    if (-not $source.Contains($needle)) { throw 'Notification mutation target not found' }
    [IO.File]::WriteAllText($target, $source.Replace($needle, 'delivered = true;'), $utf8)
    & node --import ./test/helpers/opsBootstrap.mjs node_modules/vitest/vitest.mjs run --config test/ops-l1-offline.config.ts --configLoader native --pool threads test/publishRecovery.test.ts --testNamePattern 'unknown readback never resends' --reporter=json --outputFile=reports/ops-l1-10-r1-mutation-notice.json
    $result = [IO.File]::ReadAllText((Join-Path $root 'reports\ops-l1-10-r1-mutation-notice.json')) | ConvertFrom-Json
    if ($result.numFailedTests -ne 1) { throw 'Notification mutant was not killed by the silence test' }
    Write-Output 'MUTATION_NOTICE_RED failed=1 (notice missing)'
} finally {
    [IO.File]::WriteAllBytes($target, $bytes)
    $after = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($before -ne $after) { throw 'Candidate was not restored byte-for-byte' }
    Write-Output ('RESTORED_SHA256=' + $after)
}
