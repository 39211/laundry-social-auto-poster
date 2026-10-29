# LINE bot operations

Public Flask (`line_webhook.py`) listens on `127.0.0.1:8791` and exposes only `/line/webhook`, `/img/<name>`, `/pay/confirm`, `/pay/cancel`, `/healthz`. Staff UI is a separate process (`staff_server.py`) on `127.0.0.1:8792` and is not on the Cloudflare tunnel.

Python: `C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe`

Do not start a second listener on 8791 or 8792 while the current shop processes are still bound.

## Start (watchdog; idempotent)

From an elevated-enough user session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1"
```

The script is **idempotent**. For each of `line_webhook.py`, `staff_server.py`, `tunnel_manager.py` it checks: pid file exists **and** that PID is alive **and** the command line contains the script name **and** this directory's absolute path, and it is not a `test_*.py` filename. If all match, it skips that process (does not restart it). If the pid file is missing or the process is dead / command line does not match, it starts a new python process.

Launch form (G5): `Start-Process -FilePath $Python -ArgumentList '-u', $scriptPath -RedirectStandardOutput <name>.log -RedirectStandardError <name>.err -WindowStyle Hidden -PassThru`. `.log` and `.err` are two different files (they cannot share one path). The `.pid` file stores **python's own pid**, not a `cmd.exe` wrapper. After start the script waits 1 second; if that pid is already dead it prints `start failed <name>` and does not write the pid file.

Stop with `-Stop` (G9). It calls `Stop-Tracked` for `tunnel_manager`, then `staff_server`, then `line_webhook`, and prints each result. Stop still matches **only** pid file + command line (never by image name) and walks the whole descendant tree leaf-to-root so a grandchild `cloudflared` is not left behind. `-Stop` and `-Probe` are mutually exclusive.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1" -Stop
```

`tunnel_manager.py` launches `cloudflared tunnel --url http://127.0.0.1:8791 --no-autoupdate`. A resident reader thread drains stdout for the child's whole lifetime (otherwise cloudflared blocks after ~4 KB). Stdout is decoded as UTF-8 with `errors=replace`; reader errors are logged and the pipe is still read to EOF. URL capture accepts only the success-table URL row, excluding `api.trycloudflare.com` and error prose. Every accepted URL is written to `public_base.txt`.

`handover.json` controls the shop's day window: by default `[10:00, 20:00)` in `Asia/Taipei`. In that window the manager logs `day window: shop is primary, not registering` and never registers an endpoint. Outside it, the manager PUTs the AI URL plus `/line/webhook`, GETs the endpoint and requires exact equality, retrying three times (2/5/10 s) before leaving a pending retry on the 60-second loop. Every retry rechecks the window; pending retries are cleared during the day. Invalid/missing configuration blocks registration. On Windows without IANA tzdata, current Taipei uses the standard-library UTC+08:00 fallback.

`night_handover.py` reads the saved AI base, GETs LINE's registered endpoint, and only PUTs/GET-verifies when it differs and the night window is still open. An identical endpoint is a no-op. `--dry-run` prints offline intent without loading credentials or sending HTTP; `--status` performs only a GET and prints both endpoints, registered owner and LINE's `active` field. Registration and `active` do not measure endpoint reachability or message delivery. The commander can register the daily `day_end + night_takeover_delay_min` task with `register-night-handover-task.ps1` (default 20:05); changing these schedule fields requires re-registering the task. The registration script requires Windows `Taipei Standard Time` and offers `-WhatIf`. It is prepared only, not run as part of A4-3.

Structured events append to `%LOCALAPPDATA%\line-bot\tunnel_events.jsonl`, including timestamps, old/new URLs, PUT status and verification status. `tunnel_url` records local base URLs; `webhook_update` records full webhook endpoints (`old_url` is empty when the previous LINE endpoint is unknown). No token or raw HTTP body is logged.

