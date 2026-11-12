# Original wrapper tests model no retirements and already stub neighbouring
# I/O. Real policy/CLI coverage lives in slotRetirement.powershell.test.ts.
function Install-LegacySlotRetirementFixture([string]$Root) {
    [void][IO.Directory]::CreateDirectory((Join-Path $Root 'src'))
    [void][IO.Directory]::CreateDirectory((Join-Path $Root 'scripts'))
    [IO.File]::WriteAllText((Join-Path $Root 'src\slot-retirements.json'), '{"version":1,"retirements":[]}', [Text.UTF8Encoding]::new($false))
    $bridge = 'function Remove-RetiredPublishSlots { param([AllowEmptyCollection()][int[]]$Slots, [string]$Root, [string]$Date); return [int[]]@($Slots) }'
    [IO.File]::WriteAllText((Join-Path $Root 'scripts\slot-retirements.ps1'), $bridge, [Text.UTF8Encoding]::new($true))
}
