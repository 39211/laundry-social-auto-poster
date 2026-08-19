# Read-only bridge from Task Scheduler scripts to the tested TypeScript
# publication contract. It deliberately performs no API call or file write.
function Normalize-PublishingReconciliation {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][object]$Result)

    foreach ($property in "expected_reel_slots", "uploaded_reel_slots", "missing_reel_slots", "unexpected_youtube_slots") {
        # ConvertFrom-Json in Windows PowerShell can represent an empty JSON
        # array as $null. Distinguish that valid empty value from a missing
        # contract field, then normalize it before any scheduled loop sees it.
        if ($Result.PSObject.Properties.Name -notcontains $property) {
            throw "Reconciliation result is missing $property."
        }
        if ($null -eq $Result.$property) {
            $Result.$property = @()
        } elseif ($Result.$property -isnot [System.Array]) {
            $Result.$property = @($Result.$property)
        }
    }
    return $Result
}

function Invoke-PublishingContractCli {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Date,
        [switch]$ReelReadiness
    )

    # The checked contract root and the TypeScript execution root must be the
    # same directory. A different script checkout would otherwise let a clean
    # RootOverride execute unverified source from another worktree.
    $arguments = @("src\publishingReconciliation.ts", "--date", $Date, "--root", $Root)
    if ($ReelReadiness) { $arguments += "--reel-readiness" }
    # Native stderr arrives in PowerShell as ErrorRecord values. Keep it
    # separate from the JSON success stream so an observation failure retains
    # its canonical reason instead of becoming an opaque nonzero exit.
    $captured = @(Invoke-TrustedProductionTsx -Root $Root @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $stdout = @()
    $stderr = @()
    foreach ($item in $captured) {
        if ($item -is [System.Management.Automation.ErrorRecord]) {
            $message = $item.ToString()
            if ([string]::IsNullOrWhiteSpace($message)) { $message = $item.Exception.Message }
            if (-not [string]::IsNullOrWhiteSpace($message)) { $stderr += $message.Trim() }
        } else {
            $stdout += [string]$item
        }
    }
    return @{ ExitCode = $exitCode; Stdout = ($stdout -join [Environment]::NewLine); Stderr = ($stderr -join [Environment]::NewLine) }
}

function Get-PublishingReconciliation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Date
    )

    $result = Invoke-PublishingContractCli -Root $Root -Date $Date
    if ($result.ExitCode -ne 0) {
        throw "Reconciliation failed (exit $($result.ExitCode)): $($result.Stderr.Trim())"
    }
    try {
        $result = $result.Stdout | ConvertFrom-Json
    } catch {
        throw "Reconciliation returned invalid JSON: $($result.Stdout)"
    }
    return Normalize-PublishingReconciliation -Result $result
}

function Get-PlannedReelReadiness {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Date
    )

    $result = Invoke-PublishingContractCli -Root $Root -Date $Date -ReelReadiness
    if ($result.ExitCode -ne 0) {
        throw "Reel readiness failed (exit $($result.ExitCode)): $($result.Stderr.Trim())"
    }
    try {
        $result = $result.Stdout | ConvertFrom-Json
    } catch {
        throw "Reel readiness returned invalid JSON: $($result.Stdout)"
    }
    foreach ($property in "status", "required_reel_slots", "ready_reel_slots", "blocked_reels") {
        if ($null -eq $result.$property) { throw "Reel readiness result is missing $property." }
    }
    return $result
}

# Read the stamped calendar through the canonical TypeScript loader without
# calling the mutating --inspect-calendar CLI. Observe-only audits must be able
# to detect a tampered current-day calendar without creating repair evidence.
function Get-CanonicalCalendarIntegrity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Date
    )

    $inline = "import { loadDailyContent } from './src/logging.ts'; (async () => { const date = process.argv[1]; const root = process.argv[2]; const content = await loadDailyContent(date, root, { today: date }); console.log(JSON.stringify({ present: Boolean(content), tampered: Boolean(content?.tampered) })); })();"
    $output = @(Invoke-TrustedProductionTsx -Root $Root --eval $inline -- $Date $Root 2>$null)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Canonical calendar integrity runner failed (exit $exitCode)."
    }
    $line = @($output | Where-Object { ([string]$_).TrimStart().StartsWith("{") } | Select-Object -Last 1)
    if ($line.Count -ne 1) {
        throw "Canonical calendar integrity runner returned no JSON verdict."
    }
    try {
        $result = $line[0] | ConvertFrom-Json
    } catch {
        throw "Canonical calendar integrity runner returned invalid JSON: $($line[0])"
    }
    if ($result.PSObject.Properties.Name -notcontains "present" -or $result.PSObject.Properties.Name -notcontains "tampered") {
        throw "Canonical calendar integrity result is incomplete."
    }
    return $result
}

