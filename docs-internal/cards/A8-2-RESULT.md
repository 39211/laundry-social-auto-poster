# A8-2 RESULT — LINE bot deploy hardening after the 2026-10-30 production failures

## What changed and why (per incident)

1. **Path-with-spaces broke the real launcher (`run_line_bot.ps1`).**
   The live tree lives under `C:\Users\cyc39\Documents\New project 5` (spaces) and is
   also reachable through the junction `C:\Users\cyc39\laundry-repo` (no spaces).
   The launcher built python command lines from the target path; a space split the
   script argument and python never saw the real script.
   - `run_line_bot.ps1`: quote the script path in `Start-Tracked`
     (`-ArgumentList '-u', ('"{0}"' -f $scriptPath)`) so a whitespace root reaches
     python as one argument.
   - `deploy-ai-linebot.ps1`: `Resolve-AiTarget` now **normalizes** the live tree to
     the junction. Any *other* whitespace target is **refused before any backup or
     stop**. Live detection matches a known alias or reads the junction's link target.

2. **Start hung because daemons inherited the deploy pipe handles.**
   Running `run_line_bot.ps1` directly from the deployer left python/cloudflared
   grandchildren holding the redirected stdout/stderr, so the deploy process blocked.
   - Start now goes through `Start-ScheduledTask Laundry-LINE-Bot` (detached,
     production path) in `Start-AiBotTask`; readiness is polled with
     `run_line_bot.ps1 -Probe` every 10 s for up to 180 s.
   - `Invoke-AiNative` now does **bounded chunked reads**: after the direct child
     exits it drains for `DrainSeconds` only, then returns what was read so far with
     `Truncated = $true` and a note. It never sweeps by image name; it only kills the
     exact child it created.

3. **Stop fought the Laundry-LINE-Bot tick / watchdog.**
   - `Get-AiTickWindowDecision` is a **pure** function (all inputs injected: now,
     last run, next run, state). `Wait-AiTickWindow` polls read-only scheduler state
     and only proceeds in a tick-safe window; it **never disables** the task (a
     watchdog re-enables `Laundry-*`). The wait is bounded separately (300 s max).

4. **Transient `os.replace` PermissionError failed good deploys.**
   - `Invoke-AiOfflineTest` gives each offline command **one automatic retry** and
     logs both attempts (`attempt 1/2`, `attempt 2/2`, `RETRY`, `passed on retry`).

5. **Rollback could silently lose the LINE webhook to a daytime tunnel_manager.**
   - `Restore-AiBackup` logs an explicit `WARNING rollback: ... tunnel_manager ...`
     line reminding the operator to check the LINE webhook endpoint manually. No
     automatic endpoint change is attempted.

6. **Budget.** Start via the scheduled task is slower (~30–40 s processes + ~60–90 s
   healthz), so the time budget was raised from 210 s to **480 s**, re-armed after
   each (separately bounded) tick-safe wait.

## How to run the tests (Pester 3.4.0)
