# Read-only: list the Page's scheduled posts and today's published feed (token never printed)
$ErrorActionPreference = 'Stop'
$env1 = Get-Content 'C:\Users\cyc39\Documents\New project 5\.env' | Where-Object { $_ -match '^(META_ACCESS_TOKEN|FB_PAGE_ID|META_GRAPH_API_VERSION)=' }
$kv = @{}
foreach ($l in $env1) { $k,$v = $l -split '=',2; $kv[$k] = $v.Trim().Trim('"') }
$ver = if ($kv['META_GRAPH_API_VERSION']) { $kv['META_GRAPH_API_VERSION'] } else { 'v21.0' }
$page = $kv['FB_PAGE_ID']; $tok = $kv['META_ACCESS_TOKEN']
"page=$page ver=$ver token_len=$($tok.Length)"
$r = Invoke-RestMethod -Uri "https://graph.facebook.com/$ver/$page/scheduled_posts?fields=id,scheduled_publish_time,message&limit=25&access_token=$tok"
"scheduled_posts count=$(@($r.data).Count)"
foreach ($p in @($r.data)) { "  id={0} time={1} msg={2}" -f $p.id, ([DateTimeOffset]::FromUnixTimeSeconds([long]$p.scheduled_publish_time).ToOffset([TimeSpan]::FromHours(8)).ToString('MM/dd HH:mm')), (([string]$p.message) -replace '\s+',' ').Substring(0, [Math]::Min(40, ([string]$p.message).Length)) }
$f = Invoke-RestMethod -Uri "https://graph.facebook.com/$ver/$page/feed?fields=id,created_time,message&limit=6&access_token=$tok"
"feed latest:"
foreach ($p in @($f.data)) { "  id={0} created={1} msg={2}" -f $p.id, $p.created_time, (([string]$p.message) -replace '\s+',' ').Substring(0, [Math]::Min(40, ([string]$p.message).Length)) }
