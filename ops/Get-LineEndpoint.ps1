# 唯讀:GET LINE webhook endpoint(不印 token)
param([switch]$Test)
$ErrorActionPreference = 'Stop'
$j = Get-Content 'C:\Users\cyc39\Documents\New project 5\secrets\line-channel.json' -Raw | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($j.line_channel_token)" }
$r = Invoke-RestMethod -Method Get -Uri 'https://api.line.me/v2/bot/channel/webhook/endpoint' -Headers $h
"{0} endpoint={1} active={2}" -f (Get-Date -Format 'HH:mm:ss'), $r.endpoint, $r.active
if ($Test) {
    try {
        $t = Invoke-RestMethod -Method Post -Uri 'https://api.line.me/v2/bot/channel/webhook/test' -Headers $h -ContentType 'application/json' -Body '{}'
        "webhook/test success={0} statusCode={1} reason={2} detail={3} ts={4}" -f $t.success, $t.statusCode, $t.reason, $t.detail, $t.timestamp
    } catch {
        "webhook/test ERROR: $($_.Exception.Message)"
    }
}
