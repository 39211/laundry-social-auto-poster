[CmdletBinding()]
param([string]$RootPath = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath($RootPath)
. (Join-Path $PSScriptRoot "publish-slot-times.ps1")

$taipei = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $taipei)
if ($env:PUBLISH_GATE_DATE -or $env:PUBLISH_GATE_TIME) {
    $date = if ($env:PUBLISH_GATE_DATE) { $env:PUBLISH_GATE_DATE } else { $now.ToString("yyyy-MM-dd") }
    $time = if ($env:PUBLISH_GATE_TIME) { $env:PUBLISH_GATE_TIME } else { $now.ToString("HH:mm") }
    $now = [DateTime]::ParseExact(("{0} {1}" -f $date, $time), "yyyy-MM-dd HH:mm", [Globalization.CultureInfo]::InvariantCulture)
} else {
    $date = $now.ToString("yyyy-MM-dd")
    $time = $now.ToString("HH:mm")
}

$logDirectory = Join-Path $root "output\catch-up-logs"
[void][IO.Directory]::CreateDirectory($logDirectory)
$textLog = Join-Path $logDirectory ("gate-{0}.log" -f $date)
$triggerLog = Join-Path $logDirectory ("gate-{0}.json" -f $date)
function Write-GateLog([string]$message) {
    "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f $now, $message | Out-File -LiteralPath $textLog -Append -Encoding utf8
}

function Show-GateToast([string]$message) {
    if ($env:PUBLISH_GATE_TOAST_FILE) {
        ("TOAST|" + $message) | Out-File -LiteralPath $env:PUBLISH_GATE_TOAST_FILE -Append -Encoding utf8
        return
    }
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $nodes = $template.GetElementsByTagName("text")
        $nodes.Item(0).AppendChild($template.CreateTextNode("私享家發布時間閘門")) | Out-Null
        $nodes.Item(1).AppendChild($template.CreateTextNode($message)) | Out-Null
        $toast = New-Object Windows.UI.Notifications.ToastNotification($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("LaundryPublishGate").Show($toast)
    } catch {
        Write-GateLog ("Toast failed: " + $_.Exception.Message)
    }
}

function Test-CatchupProcessRunning {
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][object[]]$Processes,
        [Parameter(Mandatory = $true)][string]$CatchupPath,
        [int]$CurrentProcessId = $PID
    )
    $resolvedCatchupPath = [IO.Path]::GetFullPath($CatchupPath)
    foreach ($process in @($Processes)) {
        if ($null -eq $process -or [int]$process.ProcessId -eq $CurrentProcessId) { continue }
        $commandLine = [string]$process.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine)) { continue }
        foreach ($match in [regex]::Matches($commandLine, '(?i)-file\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))')) {
            $candidate = if ($match.Groups["quoted"].Success) { $match.Groups["quoted"].Value } else { $match.Groups["plain"].Value }
            try {
                if ([IO.Path]::GetFullPath($candidate) -ieq $resolvedCatchupPath) { return $true }
            } catch {}
        }
    }
    return $false
}

$calendarSlots = Get-CalendarSlots -Root $root -Date $date
if ($null -eq $calendarSlots) {
    Write-GateLog "Calendar unreadable; falling back to slots 1, 2, 3."
    $calendarSlots = [int[]]@(1, 2, 3)
}
$timeWarning = $null
$slotTimes = Get-SlotTimes -Root $root -Date $date -WarningMessage ([ref]$timeWarning)
if ($timeWarning) { Write-GateLog ([string]$timeWarning) }

$postedInstagramSlots = @()
$postedPath = Join-Path $root ("data\posted-log\{0}.json" -f $date)
if (Test-Path -LiteralPath $postedPath) {
    try {
        $posted = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($postedPath, [Text.UTF8Encoding]::new($false))) -ErrorAction Stop
        $postedInstagramSlots = @(@($posted) | Where-Object {
            $null -ne $_ -and $_.platform -eq "instagram" -and -not $_.dry_run -and @("success", "posted") -contains [string]$_.status
        } | ForEach-Object { [int]$_.slot } | Sort-Object -Unique)
    } catch {
        Write-GateLog ("posted-log unreadable; skipping safely: " + $_.Exception.Message)
        exit 1
    }
}

