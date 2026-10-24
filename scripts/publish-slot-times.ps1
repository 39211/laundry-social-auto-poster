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

function Get-DefaultSlotTimes {
    return @{ 1 = [TimeSpan]"11:30"; 2 = [TimeSpan]"20:30"; 3 = [TimeSpan]"12:00" }
}

function Get-EffectivePublishSlots {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyCollection()][object]$CalendarSlots)

    if ($null -eq $CalendarSlots) { return [int[]]@(1, 2, 3) }
    $slots = [int[]]@(1, 2)
    if (@($CalendarSlots) -contains 3) { $slots += 3 }
    return $slots
}

function Get-MissingRequiredCalendarSlots {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyCollection()][object]$CalendarSlots)

    if ($null -eq $CalendarSlots) { return [int[]]@() }
    $present = @($CalendarSlots)
    $missing = @(@(1, 2) | Where-Object { $present -notcontains $_ })
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
        foreach ($entry in $parsed) { $times[$entry.Slot] = $entry.Time }
        return $times
    } catch {
        if ($WarningMessage) { $WarningMessage.Value = "Invalid publish-time file {0}; using defaults: {1}" -f $path, $_.Exception.Message }
        return (Get-DefaultSlotTimes)
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
