# Laundry Video Repair Cycle — 2026-08-14 20:30

## Result

`VIDEO_DEFERRED_NO_GO`

- The queue remains 24 `VIDEO_DEFERRED`, 0 `RESOLVED`, 0 replacement-ready, with no duplicate source key or generation ID.
- All 24 failure reasons and original prompts were read in date/slot order. Thirteen submitted generations have matching prompt, input and output hashes; seven named but unsubmitted IDs still have zero job records.
- The 12 historical retained raws and the new Slot 2 raw all fully decode 145/145 frames with zero PTS anomalies and one submit/download/QC each. All 13 are 1088x1920; native 1080x1920 pass count remains zero.

## 2026-08-14 repair

### Slot 1

- Three first-frame edit attempts changed only card/rail geometry. One missed the right-shoe-opening occlusion, one deleted the right shoe, and the latest preserved two shoes but detached the card from its rail.
- No exact 1080x1920 first frame passed. `generate-shot.ps1` was not called for Slot 1 and its video submission count remains zero.
- Existing Facebook and Instagram four-image carousels are non-dry-run successes with `attempts=1` and `VIDEO_DEFERRED`; they were not relabelled or republished.

### Slot 2

- The repaired exact 1080x1920 first frame keeps the card and rail outside the zipper path and visibly occludes the beige seam. SHA-256: `0A55C1C6B3D9D08E1E80A7BF754256FA8ED8356AF1F0670CC79FB7B11D194325`.
- The sanitized Hermes report completed with OAuth, `video_gen` and dependencies ready. Its outer command channel timed out during teardown, but the complete JSON report and all internal command exit codes are present; no bypass or API-key route was used.
- New ID `sixiangjia_20260814_s02_makeup_pouch_seam_card_exit_v02` was submitted exactly once. Provider status is `done`; submit/poll/download/QC is `1/5/1/1`.
- Raw SHA-256 `6D75B87D24912FE98E3598FD4CAE4E6AF27AF6E1DBA5E6B903A4F10303034A81` fully decodes, but is native 1088x1920, so it is rejected without resize. Contact-sheet review is triage only.
- No independent zh-TW TTS, subtitle/mastering, Grok final review, final master, later topic-matched package, `resolve-video-repair --ready`, or publication was performed.

## Publication observation

- 11 queued source slots have verified Facebook/Instagram image-fallback success.
- 6 have later dual-platform Reels but no valid repair linkage; they remain deferred.
- 7 have partial or no dual-platform success.
- The 2026-08-14 Slot 2 formal luggage-wheel Reel remains excluded because its prompt hash does not match the makeup-pouch repair prompt. Slot 2 has no Facebook/Instagram success record.

## Governance

- Knowledge pack: `0.3.0-evidence-150-full-audit-quarantine`, cutoff 2026-07-20, accepted evidence 0. This review is synthetic media technical/physics QA only and does not authorize professional care or effect claims.
- Fable headless planning was blocked by the existing interactive-only safety launcher. No bypass was attempted; execution continued Sol-only under the fail-closed contract.
- `data/posted-log/2026-08-14.json` stayed SHA-256 `C5A58402FC0019C7EEFDBB7620F43FB1CF53C6C117ADC0D94C61D50064ADDAEE`.

Detailed audit: `reports/laundry-video-repair-cycle/2026-08-14-2030-audit.json`.