If the child exits before publishing a URL the manager logs `cloudflared exited before publishing a url rc=<n>`; if it is still running after 90 s it logs `no tunnel url within 90s`. Then it kills that cloudflared, backs off 10/30/60 s, and retries forever (KeyboardInterrupt is the only exit). Do not run `tunnel_manager.main()` while another tunnel already owns 8791 / the live webhook.

`tunnel.log` rotates to `tunnel.log.1` (overwriting the previous `.1`) when it grows past 2 MB. Service `.log` / `.err` files rotate the same way at 5 MB on the next start (G15).

Staff page: open `http://127.0.0.1:8792/` locally only.

## Staff group bind token (G1)

Notification target is a LINE group id stored in `data\staff-target.json`. Binding is **not** automatic on `join`, and chatting `櫃台` / `綁定櫃台` / `員工群` does nothing.

Commander (not the implementer, not this repo) creates a one-line passphrase at:

`C:\Users\cyc39\laundry-repo\secrets\staff-bind-token.txt`

The bot never creates or overwrites that file. The boss pastes that exact line once in the staff LINE group. On success the bot replies `好，之後預約會打到這個群。` Wrong text, missing file, or empty file: no reply, and the token is never written to a log or a reply.

## Human handoff hard stop (WP05A)

When a photo cannot be estimated, a customer explicitly asks for a person, or
another flow marks handoff, the bot appends a HANDOFF_PENDING record to
data/staff-inbox.jsonl. From that point the webhook does not call the
conversation/AI layer and does not reply to the customer for text, photos,
locations, stickers, or postbacks. Those events are appended as human_message
rows under the same case_id; a redelivered event is ignored by its event id.
Photos are still saved for the staff page.

The state is append-only and survives a process reload:

BOT_ACTIVE -> HANDOFF_PENDING -> HUMAN_ACTIVE -> BOT_ACTIVE

The staff page's existing 已處理／已接待 button is the explicit release
action. The bot never resumes because a timer expired. For a separate operator
integration, the local-only staff server also exposes POST /staff/claim and
POST /staff/release with JSON { "id": "<case id>" }.
These routes are behind the same 127.0.0.1:8792 Host guard as the staff page.

## Probe

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1" -Probe
```

Prints `alive=` / `pid=` for the three tracked processes and the body/status of `http://127.0.0.1:8791/healthz`. `/healthz` returns `ok <pid>` (this process only). Probe parses that pid and compares it to `line_webhook.pid`. If they differ it prints `healthz foreign pid=<n> tracked=<m>` and fails (this catches an old Flask still bound to 8791). Exit code 0 = all three alive and healthz 200 with matching pid; 1 = something missing; 2 = `-Stop` and `-Probe` used together. Probe never starts or stops processes.

## Scheduled task (watchdog)

Commander (not the implementer) runs:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\install_task.ps1"
```

This registers `Laundry-LINE-Bot` with two triggers, same action (`powershell -NoProfile -ExecutionPolicy Bypass -File <run_line_bot.ps1>`):

1. AtLogOn for the current user
2. Once-from-now, repeating every 5 minutes, duration 3650 days (`P3650D`; do not use `[TimeSpan]::MaxValue`)

Settings include `-MultipleInstances IgnoreNew`. There is no `-RestartCount`. The 5-minute trigger is safe because `run_line_bot.ps1` is idempotent: live processes are left alone.

## Logs and PID files

Directory: `%LOCALAPPDATA%\line-bot\` (usually `C:\Users\cyc39\AppData\Local\line-bot\`)

| File | Source |
| --- | --- |
| `line_webhook.log` / `line_webhook.err` / `line_webhook.pid` | public Flask (python pid) |
| `staff_server.log` / `staff_server.err` / `staff_server.pid` | staff Flask (python pid) |
| `tunnel_manager.log` / `tunnel_manager.err` / `tunnel_manager.pid` | keep-alive wrapper |
| `tunnel.log` | tunnel events (timestamps; token is never written); rotates to `tunnel.log.1` at 2 MB |

`.log` and `.err` rotate to `.log.1` / `.err.1` (overwriting the previous `.1`) when larger than 5 MB, on the next start.

## Cutover from the current live processes

The implementer must not kill or restart the running Flask (pid 15744/24452 on 8791) or the existing cloudflared processes.

Commander cutover:

1. Confirm `run_line_bot.ps1` and `install_task.ps1` are in place.
2. Stop the old Flask on 8791 and any old cloudflared that publishes that app (by those known PIDs, not by wiping all `python.exe` / `cloudflared.exe`). Prefer `run_line_bot.ps1 -Stop` for processes this script started.
3. Run `run_line_bot.ps1` (or the scheduled task). Confirm with `-Probe` (healthz pid must match `line_webhook.pid`).
4. Confirm `public_base.txt` has a `*.trycloudflare.com` URL and LINE webhook endpoint is that URL plus `/line/webhook`.
5. Open `http://127.0.0.1:8792/` and confirm the counter page loads. Fetch `/staff` on the public tunnel URL and confirm 404.

