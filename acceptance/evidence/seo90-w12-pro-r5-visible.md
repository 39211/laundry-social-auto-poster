# SEO90 W12 Pro R5 visible verdict — 2026-09-22

Prompt marker: `W12-CONTRACT-MISMATCH`.

Pro verdict: **A. 不需改碼。**

The current `scripts/seo90-release.ts` interface intentionally does not expose a
`--bundle` option. The formal runner loads the bundle only from the trusted pin's
`sourceBundlePath` and validates it against `sourceBundleSha256`; a caller must not
pass or substitute a second bundle path.

The only scheduled entry is the real system-clock command below. It is recorded for
the 2026-09-25 09:00 Asia/Taipei due window and was not executed early:

```powershell
npx.cmd tsx scripts/seo90-release.ts run --policy "C:\Users\cyc39\Documents\AI_Agency\products\_coordination\sxj-seo90-20260922\notebook-seo-integration\RELEASE-PIN.json" --root "C:\Users\cyc39\Documents\AI_Agency\products\_coordination\sxj-seo90-20260922\site" --journal "C:\Users\cyc39\Documents\AI_Agency\products\_coordination\sxj-seo90-20260922\notebook-seo-integration\seo90-release-journal.json"
```

At the scheduled run, `--test-now`, `rehearse`, direct generator/publishPages,
manual docs edits, a new intent, or a replacement bundle are prohibited.
