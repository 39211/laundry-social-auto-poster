# Three-day optimisation loop (owner mandate 2026-09-04): every 72 hours,
# pull the freshest measurements, judge what moved, and write ONE knob per
# channel to turn -- not a report nobody acts on.
#
# It composes the pieces that already exist instead of re-implementing them:
#   sync-meta-insights                 FB/IG numbers for the last window
#   review-72h                         per-post 72h rows (reach/saves/shares/LINE)
#   ga4-report --date                  line_click + search-funnel events -> leads ledger
#   gsc-search-analytics --date        impressions/clicks/CTR per query and page
#   generate-performance-optimization  cluster-level page actions from the 72h rows
#   audit-sitemap / audit-public-site  structural gates (fail closed elsewhere; here: report)
#
# Output: output\optimize-72h\<date>.md  (what a person decides)
#         output\optimize-72h\<date>.log (raw command output, same run)
# Exit code is always 0 -- this reports, it does not gate publishing.
# Evidence rules: a failed read is written as "unmeasured", never as 0.

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Split-Path -Parent $PSScriptRoot
$tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
$now = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
$date = $now.ToString("yyyy-MM-dd")
$dataDate = $now.AddDays(-1).ToString("yyyy-MM-dd")   # GA4/GSC are complete for yesterday, not today

$outDir = Join-Path $root "output\optimize-72h"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$logFile = Join-Path $outDir "$date.log"
$mdFile = Join-Path $outDir "$date.md"
Set-Location $root