$effectivePublishSlots = @(Get-EffectivePublishSlots -CalendarSlots $calendarSlots)
$dueSlots = @()
$needed = @()
$nowTime = [TimeSpan]::ParseExact($time, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture)
foreach ($slot in $effectivePublishSlots) {
    if (-not $slotTimes.ContainsKey([int]$slot)) { continue }
    $scheduled = [TimeSpan]$slotTimes[[int]$slot]
    if ($nowTime -lt $scheduled -or $nowTime -ge ($scheduled + [TimeSpan]::FromHours(4))) { continue }
    $dueSlots += [int]$slot
    if ($postedInstagramSlots -contains [int]$slot) {
        Write-GateLog ("No publish needed: slot {0} already has a live Instagram record." -f $slot)
        continue
    }
    $needed += [int]$slot
}
$missingRequiredCalendarSlots = @(Get-MissingRequiredCalendarSlots -CalendarSlots $calendarSlots)
if ($missingRequiredCalendarSlots.Count -gt 0) {
    Write-GateLog ("Calendar missing required slot(s): {0}; mandatory due slot(s) still included: {1}." -f `
        ($missingRequiredCalendarSlots -join ","), ($dueSlots -join ","))
    Show-GateToast ("今天行事曆缺少必備 slot {0},時間閘門已停止,請先修復行事曆。" -f ($missingRequiredCalendarSlots -join ","))
    exit 1
}
if ($needed.Count -eq 0) {
    Write-GateLog "No due Instagram slot needs catch-up."
    exit 0
}

$history = [ordered]@{ date = $date; triggers = @() }
$nowAt = [DateTimeOffset]::new($now, [TimeSpan]::FromHours(8))
if (Test-Path -LiteralPath $triggerLog) {
    try {
        $prior = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($triggerLog, [Text.UTF8Encoding]::new($false))) -ErrorAction Stop
        if ($null -eq $prior -or $prior.date -cne $date -or $null -eq $prior.triggers) { throw "unexpected trigger-log shape" }
        $history.triggers = @($prior.triggers)
    } catch {
        Write-GateLog ("trigger log unreadable; refusing duplicate-risk trigger: " + $_.Exception.Message)
        exit 1
    }
}

$eligible = @()
foreach ($slot in $needed) {
    $priorSlot = @($history.triggers | Where-Object { [int]$_.slot -eq $slot } | Sort-Object { [DateTimeOffset]::Parse([string]$_.triggered_at).UtcDateTime })
    if ($priorSlot.Count -ge 2) {
        Write-GateLog ("Slot {0} reached its two-trigger daily limit." -f $slot)
        continue
    }
    if ($priorSlot.Count -eq 1) {
        $lastAt = [DateTimeOffset]::Parse([string]$priorSlot[0].triggered_at)
        if (($nowAt - $lastAt) -lt [TimeSpan]::FromMinutes(30)) {
            Write-GateLog ("Slot {0} retry is less than 30 minutes after the prior trigger." -f $slot)
            continue
        }
    }
    $eligible += [int]$slot
}
if ($eligible.Count -eq 0) { exit 0 }

$catchupPath = [IO.Path]::GetFullPath((Join-Path $root "scripts\catchup-publish.ps1"))
$catchupRunning = $false
try {
    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $catchupRunning = Test-CatchupProcessRunning -Processes $processes -CatchupPath $catchupPath -CurrentProcessId $PID
} catch {
    Write-GateLog ("Could not confirm catch-up process state; skipping safely: " + $_.Exception.Message)
    exit 0
}
if ($catchupRunning) {
    Write-GateLog "Catch-up process already running; this gate round is skipped."
    exit 0
}

Write-GateLog ("Starting catch-up for slot(s): " + ($eligible -join ","))
$exitCode = 1
try {
    if ($env:PUBLISH_GATE_CATCHUP_CMD) {
        & cmd.exe /d /c $env:PUBLISH_GATE_CATCHUP_CMD
        $exitCode = $LASTEXITCODE
    } else {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $catchupPath
        $exitCode = $LASTEXITCODE
    }
} catch {
    Write-GateLog ("Catch-up invocation threw: " + $_.Exception.Message)
    $exitCode = 1
}

$triggeredAt = $nowAt.ToString("o")
foreach ($slot in $eligible) {
    $attempt = @($history.triggers | Where-Object { [int]$_.slot -eq $slot }).Count + 1
    $history.triggers += [pscustomobject]@{ slot = [int]$slot; attempt = $attempt; triggered_at = $triggeredAt; exit_code = [int]$exitCode }
}
[IO.File]::WriteAllText($triggerLog, (($history | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-GateLog ("Catch-up exited {0}; recorded trigger for slot(s) {1}." -f $exitCode, ($eligible -join ","))
exit $exitCode
