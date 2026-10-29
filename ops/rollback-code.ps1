# Emits instructions ONLY. Never checks out code, creates a worktree or stops processes.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/-]*$')][string]$ToTag,
    [string]$Root = 'C:\Users\cyc39\laundry-repo'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Repository does not exist: $Root" }
$commit = & git -C $Root rev-parse --verify ('refs/tags/' + $ToTag + '^{commit}') 2>$null
if ($LASTEXITCODE -ne 0 -or -not $commit) { throw "Tag is absent or not a commit: $ToTag" }
$quotedRoot = "'" + $Root.Replace("'", "''") + "'"
$quotedTag = "'" + $ToTag.Replace("'", "''") + "'"
@(
    '# PLAN ONLY. Execute separately in an approved maintenance window.'
    ('# Verified tag commit: ' + $commit)
    ('$liveRoot = ' + $quotedRoot)
    ('$rollbackTag = ' + $quotedTag)
    '# First run and validate a real backup. Save the current commit and branch in the incident record.'
    'git -C $liveRoot rev-parse HEAD'
    'git -C $liveRoot branch --show-current'
    '$dirty = @(git -C $liveRoot status --porcelain=v1 --untracked-files=all)'
    'if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw "Dirty/untracked work: stop and preserve it first." }'
    '# Pause only the recorded watchdog task(s) for this service; record their Enabled state first.'
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $liveRoot "line-bot/run_line_bot.ps1") -Stop'
    'if ($LASTEXITCODE -ne 0) { throw "Stop failed." }'
    '# Verify process command lines/listener PIDs; stale PID files can leave duplicate processes. See RUNBOOK scenario A.'
    '# Continue only after no service-owned process remains.'
    'git -C $liveRoot checkout --detach --no-overwrite-ignore $rollbackTag'
    'if ($LASTEXITCODE -ne 0) { throw "Checkout failed. Do not start the service." }'
    'git -C $liveRoot rev-parse HEAD'
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $liveRoot "line-bot/run_line_bot.ps1")'
    'if ($LASTEXITCODE -ne 0) { throw "Start failed." }'
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $liveRoot "line-bot/run_line_bot.ps1") -Probe'
    'if ($LASTEXITCODE -ne 0) { throw "Probe failed. Keep the incident open." }'
    '# Verify process uniqueness, webhook reachability, then restore only previously enabled watchdog tasks.'
    '# Do not use git reset --hard, git clean, or move/delete the live junction.'
)
