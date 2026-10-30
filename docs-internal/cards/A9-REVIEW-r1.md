**Verdict: SHIP WITH FIXES.** Defects 1–6 must be fixed, and the real-repo `-DryRun` must pass, before `register-backfill-task.ps1` is executed.

---

## Defects

**1. Major: no once-per-day guard, so a manual or second run publishes a second post the same day**
- **Where:** `backfill-publish.ps1`
  ```
  $pending = @($queue | Where-Object { $_.status -ceq 'pending' })
  ```
- **Scenario:** `IgnoreNew` only blocks overlapping instances. Any of these publishes the next entry the same day:
  - The commander clicks "Run" in Task Scheduler after 16:00.
  - Someone runs the script without `-DryRun` while checking things.
  - A re-registered task fires again.
- **Fix:** add this after `$queue = @(Read-Queue)` in the main path. Repeat the same test inside the post-mutex recheck, before the claim.
  ```powershell
  $today = (Get-Date).ToString('yyyy-MM-dd')
  if (@($queue | Where-Object { $_.status -cin @('done','failed') -and ([string]$_.attempted_at).StartsWith($today) }).Count -gt 0) {
      Write-Log 'An entry was already attempted today; no action.'; exit 0 }
  ```

**2. Major: no npm timeout or process-tree kill, and output is lost if the run is killed**
- **Where:** `Invoke-BackfillNpm`
  ```
  $child.WaitForExit()
  Write-Log ('stdout:' + [Environment]::NewLine + $stdout.Result)
  ```
- **Hang scenario 1:** node hangs (Graph API stall, IG container polling). Task Scheduler kills `powershell.exe` at 15 minutes.
  - `cmd`, `npm` and `node` survive as orphans and may finish or half-finish publishing later.
  - Nothing was written to the log, because output is only logged after exit.
- **Hang scenario 2:** a grandchild inherits the stdout pipe. `.Result` then blocks until the 15-minute kill, even though the publish already succeeded.
  - The entry stays `failed` / "Attempt started" with no evidence.
- **Fix:**
  ```powershell
  $timedOut = -not $child.WaitForExit(600000)
  if ($timedOut) { & "$env:SystemRoot\System32\taskkill.exe" /PID $child.Id /T /F | Out-Null; [void]$child.WaitForExit(30000) }
  $out = if ($stdout.Wait(30000)) { $stdout.Result } else { '[stdout not closed]' }
  $err = if ($stderr.Wait(30000)) { $stderr.Result } else { '[stderr not closed]' }
  Write-Log ('stdout:' + [Environment]::NewLine + $out)
  Write-Log ('stderr:' + [Environment]::NewLine + $err)
  if ($timedOut) { Write-Log 'npm timed out after 600s; tree killed.'; return -1 }
  ```

**3. Major: the A7 mutex contract is assumed, not verified**
- **Where:**
  ```
  $mutex = Enter-PipelineMutex -Name 'sxj-publish' -TimeoutSec 0
  ...
  if ($null -eq $mutex) { ... exit 75 }
  ```
- **What goes wrong:**
  - If the real function has no `-TimeoutSec` parameter (for example it uses `-TimeoutSeconds` or is positional-only), binding throws. The catch then exits 75 every day: silently "busy" forever, so no posts are made for 7 days.
  - If it returns `$false` on timeout, `$null -eq $false` is false. The script then publishes without the lock, and `Exit-PipelineMutex` is called on `$false`.
  - A syntax error in the library is also reported as 75.
  - Dot-sourcing into script scope lets the library silently override `Write-Log`, `Read-Queue` and similar functions if the names collide.
- **Fix:**
  ```powershell
  try { . $library } catch { Write-Log ('Lock library load failed: ' + $_.Exception.Message); exit 1 }
  $em = Get-Command Enter-PipelineMutex -CommandType Function -ErrorAction SilentlyContinue
  if ($null -eq $em -or -not $em.Parameters.ContainsKey('TimeoutSec')) { Write-Log 'A7 lock contract mismatch; no publish.'; exit 1 }
  try { $mutex = Enter-PipelineMutex -Name 'sxj-publish' -TimeoutSec 0 } catch { Write-Log ('Pipeline mutex unavailable: ' + $_.Exception.Message); exit 75 }
  if ($null -eq $mutex -or $mutex -is [bool]) { Write-Log 'Pipeline mutex unavailable; exit 75, no publish.'; exit 75 }
  ```
  Also: read the real A7 file and pin its signature and return type in the RESULT doc.

