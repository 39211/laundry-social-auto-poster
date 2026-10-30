# PUT LINE webhook endpoint to the given URL, then GET to verify (token never printed)
param([Parameter(Mandatory=$true)][string]$Endpoint)
$ErrorActionPreference = 'Stop'
if ($Endpoint -notmatch '^https://[a-z0-9]+\.lhr\.life/line/webhook$') { throw "refusing non-shop endpoint: $Endpoint" }
$j = Get-Content 'C:\Users\cyc39\Documents\New project 5\secrets\line-channel.json' -Raw | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($j.line_channel_token)" }
$before = Invoke-RestMethod -Method Get -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h
"{0} before endpoint={1}" -f (Get-Date -Format 'HH:mm:ss'), $before.endpoint
$body = @{ endpoint = $Endpoint } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Put -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h -ContentType 'application/json' -Body $body | Out-Null
$after = Invoke-RestMethod -Method Get -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h
"{0} after  endpoint={1} active={2} match={3}" -f (Get-Date -Format 'HH:mm:ss'), $after.endpoint, $after.active, ($after.endpoint -eq $Endpoint)
