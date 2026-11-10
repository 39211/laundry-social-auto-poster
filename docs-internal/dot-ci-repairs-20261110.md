# dot CI repairs — 2026-11-10

## Ownership and scope

Prepared by **dot**, at the owner's request, in an isolated cloud directory with offline tests and dummy credentials. This is a separate Draft stacked on PR #316 head `4359659f717d0e5964ece83cf3c652cd890b2029`. No production publishing, deployment, scheduler changes, real credentials, merge, or edits to another working directory.

## What was wrong and what changed

1. `docs/ai-sitemap.xml` retained 2026-09-05 / 2026-09-07 / 2026-08-23 dates for four AEO325 pages, although their authored HTML dateModified and the unchanged acceptance test require 2026-10-18. Updated only these four lastmods from the existing authored values; URLs, metadata, and other entries unchanged. No build-clock timestamps.
2. Fingerprint T8 used the same fixture twice: the first image HEAD failure created a failure record, so the second call correctly entered recovery rather than making a fresh publish. Split into independent parameterized fixtures. Check actual HEAD versus Facebook photo POST calls; also retry each failed fixture and require `needs_manual:readback_unknown` with no new POST. Production recovery remains unchanged.
3. Windows scheduler harness compared raw path spellings. Compare `realpathSync.native` values for strict equality; exercise the actual preflight copied with Push-Location pointed at a wrong child directory, and require rejection. Retain the newer mutex AST checks. This follows the narrowly scoped directory fix and negative control in #240, not a loose prefix check.
4. The checked-in public-feed contract treated feature reel slot 0 as a daily calendar slot. Feature reels are generated from feature-reels / feature-posted-log and deliberately have no daily-calendar slot. Validate their explicit discriminant, media type, identifiers, paths, empty image-path lists, publication date and platform list; keep discovery text/image equality and all daily slot/image/HTML checks. Add 16 corrupt-field negative cases. This is stricter than the presence-only feature field exception in #262.

Private feature source/publication records are not tracked in this checkout. The new helper documents that public shape is NOT proof of private approval. Existing `seoSyncP1.test.ts` fixture tests exercise generation with feature-reels and publication-log records. Do not manufacture production source records from the public feed.

## Evidence and remaining failure

