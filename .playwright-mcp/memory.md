# Monitor IG media publish error

- Run time: 2026-08-10T01:10:58+08:00
- Parsed all 31 `data/posted-log/*.json` files through `2026-08-09.json` (121 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the immutable 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record is a 2026-08-09 slot 2 non-dry-run Reel success on its first attempt with a post ID.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content or retry Meta writes. PowerShell and Node startup were blocked by `CryptUnprotectData failed: 2148073483`; read-only local-file browser fallback was used only to enumerate and parse JSON, with no Meta site access.


- Run time: 2026-08-08T20:18:21+08:00
- Parsed all 30 `data/posted-log/*.json` files through `2026-08-08.json` (117 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the immutable 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record is a 2026-08-08 slot 3 non-dry-run Reel success on its first attempt with a post ID.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, use browser automation, or inspect source/tests.

- Run time: 2026-08-07T20:17:28+08:00
- Parsed all 29 `data/posted-log/*.json` files through `2026-08-07.json` (111 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the immutable 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record is a 2026-08-07 slot 3 non-dry-run Reel success on its first attempt with a post ID.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-08-06T20:19:43+08:00
- Parsed all 28 `data/posted-log/*.json` files through `2026-08-06.json` (105 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the immutable 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The newest file adds only a 2026-08-06 Facebook success; the latest Instagram record remains a 2026-08-05 non-dry-run success.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-08-05T20:17:47+08:00
- Parsed all 27 `data/posted-log/*.json` files through `2026-08-05.json` (104 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the immutable 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. Both latest-date Instagram records (2026-08-05 slots 1 and 2) are non-dry-run successes; this monitor did not retry or reconcile their attempt counts.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-08-04T20:18:35+08:00
- Parsed all 26 `data/posted-log/*.json` files through `2026-08-04.json` (100 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record, 2026-08-04 slot 1, succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-08-02T20:17:46+08:00
- Parsed all 24 `data/posted-log/*.json` files through `2026-08-02.json` (94 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record, 2026-08-02 slot 2, succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-08-01T20:17:39+08:00
- Parsed all 23 `data/posted-log/*.json` files through `2026-08-01.json` (90 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record, 2026-08-01 slot 1, succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-31T20:17:28+08:00
- Parsed all 22 `data/posted-log/*.json` files through `2026-07-31.json` (88 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. The latest Instagram record, 2026-07-31 slot 1, succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-30T20:18:19+08:00
- Parsed all 21 `data/posted-log/*.json` files through `2026-07-29.json` (86 records total; no JSON parse errors). The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 was found. Both latest-date Instagram records (2026-07-29 slots 1 and 2) succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-29T21:10:34+08:00
- Parsed all 21 `data/posted-log/*.json` files through `2026-07-29.json`. The exact case-sensitive condition (Instagram + `status: failed` + error exactly `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No newer recurrence was found. Both 2026-07-29 Instagram slots succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-28T20:17:36+08:00
- Scanned all 20 `data/posted-log/*.json` files through the latest file, `2026-07-28.json`. The exact case-sensitive condition (Instagram + `status: failed` + `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines; all JSON files parsed successfully.
- No newer recurrence was found. The 2026-07-28 Instagram slot 2 record succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-27T20:16:53+08:00
- Scanned all 19 `data/posted-log/*.json` files through the latest file, `2026-07-27.json`. The exact case-sensitive condition (Instagram + `status: failed` + `Media ID is not available`) still has exactly three matches: the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No newer recurrence was found. The 2026-07-27 Instagram slot 1 record succeeded on its first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-25T20:17:10+08:00
- Scanned all 18 `data/posted-log/*.json` files through the latest file, `2026-07-25.json`. Exact Instagram failed records with `Media ID is not available` remain limited to the known 2026-07-04 slot 2, 2026-07-10 slot 2, and 2026-07-12 slot 2 baselines.
- No recurrence newer than 2026-07-12 and none since the 2026-07-24 last run. Both 2026-07-25 Instagram slots succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content, retry Meta writes, or use browser automation.

- Run time: 2026-07-23T20:16:08+08:00
- Scanned all 17 `data/posted-log/*.json` files through the latest file, `2026-07-22.json`. Exact Instagram failed records with `Media ID is not available` remain limited to the known 2026-07-04 baseline and the previously recorded 2026-07-10 slot 2 (`2026-07-10T11:32:57.104Z`) and 2026-07-12 slot 2 (`2026-07-12T11:31:18.065Z`) recurrences.
- No recurrence newer than 2026-07-12 and none since the 2026-07-22 last run. Both 2026-07-22 Instagram slots succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content or use browser automation.

- Run time: 2026-07-22T20:17:43+08:00
- Scanned all `data/posted-log/*.json` through the latest file, `2026-07-22.json`. Exact Instagram failed records with `Media ID is not available` remain limited to the known 2026-07-04 baseline and the previously recorded 2026-07-10 slot 2 (`2026-07-10T11:32:57.104Z`) and 2026-07-12 slot 2 (`2026-07-12T11:31:18.065Z`) recurrences.
- No recurrence newer than 2026-07-12 and none since the 2026-07-21 last run. Both 2026-07-22 Instagram slots succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content or use browser automation.

- Run time: 2026-07-20T20:18:21+08:00
- Scanned all `data/posted-log/*.json` through `2026-07-20.json`. Exact Instagram failed records with `Media ID is not available` remain limited to the known 2026-07-04 baseline and the previously recorded 2026-07-10 slot 2 (`2026-07-10T11:32:57.104Z`) and 2026-07-12 slot 2 (`2026-07-12T11:31:18.065Z`) recurrences.
- No recurrence newer than 2026-07-12 and no recurrence since the 2026-07-19 prior run was found. Both 2026-07-20 Instagram slots succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content or use browser automation.

- Run time: 2026-07-19T20:16:39+08:00
- Scanned all 15 `data/posted-log/*.json` files through `2026-07-19.json`. Exact Instagram failed records with `Media ID is not available` remain limited to the known 2026-07-04 baseline and the previously recorded 2026-07-10 slot 2 (`2026-07-10T11:32:57.104Z`) and 2026-07-12 slot 2 (`2026-07-12T11:31:18.065Z`) recurrences.
- No recurrence newer than 2026-07-12 and no recurrence since the 2026-07-18 prior run was found. The 2026-07-19 Instagram slot 1 and slot 2 records both succeeded on their first attempt.
- Per the monitor rule, no project source, tests, or posted-log files were changed and no tests were run. Did not publish content or use browser automation.

- Run time: 2026-07-18T20:16:45+08:00
- Scanned all `data/posted-log/*.json` through the latest file, `2026-07-18.json`. Exact Instagram failed records remain limited to the known 2026-07-04 baseline plus 2026-07-10 slot 2 at 2026-07-10T11:32:57.104Z and 2026-07-12 slot 2 at 2026-07-12T11:31:18.065Z.
- No recurrence newer than 2026-07-12 was found, including no recurrence since the prior run. Per the monitor rule, no project files or tests were changed or run.
- Did not edit `data/posted-log`, publish content, or use browser automation.

- Run time: 2026-07-17T20:17:10+08:00
- Reconfirmed newer exact recurrences after the known 2026-07-04 baseline: 2026-07-10 slot 2 at 2026-07-10T11:32:57.104Z and 2026-07-12 slot 2 at 2026-07-12T11:31:18.065Z. No later exact recurrence was present.
- The focused fix remains present in `src/postInstagram.ts`, with focused coverage in `test/postInstagram.test.ts`; no source or test edits were needed in this run.
- Verified behavior: poll the Instagram container status until `FINISHED` before `media_publish`; reject terminal, unknown, or timed-out states; preserve dry-run early return and outer three-attempt retry behavior. The focused test also asserts Instagram posting does not write posted logs directly.
- Verification: `npm.cmd run typecheck` passed; `npm.cmd test` passed (18 files, 80 tests); `git diff --check` passed with line-ending warnings only.
- Did not edit `data/posted-log`, publish content, or use browser automation.
