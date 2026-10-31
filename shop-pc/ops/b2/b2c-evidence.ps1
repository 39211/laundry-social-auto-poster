param([Parameter(Mandatory = $true)][string]$Since)
$ErrorActionPreference = 'Continue'
$root = 'C:\LaundryStores\fxwash'
$t = [datetime]::ParseExact($Since, 'yyyy-MM-ddTHH:mm:ss', $null)
$lines = @(Get-Content -LiteralPath (Join-Path $root 'logs\webhook_server.log') -Encoding UTF8 -Tail 300)
$fresh = @($lines | Where-Object { $_ -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ' -and [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd HH:mm:ss', $null) -ge $t })
'fresh log lines=' + $fresh.Count
'running_lines=' + @($fresh | Where-Object { $_ -match 'Webhook Server running' }).Count
'disabled_lines=' + @($fresh | Where-Object { $_ -match '\[ATTRIBUTION_DISABLED\]' }).Count
'attribution_error_lines=' + @($fresh | Where-Object { $_ -match '\[ATTRIBUTION_ERROR\]' }).Count
'traceback_lines=' + @($fresh | Where-Object { $_ -match 'Traceback|ConfigError' }).Count
$fresh | Where-Object { $_ -match '\[ATTRIBUTION_|Traceback|ConfigError|running' } | Select-Object -First 6 | ForEach-Object { 'log| ' + ($_ -replace 'U[0-9a-f]{32}', 'U***') }
& 'C:\LaundryStores\python-portable\python.exe' -I -S -c "import json;d=json.loads(open(r'C:\LaundryStores\fxwash\shop.json','rb').read().decode('utf-8-sig'));print('shop.json attribution=%s webhook_url=%s' % (json.dumps(d.get('attribution')), d.get('server',{}).get('webhook_url')))"
$inq = Join-Path $root 'data\inquiries.jsonl'
'inquiries.jsonl exists=' + (Test-Path $inq) + ' rows=' + $(if (Test-Path $inq) { @(Get-Content -LiteralPath $inq).Count } else { 0 })
foreach ($s in 'webhook_server', 'tunnel_supervisor', 'inbound_monitor') { $p = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match ('fxwash\\runtime\\' + $s + '\.py') }); $s + ' count=' + $p.Count + ' created=' + (($p | ForEach-Object { $_.CreationDate.ToString('HH:mm:ss') }) -join ',') }
