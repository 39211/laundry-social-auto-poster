# Offline LINE attribution weekly rollup.
# Reads GA4 UI CSV exports from data/ga4-exports. No API, no credentials.
param(
    [string]$Root = "",
    [string]$ExportsDir = "",
    [string]$ReportsDir = "",
    [string]$Now = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
if (-not $ExportsDir) { $ExportsDir = Join-Path $Root "data\ga4-exports" }
if (-not $ReportsDir) { $ReportsDir = Join-Path $Root "reports" }

$NO_DATA = "無資料。請到 GA4 探索匯出 line_click（維度 link_source）CSV 放到 data/ga4-exports/"

function Get-IsoWeekLabel([datetime]$dt) {
    $day = $dt.Date
    $thu = $day.AddDays(3 - ((([int]$day.DayOfWeek + 6) % 7)))
    $year = $thu.Year
    $jan4 = Get-Date -Year $year -Month 1 -Day 4
    $week1Mon = $jan4.AddDays(-(([int]$jan4.DayOfWeek + 6) % 7))
    $week = [int](($thu - $week1Mon).TotalDays / 7) + 1
    return ("{0}-W{1:D2}" -f $year, $week)
}

function Get-NowDate {
    if ($Now) {
        return [datetime]::Parse($Now, [Globalization.CultureInfo]::InvariantCulture)
    }
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $tz)
}

