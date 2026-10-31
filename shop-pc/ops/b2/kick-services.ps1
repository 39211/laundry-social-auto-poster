# Emergency: re-enable the two shop tasks and let the watchdog start every missing service.
$ErrorActionPreference = 'Continue'
foreach ($n in 'FXwash-Watchdog', 'FXwash-Daily-10AM') { Enable-ScheduledTask -TaskName $n | Out-Null; 'enabled ' + $n }
Start-ScheduledTask -TaskName 'FXwash-Watchdog'; 'kicked FXwash-Watchdog'
Start-Sleep -Seconds 20
foreach ($s in 'webhook_server', 'tunnel_supervisor', 'inbound_monitor') { $p = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match ('fxwash\\runtime\\' + $s + '\.py') }); $s + ' count=' + $p.Count }