- Original [run 42755915497](https://github.com/39211/laundry-social-auto-poster/actions/runs/42755915497): 2092 passed / 5 failed / 19 skipped. It checked out merge `4e9232d18dba34b5570475111063509457ccd540`, not bare head dce1c15.
- Latest source [run 42761032185](https://github.com/39211/laundry-social-auto-poster/actions/runs/42761032185): 2098 passed / the same 5 failed / 19 skipped. It checked out merge `48ec6b0` of head 4359659 into newer release `03fc8e21bd024bf95ec07dfee5695f7e086311e9`.
- Unchanged AEO325 suite before correction: 44 passed / 1 failed, exact old lastmod failure. After correction: 45 passed.
- Fingerprint suite: 24 passed, including both initial paths and conservative retry behavior.
- Feature contract: 17 passed (all checked-in features plus 16 corrupt-field cases).
- Original complete checked-in public-feed/calendar/HTML/image contract: 1 passed; other 50 tests unselected for that focused command.
- TypeScript noEmit and reel-registry drift gate: passed. Independent read-only review: no Critical/Important finding.
- Windows PowerShell harness cannot run on this Linux executor (`powershell.exe` ENOENT). Its 10 unexecuted tests are NOT passes; the new PR's Windows CI must validate them.

The live sitemap equality assertion remains unchanged and is expected to remain red: the release-only fixture generates 145 nonpost URLs while the actual site exposes 213. The 68 extra paths correspond to real authored files under main's SEO overlay (including guides, journal, booking, campaign, a hub and a service). This is a two-source site integration issue, not justification to change 145 to 213, fabricate fixture pages, skip the test or claim full green. Validate a controlled combination of the release generator and the approved main/root overlay, or review an explicit source synchronization separately.

#262 and #240 are still unmerged and have different bases. This patch does not merge either PR wholesale, close them, alter their history, or assume their historical results validate this head. main is not an equivalent test baseline because several release-specific tests are absent there.

## Verification commands

All local runs used a clean environment with dummy PUBLIC_SITE_BASE_URL / PUBLIC_IMAGE_BASE_URL, no account credentials. The full run additionally blocked outbound fetch/http/https; live-network assertions are not represented as passed.

- `node node_modules/vitest/vitest.mjs run test/aeo325PageCopy.test.ts test/publicFeatureContract.test.ts --maxWorkers=1`
- `node node_modules/vitest/vitest.mjs run test/approvePostFingerprint.test.ts --maxWorkers=1`
- `node node_modules/vitest/vitest.mjs run test/publicSite.test.ts -t 'keeps checked-in public feeds' --maxWorkers=1`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node scripts/check-reel-registry-drift.mjs`
- `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=<isolated-evidence>/full.json`

No test timeout was increased and no test or assertion was removed to hide the live drift.

## Final full local run

Node 24.22.1 / Linux, outbound HTTP denied: **2047 passed / 40 failed / 54 skipped**, exit 1. This is NOT a green suite. Failures include missing Windows PowerShell, tsx IPC socket EPERM, and the intentionally blocked live sitemap request. The calendar harness fails before tests because PowerShell is absent. No blanket claim that every failure has been proven baseline.

Failed assertion names:

- tamper rebuild path CLI --inspect-calendar exits 2 and prints shouldRebuild for a forged calendar
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-08
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-23
- daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-11-06
- daily generation planned object keeps the old plan ahead of an overlapping extension row
- daily generation planned object returns empty when the extension is missing
- daily generation planned object returns empty when the extension is malformed
- daily generation planned object returns empty when both plan reads fail
- image route is GPT Codex only R5 Get-LaundryCodexModel defaults, honors override, and trims blank
- W-LEADTIME D+3 generation default daily-generate defaults to Taipei now+3 and honors -Date
- W-LEADTIME D+3 generation default reverting daily-generate default to today yields today, proving AddDays(3) is the discriminator
- W-LEADTIME D+3 generation default produce-next-reel defaults to now+3 and honors -Date
- W-LEADTIME D+3 generation default reverting produce-next-reel default to today still honors -Date, proving AddDays(3) is the discriminator
- W-LEADTIME D+3 generation default approve / catchup / sentinel still target today, not D+3
- W-LEADTIME D+3 generation default changed PowerShell scripts still parse
- catch-up public-site repush failure stays in-section fragment: failed flag still posts then exits 2
- catch-up public-site repush failure stays in-section fragment: clear flag exits 0
- line-attribution-report.ps1 rolls fixture CSV into link_source x count x wow
- line-attribution-report.ps1 prints the no-data tutorial and does not fail when exports are missing
- line-attribution-report.ps1 mutation 3: a misaligned CSV (no link_source / Event count) fails
- R3 media guard CLI returns exit 3 and writes the lock message to stderr for a locked slot
- R3 media guard CLI returns exit 0 and MEDIA_GUARD ok for an unlocked slot
- R3 media guard CLI accepts the explicit CLI override only when its reason is present
- R3 media guard CLI accepts MEDIA_GUARD_OVERRIDE_REASON for PowerShell callers
- R3 media guard CLI treats --force-regen-scheduled without --reason as no override
- REGENGUARD-R2 restore and heal F1 --restore passes the explicit override and audits the restore operation
- REGENGUARD-R2 restore and heal F3 --heal keeps exit 0 and repairs the next plan half after a media-locked stop
- REGENGUARD-R2 restore and heal R3 --heal override requires --slot before either plan half changes
- REGENGUARD-R2 restore and heal R4 M7 environment override requires --slot before either plan half changes
- REGENGUARD-R2 restore and heal R4 M8 legacy slot 3 heal is a no-op for a scheduled Reel date without an A/B plan
- REGENGUARD-R2 restore and heal R3 --heal override with --slot 2 leaves slot 3 bytes, calendar row and audit untouched
- REGENGUARD-R2 restore and heal R3 heal rethrows a missing sidecar instead of reporting media-locked
- REGENGUARD-R2 PowerShell root and missing videos R3 'generate-missing-images.ps1' passes the spaced fake root to media-guard under a failing npm.cmd
- REGENGUARD-R2 PowerShell root and missing videos R3 'regenerate-boutique-images.ps1' passes the spaced fake root to media-guard under a failing npm.cmd
- REGENGUARD-R2 shared override parser and plan scope R6 mediaGuardCli accepts a whitespace USERNAME as unknown
- REGENGUARD-R2 shared override parser and plan scope R6 --plan never forwards the 'explicit flag' override into its multi-date schedule
- REGENGUARD-R2 shared override parser and plan scope R6 --plan never forwards the 'environment' override into its multi-date schedule
- reelSubtitlesCli end to end writes a portrait ASS file from a narration file and real durations
- seo overrides and URL path normalization seo override files should be byte-identical after generation
- carousel CLI surface visualQaCli accepts --carousel emit-prompt for a file list

## Same-environment baseline comparison

With the same materialized inputs, Node, clean environment and outbound HTTP block, exact 4359659 baseline ran **2026 passed / 43 failed / 53 skipped**. The first repair candidate ran **2047 passed / 40 failed / 54 skipped**, with **zero new failed assertion names**. The three removed failures are AEO325 lastmod, fingerprint T8 and checked-in public-feed consistency. The additional unexecuted test is the Windows wrong-cwd negative control; Linux cannot validate it.

Local image metadata regeneration also completed with 277 records and identical pre/post blob hash `ed8ecd24bfb4338fa3a6851fbeac4526378760c4`. The sparse checkout lacks 274 webp binaries, which the tool reports as warnings; this does not establish missing production assets.

## Durable date follow-up

The initial data-only correction exposed a generator defect: authored dates were applied to sitemap.xml, but not ai-sitemap.xml. Added a date-only AI-sitemap normalizer so regeneration cannot revert the corrected lastmods. It keeps URL membership, order, other metadata, and entries with no lastmod unchanged; it accepts only matching origin and site-base boundaries. Authored HTML supplies dates even when only the AI sitemap is selected. Unselected HTML/sitemap output is not rewritten, including by the existing post/noindex cleanup stages. Full generation retains those cleanup stages.

The AI-sitemap part of the byte-identity test now expects only this authored-date normalization, while preserving the rest of the XML byte-for-byte. Other file identity checks and the live sitemap equality/cap assertions remain unchanged. Independent golden integration fixtures assert exact expected XML rather than deriving their expected dates with the production helper.

Exact 4359659 generator source failed all three initial new integration cases on stale lastmod assertions (not missing imports). The fixed generator passed the three integration tests plus seoSyncP0a/seoSyncP1, 26 tests total. Final focused/full and Windows results are recorded separately below.

## Initial head Windows CI

[Run 42761948758](https://github.com/39211/laundry-social-auto-poster/actions/runs/42761948758) for initial repair head `e2e3118c6d00bf304e039271dd6edfd4448c9a2c`: **2120 passed / 2 failed / 19 skipped**. All four original repair targets passed; the Windows cwd suite passed all 10 cases. Remaining failures: untouched live145/213 drift; seoSyncP0a's sitemap-cap test timed out at its unchanged 5000ms limit and cleanup reported ENOTEMPTY. That same test passed in 572ms on the prior #316 CI; timing variability is evidence, not proof of the new failure's full cause. No timeout was raised. This historical run does not validate the later generator follow-up.

## Final durable candidate validation

- Focused date/SEO regressions: **28 passed**, default test timeouts. Includes both `/project` and `/project/` root spellings, foreign hosts, outside-prefix URLs, query/fragment URLs, missing lastmods, exact XML metadata, and unselected-output byte preservation.
- Final complete offline Linux run: **2052 passed / 40 failed / 54 skipped**, exit 1. Compared with same-environment exact4359659 baseline, **no new failed assertion names**; the same three original assertion failures are eliminated. PowerShell is still not available locally.
- TypeScript noEmit and registry checks passed again after the generator change. Independent review of the final production/test delta found no Critical/Important issue.
- Known nonblocking extraction limitation: the authored date reader follows the existing generator's first JSON-LD `dateModified` and YYYY-MM-DD shape convention. More complex future pages containing multiple dated entities or invalid calendar dates need a targeted schema-date contract; the four current corrected targets have verified authored dates.
- Windows CI for the final commit must be read independently; the earlier e2e3118 run is not acceptance of this follow-up.
