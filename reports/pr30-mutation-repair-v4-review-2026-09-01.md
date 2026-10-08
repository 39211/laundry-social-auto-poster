# PR #30 mutation repair v4 — independent review

Date: 2026-09-01 (Asia/Taipei)

## Verdict

`REWRITE / CANNOT SHIP`

No commit, push, merge, deployment, sitemap update, IndexNow submission, or Search Console resubmission was performed.

## Work isolation

- Worktree: `C:\Users\cyc39\.codex\worktrees\sxj-pr30-repair-20260831`
- Branch: `codex/index-growth-pr30-repair`
- Base: PR #30 head `ba6ab5a85524c3a5e4fa4c0848c89be7b944881d`
- Modified files only:
  - `src/indexGrowthPages.ts`
  - `test/indexGrowthPages.test.ts`
- Main dirty worktree was not modified by the implementation lane.

## What v4 fixed

Independent replay confirmed these prior attacks now fail closed:

1. In-place citation source-ref alias rebinding returns `claim-provenance` failure.
2. Forged non-empty source origin/note with a recomputed self-hash returns `source-provenance` failure.
3. Dangerous mold advice remains `mold-safety` red even when the mutated body lock is updated; safe phrases such as `不一定能恢復` remain green.
4. Accepted public projection and count now pass through the resolver rather than a second direct map path.

Observed checks on v4:

- focused index-growth tests: 18/18 passed
- public-site tests: 26/26 passed
- full suite: 720 passed, 16 skipped
- typecheck: passed
- diff check: passed
- scope: only the two whitelisted files; no `data/.calendar-hmac-key` remained

These green checks are not release approval because the independent reviewer found two untested high-severity bypasses.

## Remaining blockers

### 1. Registry key and record identity are not bound

`sourceMatchesPinnedLock` uses `record.id` to choose the pin but does not require the registry key to equal `record.id`. Replacing `registry['bp:business-profile']` with the otherwise valid `svc:shoe-bag-care` record still validates with `ok:true`.

Required repair:

- enforce `record.id === registry key`;
- look up the pinned hash by the registry key only;
- add a mutation test that swaps two valid records and must turn red, then restores green.

### 2. Accepted export hard-codes a historical date

The accepted export invokes the resolver with `today: '2026-08-31'`. A legitimate catalog update dated 2026-09-01 then fails during module import with `volatile-lastmod`, permanently blocking normal future updates.

Required repair:

- remove the fixed historical `today` from module initialization;
- keep deterministic date injection only in tests or call sites that explicitly own a clock;
- add a next-day normal-update test so valid future content can enter while missing/invalid publish state still fails closed.

## Stop rule applied

The task contract allowed one bounded repair and required stopping after a second substantive failure. v4 is therefore not followed by an automatic v5. A new, narrowly scoped repair task and a fresh independent replay are required before PR #30 can be committed, pushed, merged, or used for the single-page `shoe-odor-source.html` pilot.