**4. Major: the queue write is in place and not atomic**
- **Where:** `Save-Queue`
  ```
  $stream = [IO.File]::Open($queuePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
  ... $stream.Write(...); $stream.SetLength(...)
  ```
- **Scenario:** a power loss or kill between `Write` and `SetLength` leaves a valid prefix plus a trailing old tail, which is invalid JSON. Every later run then:
  - throws in `Read-Queue` with `$entry = $null`;
  - exits 1 silently.

  The rest of the backfill dies unnoticed.
- **Fix:** this runs under the sidecar lock already.
  ```powershell
  $tmp = $queuePath + '.tmp'
  [IO.File]::WriteAllBytes($tmp, $bytes)
  [void](ConvertFrom-Json ([IO.File]::ReadAllText($tmp, $utf8)))
  [IO.File]::Replace($tmp, $queuePath, $queuePath + '.bak')
  ```

**5. Major: the date-word regex misses common Taiwanese forms**
- **Where:** `Get-DateTextHits`, `$pattern`.
- **Not matched:**
  - 禮拜一…禮拜日 and 禮拜天 (as common as 星期 in Taiwan)
  - 週末 / 周末
  - 上週 / 下週
  - 今晚, 今早, 明早, 明晚, 後天, 前天
  - **10月26號** (號 is the colloquial form; the code requires `日`)
  - 10／26 with a full-width slash
  - 十月
  - 萬聖節 (the posts go out on 10/31, so a "this weekend" post is plausible)
- **Fix:** append these alternatives to `$pattern`, and change `\u6708(...)\u65e5` to `\u6708(...)[\u65e5\u865f\u53f7]`.
  ```powershell
  '|[\u79ae\u793c]\u62dc[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u65e5\u5929]?|[\u9031\u5468]\u672b|[\u4e0a\u4e0b][\u9031\u5468]' +
  '|\u4eca[\u665a\u65e9]|\u660e[\u65e9\u665a]|[\u524d\u5f8c]\u5929|\u5341\u6708|\u842c\u8056' +
  '|(?<!\d)(?:0?[1-9]|1[0-2])\s*\uff0f\s*(?:0?[1-9]|[12]\d|3[01])(?!\d)'
  ```

**6. Major: only fields whose key matches `caption|first_comment` are checked**
- **Where:**
  ```
  ($InText -or $property.Name -match '(?i)caption|first[_ -]?comments?')
  ```
- **What is missed:**
  - `hashtags`, `title`, `cta`, `body`, `text`, `comment`, `pinned_comment`, or similar keys that `postCurrentSlot.ts` actually publishes. A `#週末洗鞋` hashtag passes.
  - The allowlist was never validated against the real calendar schema or the TS publish code.
- **Fix:** scan every string except URL and ID-like keys.
  ```powershell
  # in Get-CaptionStrings, pscustomobject branch:
  if ($property.Name -match '(?i)^(slot|date|time|id|.*url.*|image.*|asset.*)$') { continue }
  Get-CaptionStrings $property.Value $true
  ```
  Apply the same change to the IDictionary branch. Also verify in `postCurrentSlot.ts` that no text (footer or template) is appended at runtime.

**7. Minor: pre-publish non-publish outcomes waste the day**
- **Where:**
  ```
  if (-not $DryRun) { [void](Set-QueueEntry $entry 'done' ...) } ... exit 0
  ```
  The same happens in the date-skip path (`exit 0`).
- **Scenario:** each skipped or already-success entry costs one of the 7 days. With 2–3 skips, the window ends with pending items left.
- **Fix:** wrap the selection in `while ($true) { ... }` and re-select the next pending entry after the `done`/`skipped` updates. This only applies before any claim; the once-per-day guard from #1 still applies.

**8. Minor: `dry_run` truthiness**
- **Where:**
  ```
  -not $_.dry_run
  ```
- **Scenario:** if the TS writes `"dry_run": "false"` (a string), real success rows are ignored and the state reads `missing`. The publish is still attempted, and only TS `hasRecordedPost` prevents a duplicate.
- **Fix:**
  ```powershell
  -not ($_.dry_run -eq $true -or [string]$_.dry_run -ieq 'true')
  ```

**9. Minor: redaction misses Instagram tokens**
- **Where:**
  ```
  '(?i)\bEA[A-Za-z0-9_-]{20,}\b|...'
  ```