function Test-ExpectedMetaReelPermalink([object]$Value, [string]$Platform) {
    if ($null -eq $Value) { return $false }
    try {
        $uri = [Uri]([string]$Value)
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https") { return $false }
        $host = $uri.Host.ToLowerInvariant()
        if ($Platform -ceq "instagram") {
            return $host -eq "instagram.com" -or $host.EndsWith(".instagram.com")
        }
        return $host -eq "facebook.com" -or $host.EndsWith(".facebook.com") -or $host -eq "fb.watch" -or $host.EndsWith(".fb.watch")
    } catch {
        return $false
    }
}

function Test-VerifiedRemoteReelEvidence([object]$Entry, [string]$Platform) {
    $evidence = $Entry.remote_reel_evidence
    if ($null -eq $evidence) { return $false }
    $postId = ([string]$Entry.post_id).Trim()
    $remoteId = ([string]$evidence.remote_id).Trim()
    if (-not $postId -or $remoteId -cne $postId) { return $false }
    if ($evidence.remote_media_type -cne "REELS" -or $evidence.caption_exact_match -ne $true) { return $false }
    if (-not (Test-ExpectedMetaReelPermalink -Value $evidence.permalink -Platform $Platform)) { return $false }
    [DateTimeOffset]$verifiedAt = [DateTimeOffset]::MinValue
    return [DateTimeOffset]::TryParse([string]$evidence.verified_at, [ref]$verifiedAt)
}

# A success-looking row is not a completed tuple. Every consumer must see
# exactly one slot+platform candidate, at the requested date, before it can
# suppress a retry or authorize a rescue. Cross-date companions and duplicates
# are therefore explicit evidence gaps, not a convenient row-selection rule.
function Get-StrictTransportCompletionQualification {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object[]]$Entries,
        [Parameter(Mandatory = $true)][string]$ExpectedDate,
        [Parameter(Mandatory = $true)][int]$ExpectedSlot,
        [Parameter(Mandatory = $true)][string]$ExpectedPlatform,
        [switch]$RequireReel
    )

    $rows = @($Entries | Where-Object {
        $null -ne $_ -and
        ([string]$_.slot -ceq [string]$ExpectedSlot) -and
        ([string]$_.platform -ceq $ExpectedPlatform)
    })
    $reasons = @()
    $claimsLive = @($rows | Where-Object { $_.status -cin @("success", "posted") }).Count -gt 0
    if ($rows.Count -ne 1) {
        $reasons += "expected exactly one slot/platform tuple candidate, found $($rows.Count)"
        return [pscustomobject]@{ qualified = $false; claims_live = $claimsLive; sha = $null; reasons = @($reasons) }
    }

    $entry = $rows[0]
    if ($entry.date -cne $ExpectedDate) { $reasons += "wrong date" }
    if ($entry.dry_run -isnot [bool] -or $entry.dry_run) { $reasons += "dry_run is not boolean false" }
    if ($entry.status -cnotin @("success", "posted")) { $reasons += "status is not live success" }
    $postId = $entry.post_id
    if ($postId -isnot [string] -or $postId.Length -eq 0 -or $postId -cne $postId.Trim()) {
        $reasons += "post_id is missing or not trimmed"
    }

    $sha = $null
    if ($RequireReel) {
        if ($entry.published_media_type -cne "reel") { $reasons += "published media is not reel" }
        if ($entry.video_status -cne "published") { $reasons += "video is not published" }
        $rawSha = ([string]$entry.video_sha256).Trim()
        if ($rawSha -notmatch '^[0-9A-Fa-f]{64}$') { $reasons += "video_sha256 is missing or invalid" }
        else { $sha = $rawSha.ToLowerInvariant() }
        if (-not (Test-VerifiedRemoteReelEvidence -Entry $entry -Platform $ExpectedPlatform)) {
            $reasons += "remote Reel evidence is missing or invalid"
        }
    }
    return [pscustomobject]@{ qualified = $reasons.Count -eq 0; claims_live = $claimsLive; sha = $sha; reasons = @($reasons) }
}
