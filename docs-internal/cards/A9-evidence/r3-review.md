# A9 r3 final self-review

Reviewer: the implementing Codex session. This is a manual self-review, not an independent or cross-family review.

- Read the actual r3 card and the actual first-comment array schema/writer. Caption allowlist and selected-slot comment text match the requested scope. No recursive calendar metadata scan remains.
- Compared the final implementation with the r2 source captured before edits. Only text selection, the first-comment reader and the date-hit call changed. The r2 regex is identical after CRLF/LF normalization.
- Verified red baseline: 128 assertions, 23 failures against the old implementation. Corrected behavior: 128 passed, 0 failed, 1 native kill-tree verification BLOCKED, smoke exit 2.
- Read mutation failures: removing the date guard breaks 51 assertions; removing this-week regex breaks exactly the 2 corresponding cases; removing first-comment scanning breaks 9. Each mutation ran on a temporary copy and left the publisher SHA unchanged.
- Checked selected comment text, absent file/slot, metadata-only records, invalid JSON, internal dates, both captions' ISO dates/hashtags, and the preserved r2 daily/mutex/Stop/timeout/queue/redaction/registrar cases.
- Confirmed seven actual-data previews pass, default-root preview passes, and all eight preserve source/seed/runtime queue/log fingerprints. Actual first-comment logs have no selected-slot saved text, so no generated comment is reconstructed.
- Confirmed PS 5.1, all three PS1 files ASCII only and parser-clean. Registrar, seed, original calendar-shape fixture, existing dirty instruction/ignore files and all src/*.ts hashes match the initial manifest.
- Native acceptance remains incomplete: File.Replace preflight is denied and taskkill tree termination cannot be proven in this sandbox. The production script retains atomic replacement and bounded waits; no shim/fallback was added to production. ScheduledTasks CIM was not probed again in r3.
- No commit/stage/push, live npm publishing, real task registration/disable, LINE/Meta or secrets access occurred. External Vault is outside writable roots; local RESULT includes the safe writeback.

Evidence helper corrections: an inline diff command exceeded Windows' command-line limit, so comparison used a local JSON snapshot. The first comparison treated CRLF/LF as changes; normalizing line endings produced the final narrow diff and unchanged-regex result. A report assertion containing literal Chinese was damaged by the PowerShell stdin pipeline encoding; rerunning with ASCII Unicode escapes passed. These helper retries did not alter production code or the actual UTF-8 report.

Verdict: r3 scope correction and behavior verification are complete. Native all-green acceptance and formal activation are not claimed. Current results and the commander's remaining native checks are recorded in A9-RESULT.md.