- **What goes wrong:** `IGQV…` / `IGAA…` tokens printed bare (with no `token=` prefix) reach the log.
- **Fix:** add `|\bIG[A-Z]{2}[A-Za-z0-9_-]{20,}` to that alternation.

**10. Minor: registrar defaults**
- **Where:**
  ```
  New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
  ```
- **What goes wrong:**
  - The default `DisallowStartIfOnBatteries` silently skips the run if the PC is a laptop on battery.
  - Registering after 2026-10-31 16:00 silently yields only 6 runs.
- **Fix:** add `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`, plus:
  ```powershell
  if ((Get-Date) -gt $first) { Write-Warning 'Registered after first slot; fewer than 7 runs remain.' }
  ```

**11. Minor: `[Console]::OutputEncoding` assignment is outside `try`**
- **What goes wrong:** in a console-less context it throws "handle is invalid". The script then exits 1 with no log line.
- **Fix:**
  ```powershell
  try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch {}
  ```

---

## Smoke-test gaps

- **No hang or timeout case.** The fake npm never sleeps, a grandchild never holds the pipe, and there is no partial-output-on-kill check.
- **No same-day second run.** Running the probe twice the same day publishes twice and the test treats that as success (see "advance-next").
- **The mutex tests use fake functions, never the real A7 library.**
  - `mutex-busy` calls `exit 75` from inside the fake, so the script's own null, `$false` and throw branches are never exercised.
  - Signature or parameter mismatch is untested.
- **No corrupt or truncated queue case**, and no `Read-Queue` failure leading to alerting.
- **Date-word coverage stops at the card list.** 禮拜X, 週末, 下週, 今晚, 10月26號, 全形／ and 十月 are not tested.
- **Calendar fixtures use invented keys** (`facebook_caption` / `instagram_caption`). There is no fixture copied from a real `data/content-calendar/2026-10-2x.json`, and no hashtag or non-caption field case.
- **No posted-log fixture in the real TS shape:**
  - field names and types;
  - string `dry_run`;
  - pre-existing `failed` rows from the 10/26 404 attempts;
  - slot stored as a string.
- **No partial-success case.** Starting from FB=success, IG=missing, nothing asserts that the TS skips FB and only IG is attempted.
- **No redaction case for bare tokens.** Every test token has a `token=` / `Bearer` prefix.
- **The registrar is fully mocked.** The fake trigger object already has an `EndBoundary` property, so the test cannot detect a real CIM trigger rejecting the string format. Settings defaults (battery) are not asserted.
- **The mutation test only removes the call site.** It does not mutate the regex. A weakened pattern (for example one dropping the `[本這]週` branch) would still keep most cases green; only the single matching case would turn red.
- **Business outcome not checked:** no test asserts that skip or already-done outcomes do not consume the day.

---

## Card issues and business risks

- **The queue lives in git-tracked `data/`.** A `git checkout`, `reset` or `stash`, or a later `publish-pages` run, can revert it.
  - This can resurrect an **owner stop** back to `pending`, or turn a partial `failed` back into `pending`, which causes an automatic retry.
  - Fixes:
    - Keep the queue gitignored (for example under `output/`), or make `-Stop` also run `Disable-ScheduledTask Laundry-Backfill-1600`.
    - The owner's stop should not depend on a JSON file.
- **Date text inside the PNG images cannot be checked by this script.** The owner or commander must eyeball all 7 `slot-0N.png` files before 10/31.
- **Seasonal content:** posts from 10/26–10/29 may reference the upcoming Halloween or weekend, and will appear on or after 10/31. The owner should review all 7 captions, not just regex hits.
- **No alerting.** `failed`, `skipped` and exit 75 / exit 1 only go to a local log. Nobody learns that the backfill stalled until the 7-day window has ended.
  - Add a daily summary, or have Sentinel-Afternoon (16:40) read the queue.
- **Sentinel-Afternoon at 16:40** may treat old-date posted-log writes or a third post of the day as anomalies. Check its rules before go-live.
- **The 7-day window has no slack.**
  - Interactive + Limited means no run if the user is logged off, the PC is asleep, or it is off, and there is no catch-up.
  - The card says "排 7 天" with exactly 7 items. Skips or missed days leave items unposted, and the card does not say what happens then.
- **Partial results (FB success, IG failed) are "no retry" by card rule.** This leaves the platforms inconsistent with no defined owner action. Define who reconciles, and by when.
- **Posted-log is the only double-publish guard.** Writing backfill rows into old-date files (`2026-10-26.json`) also misattributes them in any per-day analytics or reporting.