function Write-Log([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Host $line
}

function Run-Step([string]$label, [string]$command) {
    Write-Log "== $label"
    $out = cmd /c "$command 2>&1"
    $code = $LASTEXITCODE
    $out | Out-File -FilePath $logFile -Append -Encoding utf8
    Write-Log ("exit {0}" -f $code)
    return @{ ok = ($code -eq 0); text = ($out -join "`n") }
}

$steps = [ordered]@{}
$steps["meta"] = Run-Step "sync-meta-insights" "npm.cmd run sync-meta-insights"
$steps["review72"] = Run-Step "review-72h" "npm.cmd run review-72h"
$steps["ga4"] = Run-Step "ga4-report" "npm.cmd run ga4-report -- --date $dataDate"
$steps["gsc"] = Run-Step "gsc-search-analytics" "npm.cmd run gsc-search-analytics -- --date $dataDate"
$steps["perf"] = Run-Step "generate-performance-optimization" "npm.cmd run generate-performance-optimization"
$steps["sitemap"] = Run-Step "audit-sitemap" "npm.cmd run audit-sitemap"

function Status([string]$key) { if ($steps[$key].ok) { "measured" } else { "unmeasured (see log)" } }

# --- read back the artefacts the steps produced ------------------------------
$review = $null
$reviewPath = Join-Path $root "output\reviews\review-72h.json"
if (-not (Test-Path $reviewPath)) {
    $candidate = Get-ChildItem (Join-Path $root "output") -Recurse -Filter "*72*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { $reviewPath = $candidate.FullName }
}
if (Test-Path $reviewPath) {
    try { $review = Get-Content $reviewPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Write-Log "review json unreadable: $($_.Exception.Message)" }
}

$month = $dataDate.Substring(0, 7)
$ledgerPath = Join-Path $root "data\leads\$month.json"
$ledgerLine = "unmeasured"
if (Test-Path $ledgerPath) {
    try {
        $ledger = Get-Content $ledgerPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $ledgerLine = "ledger $month present; fields: " + (($ledger | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name) -join ", ")
    } catch { $ledgerLine = "ledger unreadable" }
}

# GSC Search Analytics is only final about 3 days after the fact, so the sheet
# shows the freshest day (may still be partial) and the day that is final.
function Gsc-Line([string]$day) {
    $path = Join-Path $root "data\insights\gsc\$day.json"
    if (-not (Test-Path $path)) { return "${day}: no day file (token missing or API failed) -> unmeasured" }
    try {
        $g = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
        $t = $g.totals
        return "${day}: impressions $($t.impressions), clicks $($t.clicks), position $($t.position); top queries $(@($g.top_queries).Count), top pages $(@($g.top_pages).Count)"
    } catch { return "${day}: day file unreadable -> unmeasured" }
}
$gscLine = (Gsc-Line $dataDate) + " | " + (Gsc-Line ($now.AddDays(-4).ToString("yyyy-MM-dd")))
$ga4Total = "unmeasured"
if ($steps["ga4"].ok) {
    $m = [regex]::Match($steps["ga4"].text, '"total":\s*(\d+)')
    if ($m.Success) { $ga4Total = "line_click total $($m.Groups[1].Value) on $dataDate (a real 0 is a 0; unmeasured is written only when the read failed)" }
}

$discovery = $null
try { $discovery = Get-Content (Join-Path $root "docs\ai-discovery.json") -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
$articlePolicy = if ($discovery) { $discovery.content_contract.daily_article_policy } else { $null }
$sitemapCount = 0
try { $sitemapCount = ([regex]::Matches((Get-Content (Join-Path $root "docs\sitemap.xml") -Raw), "<loc>")).Count } catch {}

# --- the decision sheet -------------------------------------------------------
$lines = @()
$lines += "# 72h optimisation loop - $date (data through $dataDate)"
$lines += ""
$lines += "One knob per channel. Turn it, write what/why/how-to-verify in the optimisation log, check again in 72 hours."
$lines += ""
$lines += "## Measurement status"
$lines += "| source | status |"
$lines += "|---|---|"
$lines += "| Meta insights sync | $(Status 'meta') |"
$lines += "| 72h review rows | $(Status 'review72') |"
$lines += "| GA4 -> leads ledger | $(Status 'ga4'); $ga4Total; $ledgerLine |"
$lines += "| GSC search analytics | $(Status 'gsc'); $gscLine |"
$lines += "| performance clusters | $(Status 'perf') |"
$lines += "| sitemap audit | $(Status 'sitemap'); $sitemapCount URLs |"
if ($articlePolicy) {
    $lines += "| indexable daily articles | $($articlePolicy.indexable_article_count) / $($articlePolicy.article_count) clear the gate |"
}
$lines += ""
$lines += "## Posts that reached 72h in this window"
if ($review -and $review.rows) {
    $rows = @($review.rows) | Where-Object { $_.eligible_at -and ([DateTime]$_.eligible_at) -ge $now.AddDays(-3).ToUniversalTime() }
    if ($rows.Count -eq 0) { $rows = @($review.rows) | Select-Object -Last 6 }
    $lines += "| date | slot | topic | reach | saved | shares | line_clicks |"
    $lines += "|---|---|---|---|---|---|---|"
    foreach ($r in $rows) {
        $m = $r.metrics
        $fmt = { param($v) if ($null -eq $v) { "null" } else { $v } }
        $lines += "| $($r.date) | $($r.slot) | $($r.topic) | $(& $fmt $m.reach) | $(& $fmt $m.saved) | $(& $fmt $m.shares) | $(& $fmt $m.line_clicks) |"
    }
} else {
    $lines += "review rows unavailable -> unmeasured. Do not infer from absence."
}
$lines += ""
$lines += "## Decide (fill in, one line each; leave blank = no change this round)"
$lines += "- IG/FB copy knob (first line or closing question of the weakest 72h post): "
$lines += "- Reel knob (3s hook card / narration first sentence / closing card): "
$lines += "- YT knob (title pattern if impressions high + CTR low; description first two lines if CTR high + LINE low): "
$lines += "- SEO/AEO/GEO knob (from GSC: one page whose query intent != answer opening; rewrite its answer block; or one crawled-not-indexed article to merge): "
$lines += "- GBP knob (reviews this window vs target 2-5/week; one post/offer to publish): "
$lines += ""
$lines += "## Rules that do not change between rounds"
$lines += "- One variable per channel per round; a knob turned without a log entry did not happen."
$lines += "- Never write 0 for an unmeasured source."
$lines += "- Indexing: do not resubmit unchanged URLs; Day 0/7/28 judgement per reports/iprinter-site-pattern-clone-2026-09-03.md."
$lines += "- Copy gates stay hard: no guarantee words, no percentages without a source, one CTA per post."
$lines += ""
$lines += "Raw output: $logFile"
$lines | Set-Content -Path $mdFile -Encoding UTF8
Write-Log "Decision sheet written: $mdFile"
exit 0
