# 2026-08-15 Laundry Video Repair Cycle

## Result

- Final queue: 27 `VIDEO_DEFERRED`, 0 ready, 0 `RESOLVED`; SHA-256 `AA51D3145454FB214EF293CC11753DE956703FD53E7DEE038B8F9203FAFADB45`.
- Slot 1 received three card/rail-only first-frame edits. The final 1080x1920 frame has a coherent connected rail, but the card no longer occludes the right shoe opening. No video generation was submitted.
- Slot 2 received two card-height/occlusion-only first-frame edits. The final 1080x1920 frame passed the first-frame gate and one new generation ID was submitted exactly once through the current Hermes xAI OAuth subscription route.
- Slot 2 provider output completed and downloaded once, but returned 1088x1920. Full decode passed 145/145 frames with zero PTS anomalies; full-resolution frames 0, 48, 96 and 144 also show the card leaving the fixed rail. The raw was rejected without resize or resubmission.
- Slot 3's formal review now exists and its prompt hash matches the calendar prompt, but the MP4 is only 720x1280 and its recorded source report is missing. It stays deferred.

## Publication state

- This repair run did not publish or write `posted-log`.
- Before this run, Slot 1 and Slot 3 had already recorded one Facebook and one Instagram image success each with `attempts=1` and `VIDEO_DEFERRED`.
- Slot 2 still has no Facebook or Instagram success record.
- No historical image post was republished, relabelled as video success, or used to resolve a repair.

## Evidence

- First-frame review: `video-production/repair/2026-08-15/qa/first-frame-review-2030.json`
- Slot 2 manifest/job/report: `video-production/repair/2026-08-15/manifests/slot-02-grok-video-v02.json`, `video-production/repair/2026-08-15/jobs/slot-02-v02-job.json`, `video-production/repair/2026-08-15/reports/slot-02-v02-generate-shot.json`
- Slot 2 raw QA: `video-production/repair/2026-08-15/qa/slot-02-v02-raw-validation.json`
- Sanitized Hermes inspection: `reports/laundry-video-repair-cycle/2026-08-15-2030-hermes-inspect.json`
- Structured audit: `reports/laundry-video-repair-cycle/2026-08-15-2030-audit.json`

## Validation

- Preproduction governance contract: pass, while `generation_authorized=false` remains the professional/effect-claim gate; the user-authorized daily no-effect synthetic lane was applied only after its conditional first-frame, policy, and Hermes gates passed.
- `npm.cmd test`: 46 files, 246 tests passed.
- `npm.cmd run typecheck`: passed.
- JSON parse, queue invariants, and scoped `git diff --check`: passed.
- Fable headless planning was blocked by the existing interactive-only safe launcher; it was not bypassed. The run continued with Sol-only fail-closed gates.

## No-go boundary

No independent zh-TW TTS, Grok final review, master, topic-matched unpublished replacement linkage, or `resolve-video-repair --ready` was created because upstream native-resolution and physical-action gates failed. All replacement fields remain `null`.