## Purge test rows

Moves rows whose `uid` does **not** match `^U[0-9a-fA-F]{32}$` from:

- `C:\Users\cyc39\laundry-repo\data\line-bookings.jsonl`
- `C:\Users\cyc39\laundry-repo\data\staff-inbox.jsonl`
- `C:\Users\cyc39\laundry-repo\data\line-sessions.json`
- `C:\Users\cyc39\laundry-repo\data\line-customer-bind.json`

into `C:\Users\cyc39\laundry-repo\data\line-test-rows-backup-<YYYYMMDD-HHMMSS>-<4char>.json`. Live files stay valid JSONL/JSON; remaining rows keep order. JSONL rows with **no `uid` field** are not moved; they are listed under `no_uid`. JSON-map keys that start with `U` but are the wrong length are listed under `no_uid` and **not** moved. Keys that do not look like a uid at all are listed under `suspect` and still moved.

Backup is created with `open(..., "x")` (never overwrites an existing backup). Unreadable JSON aborts `--apply` with a non-zero exit and does not touch any file.

**Stop the scheduled task `Laundry-LINE-Bot` itself first** (not only the three processes). `--apply` refuses if 8791 or 8792 is still listening (`請先停止 bot 再跑`). **Do not pass `--force` while 8791 or 8792 still responds.** `--force` is commander-only and only after those ports are confirmed dead.

```powershell
# 1. stop the scheduled task itself, then the tracked processes; confirm ports 8791/8792 are free
#    Unregister/Disable Laundry-LINE-Bot (commander). Then:
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\cyc39\laundry-repo\line-bot\run_line_bot.ps1" -Stop
# 2. dry-run (default; omitting --apply does not write)
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\purge_test_rows.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\purge_test_rows.py" --dry-run
# 3. apply only after stop AND ports 8791/8792 do not respond; backup is fsync'd before any live file is replaced
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\purge_test_rows.py" --apply
```

`--dry-run` and `--apply` together is an error. Default without `--apply` is dry-run (no write). Only commander should pass `--apply`.

## Tests

Use the venv Python (pytest is not required):

```powershell
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_line_flows.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_ehank_snapshot.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_isolation.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_webhook_security.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_staff_html.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_run_scripts.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_group_bind.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_purge.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_staff_inbox.py"
& "C:\Users\cyc39\AppData\Local\hermes\jarvis-memory\venv\Scripts\python.exe" "C:\Users\cyc39\laundry-repo\line-bot\test_handoff.py"
```

For A4-3's isolated tunnel/handover tests, use Python 3.14 from an approved checkout's `line-bot` directory. These tests use temporary worktree paths, fake clocks, dummy credentials and fake HTTP; pytest is not required:

```powershell
& "C:\Users\cyc39\AppData\Local\Python\pythoncore-3.14-64\python.exe" -B -X utf8 -m unittest -v test_day_night_handover test_tunnel_manager
```