function Read-Utf8Text([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    if ($text.Length -gt 0 -and [int][char]$text[0] -eq 0xFEFF) {
        $text = $text.Substring(1)
    }
    return $text
}

function Split-CsvLine([string]$line) {
    $values = New-Object System.Collections.Generic.List[string]
    $sb = New-Object System.Text.StringBuilder
    $inQuotes = $false
    for ($i = 0; $i -lt $line.Length; $i++) {
        $ch = $line[$i]
        if ($ch -eq '"') {
            if ($inQuotes -and ($i + 1) -lt $line.Length -and $line[$i + 1] -eq '"') {
                [void]$sb.Append('"')
                $i++
            } else {
                $inQuotes = -not $inQuotes
            }
        } elseif ($ch -eq ',' -and -not $inQuotes) {
            $values.Add($sb.ToString())
            [void]$sb.Clear()
        } else {
            [void]$sb.Append($ch)
        }
    }
    $values.Add($sb.ToString())
    return ,$values.ToArray()
}

function Normalize-Header([string]$name) {
    return (($name.Trim().ToLowerInvariant()) -replace '\s+', ' ')
}

function Find-SourceIndex([string[]]$headers) {
    for ($i = 0; $i -lt $headers.Length; $i++) {
        $h = Normalize-Header $headers[$i]
        if ($h -eq "link_source") { return $i }
        if ($h -eq "custom event: link_source") { return $i }
        if ($h -eq "customevent:link_source") { return $i }
    }
    return -1
}

function Find-CountIndex([string[]]$headers) {
    for ($i = 0; $i -lt $headers.Length; $i++) {
        $h = Normalize-Header $headers[$i]
        if ($h -eq "event count") { return $i }
        if ($h -eq "eventcount") { return $i }
        if ($h -eq "active users") { continue }
        if ($h.EndsWith("event count")) { return $i }
    }
    return -1
}

function Find-DateIndex([string[]]$headers) {
    for ($i = 0; $i -lt $headers.Length; $i++) {
        $h = Normalize-Header $headers[$i]
        if ($h -eq "date") { return $i }
    }
    return -1
}

function Parse-ExportDate([string]$raw) {
    $value = $raw.Trim()
    if (-not $value) { return $null }
    $parsed = [datetime]::MinValue
    $styles = [Globalization.DateTimeStyles]::None
    $culture = [Globalization.CultureInfo]::InvariantCulture
    foreach ($fmt in @("yyyyMMdd", "yyyy-MM-dd", "yyyy/MM/dd", "M/d/yyyy", "MM/dd/yyyy")) {
        if ([datetime]::TryParseExact($value, $fmt, $culture, $styles, [ref]$parsed)) {
            return $parsed
        }
    }
    if ([datetime]::TryParse($value, $culture, $styles, [ref]$parsed)) {
        return $parsed
    }
    return $null
}

function Week-FromFileName([string]$name) {
    if ($name -match '(20\d{2}-W\d{2})') { return $Matches[1] }
    if ($name -match '(20\d{2})(\d{2})(\d{2})') {
        $d = Get-Date -Year ([int]$Matches[1]) -Month ([int]$Matches[2]) -Day ([int]$Matches[3])
        return Get-IsoWeekLabel $d
    }
    return $null
}

function Read-ExportRows([string]$path) {
    $text = Read-Utf8Text $path
    $lines = $text -split "`r?`n"
    $headerLine = $null
    $start = -1
    for ($i = 0; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        if (-not $line) { continue }
        if ($line.Trim().StartsWith("#")) { continue }
        $cells = Split-CsvLine $line
        if ((Find-SourceIndex $cells) -ge 0 -and (Find-CountIndex $cells) -ge 0) {
            $headerLine = $cells
            $start = $i + 1
            break
        }
    }
    if (-not $headerLine) {
        throw "CSV columns misaligned or missing link_source / Event count: $path"
    }
    $sourceIdx = Find-SourceIndex $headerLine
    $countIdx = Find-CountIndex $headerLine
    $dateIdx = Find-DateIndex $headerLine
    $fileWeek = Week-FromFileName ([IO.Path]::GetFileName($path))
    $rows = @()
    for ($i = $start; $i -lt $lines.Length; $i++) {
        $line = $lines[$i]
        if (-not $line -or $line.Trim().StartsWith("#")) { continue }
        $cells = Split-CsvLine $line
        if ($cells.Length -le [Math]::Max($sourceIdx, $countIdx)) { continue }
        $source = $cells[$sourceIdx].Trim()
        if (-not $source) { continue }
        $countRaw = $cells[$countIdx].Trim() -replace ',', ''
        $count = 0
        if (-not [double]::TryParse($countRaw, [Globalization.NumberStyles]::Any, [Globalization.CultureInfo]::InvariantCulture, [ref]$count)) {
            throw "CSV columns misaligned (count is not a number) in ${path}: $countRaw"
        }
        $week = $fileWeek
        if ($dateIdx -ge 0 -and $dateIdx -lt $cells.Length) {
            $dt = Parse-ExportDate $cells[$dateIdx]
            if ($dt) { $week = Get-IsoWeekLabel $dt }
        }
        if (-not $week) { $week = Get-IsoWeekLabel (Get-NowDate) }
        $rows += [pscustomobject]@{ source = $source; count = [int]$count; week = $week }
    }
    return ,$rows
}

$nowDate = Get-NowDate
$thisWeek = Get-IsoWeekLabel $nowDate
$prevDate = $nowDate.Date.AddDays(-7)
$prevWeek = Get-IsoWeekLabel $prevDate

if (-not (Test-Path -LiteralPath $ExportsDir)) {
    Write-Output $NO_DATA
    exit 0
}

$csvFiles = @(Get-ChildItem -LiteralPath $ExportsDir -File -Filter *.csv -ErrorAction SilentlyContinue)
if ($csvFiles.Count -eq 0) {
    Write-Output $NO_DATA
    exit 0
}

$allRows = @()
foreach ($file in $csvFiles) {
    $allRows += Read-ExportRows $file.FullName
}

$totals = @{}
foreach ($row in $allRows) {
    $key = $row.week + "|" + $row.source
    if (-not $totals.ContainsKey($key)) { $totals[$key] = 0 }
    $totals[$key] += $row.count
}

$sources = New-Object System.Collections.Generic.HashSet[string]
foreach ($row in $allRows) { [void]$sources.Add($row.source) }

function Week-Count([string]$week, [string]$source) {
    $key = $week + "|" + $source
    if ($totals.ContainsKey($key)) { return [int]$totals[$key] }
    return 0
}

$reportRows = @()
foreach ($source in $sources) {
    $current = Week-Count $thisWeek $source
    $previous = Week-Count $prevWeek $source
    $delta = $current - $previous
    $deltaText = if ($previous -eq 0 -and $current -eq 0) { "0" } elseif ($delta -gt 0) { "+$delta" } else { "$delta" }
    $reportRows += [pscustomobject]@{
        source = $source
        current = $current
        previous = $previous
        delta = $delta
        deltaText = $deltaText
    }
}

$reportRows = @($reportRows | Sort-Object -Property @{ Expression = "current"; Descending = $true }, source)

$md = New-Object System.Collections.Generic.List[string]
[void]$md.Add("# LINE attribution $thisWeek")
[void]$md.Add("")
[void]$md.Add("| link_source | count | last_week | wow |")
[void]$md.Add("|---|---:|---:|---:|")
if ($reportRows.Count -eq 0) {
    [void]$md.Add("| (none) | 0 | 0 | 0 |")
} else {
    foreach ($row in $reportRows) {
        [void]$md.Add(("| {0} | {1} | {2} | {3} |" -f $row.source, $row.current, $row.previous, $row.deltaText))
    }
}
[void]$md.Add("")
[void]$md.Add(("Generated from {0} CSV file(s) in data/ga4-exports. Offline; no GA4 API." -f $csvFiles.Count))
[void]$md.Add("")

New-Item -ItemType Directory -Force -Path $ReportsDir | Out-Null
$outPath = Join-Path $ReportsDir ("line-attribution-{0}.md" -f $thisWeek)
$utf8bom = New-Object System.Text.UTF8Encoding $true
[IO.File]::WriteAllText($outPath, ($md -join "`n"), $utf8bom)
Write-Output $outPath
exit 0
