function Get-SlotRetirementPolicy {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$Date)
    $policyPath = Join-Path $Root 'src\slot-retirements.json'
    $file = Get-Item -LiteralPath $policyPath -ErrorAction SilentlyContinue
    $revision = if ($file) { '{0}:{1}' -f $file.LastWriteTimeUtc.Ticks, $file.Length } else { 'unreadable' }
    $key = '{0}:{1}:{2}' -f $Root, $Date, $revision
    if (-not (Get-Variable -Name SlotRetirementPolicyCache -Scope Script -ErrorAction SilentlyContinue)) { $script:SlotRetirementPolicyCache = @{} }
    if ($script:SlotRetirementPolicyCache.ContainsKey($key)) { return $script:SlotRetirementPolicyCache[$key] }
    $result = $null
    try {
        $cli = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src\slotRetirements.ts'))
        $loader = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\node_modules\tsx\dist\loader.mjs'))
        if (-not (Test-Path -LiteralPath $cli) -or -not (Test-Path -LiteralPath $loader)) { throw 'retirement reader unavailable' }
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.FileName = (Get-Command node.exe -ErrorAction Stop).Source
        $loaderUrl = ([Uri]$loader).AbsoluteUri
        $start.Arguments = '--import "{0}" "{1}" --root "{2}" --date "{3}"' -f $loaderUrl, $cli, $Root, $Date
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($start)
        try {
            $stdout = $process.StandardOutput.ReadToEndAsync()
            $stderr = $process.StandardError.ReadToEndAsync()
            if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'retirement reader timed out' }
            if ($process.ExitCode -ne 0) { throw 'retirement reader failed' }
            $result = ConvertFrom-Json -InputObject $stdout.Result -ErrorAction Stop
            if ($null -eq $result.retiredSlots -or $result.date -cne $Date) { throw 'retirement reader returned invalid data' }
        } finally { $process.Dispose() }
    } catch {
        $result = [pscustomobject]@{ retiredSlots = @(2); error = 'slot-retirements reader unavailable; slot 2 blocked (fail closed)' }
    }
    if ($result.error) {
        if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log ([string]$result.error) }
        else { Write-Warning ([string]$result.error) }
    }
    $script:SlotRetirementPolicyCache[$key] = $result
    return $result
}

function Remove-RetiredPublishSlots {
    param([AllowEmptyCollection()][int[]]$Slots, [string]$Root, [string]$Date)
    if (-not $Root -or -not $Date) { return [int[]]@($Slots) }
    $policy = Get-SlotRetirementPolicy -Root $Root -Date $Date
    return [int[]]@($Slots | Where-Object { @($policy.retiredSlots) -notcontains $_ })
}
