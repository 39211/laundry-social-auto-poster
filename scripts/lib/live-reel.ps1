# Pure predicates shared by the scheduled audit and YouTube uploader.
# Keep PS 5.1's assign-then-wrap handling for parsed JSON arrays.
function Test-LiveReelPostedEntry {
    param($Entry, [int]$Slot)
    if ($null -eq $Entry) { return $false }
    if ($Entry.slot -ne $Slot) { return $false }
    if ([string]$Entry.platform -ne "instagram") { return $false }
    if ($Entry.dry_run) { return $false }
    $status = [string]$Entry.status
    if (@("success", "posted") -notcontains $status) { return $false }
    return ([string]$Entry.published_media_type -eq "reel")
}

function Test-LiveReelHasSlot {
    param($Entries, [int]$Slot)
    # Wrap only the assigned, parsed value so PS 5.1 enumerates JSON array rows.
    $reelLive = @(@($Entries) | Where-Object { Test-LiveReelPostedEntry $_ $Slot })
    return ($reelLive.Count -gt 0)
}
