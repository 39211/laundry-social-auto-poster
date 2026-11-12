. (Join-Path $PSScriptRoot "slot-retirements.ps1")

function Get-CalendarSlots {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$Date)

    $path = Join-Path $Root ("data\content-calendar\{0}.json" -f $Date)
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        $raw = [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
        $calendar = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        if ($null -eq $calendar -or $null -eq $calendar.slots) { return @() }
        $slots = @($calendar.slots | ForEach-Object {
            if ($null -ne $_ -and [string]$_.slot -match '^\d+$') { [int]$_.slot }
        } | Sort-Object -Unique)
        return ,([int[]]$slots)
    } catch {
        return $null
    }
}

# This snapshot is covered by the calendar checksum. The TS publication gate
# verifies that checksum; operational expectations must survive policy removal.
function Get-CalendarRetiredSlots {
    param([string]$Root, [string]$Date)
    if (-not $Root -or -not $Date) { return [int[]]@() }
    $path = Join-Path $Root ("data\content-calendar\{0}.json" -f $Date)
    try {
        $calendar = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))) -ErrorAction Stop
        if ($calendar.date -cne $Date -or $calendar.written_by -cne 'contentPlan.writeDailyContent' -or
            [string]$calendar.content_checksum -notmatch '^[0-9a-f]{16}$' -or $null -eq $calendar.retired_slots) { return [int[]]@() }
        $retired = @($calendar.retired_slots)
        $present = @($calendar.slots | ForEach-Object { $_.slot })
        foreach ($slot in $retired) {
            if ($slot -is [string] -or $slot -is [bool] -or $slot -isnot [ValueType] -or
                [double]$slot -ne [math]::Truncate([double]$slot) -or [double]$slot -lt 1 -or
                [double]$slot -gt [int]::MaxValue -or $present -contains $slot) { return [int[]]@() }
        }
        return [int[]]@($retired | Sort-Object -Unique)
    } catch { return [int[]]@() }
}

function Get-DefaultSlotTimes {
    return @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
}

function Get-EffectivePublishSlots {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyCollection()][object]$CalendarSlots, [string]$Root, [string]$Date)

    if ($null -eq $CalendarSlots) { return (Remove-RetiredPublishSlots -Slots @(1, 2, 3) -Root $Root -Date $Date) }
    $slots = [int[]]@(1, 2)
    if (@($CalendarSlots) -contains 3) { $slots += 3 }
    $savedRetired = @(Get-CalendarRetiredSlots -Root $Root -Date $Date)
    $slots = [int[]]@($slots | Where-Object { $savedRetired -notcontains $_ })
    return (Remove-RetiredPublishSlots -Slots $slots -Root $Root -Date $Date)
}

function Get-MissingRequiredCalendarSlots {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyCollection()][object]$CalendarSlots, [string]$Root, [string]$Date)

    if ($null -eq $CalendarSlots) { return [int[]]@() }
    $present = @($CalendarSlots)
    $required = @(Remove-RetiredPublishSlots -Slots @(1, 2) -Root $Root -Date $Date)
    $savedRetired = @(Get-CalendarRetiredSlots -Root $Root -Date $Date)
    $missing = @($required | Where-Object { $present -notcontains $_ -and $savedRetired -notcontains $_ })
    return [int[]]$missing
}

function Get-SlotTimes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Date,
        [ref]$WarningMessage
    )

    if ($WarningMessage) { $WarningMessage.Value = $null }
    $times = Get-DefaultSlotTimes
    $savedRetired = @(Get-CalendarRetiredSlots -Root $Root -Date $Date)
    $active = @(Remove-RetiredPublishSlots -Slots @(1, 2, 3) -Root $Root -Date $Date | Where-Object { $savedRetired -notcontains $_ })
    foreach ($slot in @(1, 2, 3)) { if ($active -notcontains $slot) { $times.Remove($slot) } }
    $path = Join-Path $Root ("data\publish-times\{0}.json" -f $Date)
    if (-not (Test-Path -LiteralPath $path)) { return $times }
    try {
        $raw = [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false))
        $daily = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
        if ($null -eq $daily -or $daily.date -cne $Date -or $null -eq $daily.slots) {
            throw "date mismatch or slots missing"
        }
        $parsed = @()
        $seenSlots = @{}
        foreach ($entry in @($daily.slots)) {
            if ($null -eq $entry -or $entry.slot -is [string] -or $entry.slot -is [bool] -or $entry.slot -isnot [ValueType]) { throw "slot must be an integer" }
            $slotNumber = [double]$entry.slot
            if ($slotNumber -ne [math]::Truncate($slotNumber) -or $slotNumber -lt [int]::MinValue -or $slotNumber -gt [int]::MaxValue) { throw "slot must be an integer" }
            if ($seenSlots.ContainsKey([int]$slotNumber)) { throw ("duplicate slot {0}" -f [int]$slotNumber) }
            $seenSlots[[int]$slotNumber] = $true
            if ([string]$entry.time -notmatch '^(?:[01]\d|2[0-3]):[0-5]\d$') { throw "time must be HH:MM" }
            $parsed += [pscustomobject]@{ Slot = [int]$slotNumber; Time = [TimeSpan]::ParseExact([string]$entry.time, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture) }
        }
        $activeParsed = @(Remove-RetiredPublishSlots -Slots @($parsed | ForEach-Object { $_.Slot }) -Root $Root -Date $Date | Where-Object { $savedRetired -notcontains $_ })
        foreach ($entry in $parsed) { if ($activeParsed -contains $entry.Slot) { $times[$entry.Slot] = $entry.Time } }
        return $times
    } catch {
        if ($WarningMessage) { $WarningMessage.Value = "Invalid publish-time file {0}; using defaults: {1}" -f $path, $_.Exception.Message }
        return $times
    }
}

function Get-CatchupSlotWindows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][TimeSpan]$NowTime,
        [Parameter(Mandatory = $true)][hashtable]$SlotTimes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]]$CalendarSlots,
        [TimeSpan]$RecoveryWindow = ([TimeSpan]::FromHours(4))
    )
    $due = @()
    $stale = @()
    foreach ($slot in @(Get-EffectivePublishSlots -CalendarSlots $CalendarSlots)) {
        if (-not $SlotTimes.ContainsKey([int]$slot)) { continue }
        $scheduled = [TimeSpan]$SlotTimes[[int]$slot]
        if ($NowTime -lt $scheduled) { continue }
        if (($NowTime - $scheduled) -le $RecoveryWindow) { $due += [int]$slot }
        else { $stale += [int]$slot }
    }
    return [pscustomobject]@{ DueSlots = [int[]]@($due); StaleSlots = [int[]]@($stale) }
}

function Test-NeedsPublishRescue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][TimeSpan]$NowTime,
        [Parameter(Mandatory = $true)][hashtable]$SlotTimes,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]]$CalendarSlots,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][int[]]$PostedSlots,
        [TimeSpan]$RecoveryWindow = ([TimeSpan]::FromHours(4))
    )
    foreach ($slot in @(Get-EffectivePublishSlots -CalendarSlots $CalendarSlots)) {
        if (-not $SlotTimes.ContainsKey([int]$slot)) { continue }
        $scheduled = [TimeSpan]$SlotTimes[[int]$slot]
        $inWindow = ($NowTime -ge $scheduled) -and (($NowTime - $scheduled) -le $RecoveryWindow)
        if ($inWindow -and ($PostedSlots -notcontains [int]$slot)) { return $true }
    }
    return $false
}
