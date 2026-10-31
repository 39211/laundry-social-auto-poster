# Read-only shop status: services, tasks, last tunnel events (no data-file content).
$ErrorActionPreference = 'Continue'
"now " + (Get-Date -Format 'MM/dd HH:mm:ss')
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'fxwash\\runtime\\(webhook_server|tunnel_supervisor|inbound_monitor)\.py' } |
  ForEach-Object { "proc {0} {1} {2}" -f $_.ProcessId, $_.CreationDate.ToString('MM/dd HH:mm:ss'), ($_.CommandLine -replace '.*runtime\\', '') }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'nokey@localhost\.run' } | ForEach-Object { "tunnel-child {0} parent={1} {2}" -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToString('MM/dd HH:mm:ss') }
foreach ($n in 'FXwash-Watchdog', 'FXwash-Daily-10AM') { $t = Get-ScheduledTask -TaskName $n; $i = $t | Get-ScheduledTaskInfo; "task {0} State={1} Enabled={2} Last={3} rc={4}" -f $n, $t.State, $t.Settings.Enabled, $i.LastRunTime.ToString('MM/dd HH:mm'), $i.LastTaskResult }
$ev = 'C:\LaundryStores\fxwash\logs\tunnel_events.jsonl'
Get-Content -LiteralPath $ev -Encoding UTF8 -Tail 6 | ForEach-Object { try { $e = $_ | ConvertFrom-Json; "ev {0} {1} put={2} verify={3}" -f $e.ts, $e.event, $e.put_status, $e.verify_status } catch { } }
foreach ($rel in 'runtime\tunnel_supervisor.py', 'runtime\inbound_monitor.py', 'runtime\webhook_server.py', 'runtime\chat_service.py', 'config\dialog_corpus.py', 'config\Dialog_Phrases.json', 'build_expanded_corpus.py', 'build_expanded_corpus_v5.py') {
  $p = Join-Path 'C:\LaundryStores\fxwash' $rel
  if (Test-Path -LiteralPath $p) { "sha {0} {1}" -f $rel, (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.Substring(0, 12) } else { "sha $rel MISSING" }
}
