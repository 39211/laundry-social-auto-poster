# Dot-sourced by scheduled workers to observe scheduler safety.  A disabled
# Laundry task is an operator kill switch: this helper never enables, starts,
# unregisters, or registers a task.  A human must inspect the state and use
# the explicit guarded registration workflow when a change is intentional.
#
# Expects $root and optionally $logFile from the caller.  Observe-only callers
# intentionally do not query the host scheduler, so their reports remain
# hermetic and cannot depend on local Task Scheduler state.
if ($WatchdogObserveOnly) { return }

function Stop-WatchdogSchedulerSafety([string]$Reason) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] BLOCKED scheduler safety: {1}. No task was enabled, unregistered, or registered." -f (Get-Date), $Reason
    [Console]::Error.WriteLine($line)
    if ($logFile) {
        try { $line | Add-Content -Path $logFile -Encoding UTF8 } catch {}
    }
    throw $line
}

if ($ProductionContractVerified -ne $true) {
    Stop-WatchdogSchedulerSafety "no verified clean production contract is available for task-state inspection"
}
$watchdogRoot = [string](Get-Variable -Name root -ValueOnly -ErrorAction SilentlyContinue)
if ([string]::IsNullOrWhiteSpace($watchdogRoot) -or -not (Get-Command Assert-CleanProductionContractBeforeAction -ErrorAction SilentlyContinue)) {
    Stop-WatchdogSchedulerSafety "no reusable production-contract boundary is available"
}

try {
    $watchdogTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like "Laundry-*" })
} catch {
    Stop-WatchdogSchedulerSafety ("Laundry task inventory is unverifiable: " + $_.Exception.Message)
}

$legacySentinels = @($watchdogTasks | Where-Object { $_.TaskName -ceq "Laundry-Publish-Sentinel" })
if ($legacySentinels.Count -gt 0) {
    Stop-WatchdogSchedulerSafety "legacy Laundry-Publish-Sentinel is present; manual review/removal is required"
}

$disabledTasks = @($watchdogTasks | Where-Object { $_.State -eq "Disabled" })
if ($disabledTasks.Count -gt 0) {
    $names = ($disabledTasks | ForEach-Object { $_.TaskName }) -join ", "
    Stop-WatchdogSchedulerSafety "operator kill switch is active for disabled Laundry task(s): $names"
}
