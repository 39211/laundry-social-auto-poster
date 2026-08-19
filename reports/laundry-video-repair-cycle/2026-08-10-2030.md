# 2026-08-10 20:30 Laundry Video Repair Cycle

## Outcome

- Final verdict: `NO_GO_VIDEO_DEFERRED`.
- Queue after the audit: 20 `VIDEO_DEFERRED`, 0 `RESOLVED`, 0 ready links, 0 duplicate source keys, 0 duplicate generation IDs, 0 submitted-once records missing hashes, and 0 invalid ready/null combinations.
- This cycle did not run a new Hermes inspection because no new video submission was safe. It did not submit or retry any generation ID, reconcile any request, create TTS/master media, bind a replacement, run `resolve-video-repair --ready`, publish, repost, or write `posted-log`.
- The only project-data change was a surgical correction to the two 2026-08-10 queue explanations: Slot 1 now preserves its first-frame/governance root cause instead of the publisher's generic missing-file summary; Slot 2 now records that the later dual-platform plush-doll Reel is not the makeup-pouch repair candidate.

## Current hard gates

1. The current preproduction validator exits 0 but reports `generation_authorized=false`; the knowledge pack is `0.3.0-evidence-150-full-audit-quarantine`, cutoff 2026-07-20, with zero accepted evidence units.
2. The two current exact-ratio first frames are 1080x1920 and match their recorded hashes, but both fail. Slot 1 does not create the locked shoe-collar occlusion, does not expose the required hand geometry, and has pseudo-text risk. Slot 2 does not block the inner-seam conflict, does not expose the required hand geometry, and lacks a stable powder anchor.
3. Twelve retained submitted repair raws passed current-run full decode and SHA-256 matching, 145/145 frames each. Every one is provider-native 1088x1920 rather than required native 1080x1920. No resizing is accepted.
4. There is no pending, timed-out, or download-incomplete original request to reconcile. All twelve submitted IDs remain one-submission records.
5. `validate-publishable-media` exits 0 through the carousel fallback path and reports only Slot 1 missing video. That structural result does not clear manual first-frame, topic-linkage, native-resolution, TTS, formal-review, ready-link, or publication gates.

## Date and slot audit

| Source | Same-day publication evidence | Prompt / first-frame / raw / QA evidence | Decision |
|---|---|---|---|
| 2026-07-29 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | Formal 1080x1920 master decodes 240/240; formal Slot 1 video review remains absent | owner review only; no automated regeneration |
| 2026-07-30 S1 | no posted-log | prompt/input/output hashes match; 1088x1920 raw decodes 145/145; shoe leaves its stop and rotates | deferred |
| 2026-07-30 S2 | no posted-log | hashes match; 1088x1920 raw decodes 145/145; physical action passes | deferred on native QC and downstream gates |
| 2026-07-31 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | hashes match; 1088x1920 raw decodes 145/145; card does not clear shoe opening | deferred |
| 2026-07-31 S2 | no same-slot success | hashes match; 1088x1920 raw decodes 145/145; cover/bin action passes | deferred on native QC and downstream gates |
| 2026-08-01 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | hashes match; 1088x1920 raw decodes 145/145; physical action passes; image package has material defects | deferred; historical image posts unchanged |
| 2026-08-01 S2 | no same-slot success | hashes match; 1088x1920 raw decodes 145/145; physical action passes; image package has material defects | deferred; no topic-matched publication |
| 2026-08-02 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | hashes match; 1088x1920 raw decodes 145/145; diagonal/rotating card trajectory fails | deferred |
| 2026-08-02 S2 | FB+IG Reel exists for a different scheduled asset | repair hashes match; 1088x1920 raw decodes 145/145; normal-speed acceptance not cleared | deferred; published Reel is not a linked replacement |
| 2026-08-03 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | calendar topic is makeup pouch but its original video prompt is a structured-handbag rotation; no repair first frame, job, or raw | deferred |
| 2026-08-04 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | hashes match; 1088x1920 raw decodes 145/145; opening duplicates card and hand | deferred |
| 2026-08-04 S2 | no same-slot success | hashes match; 1088x1920 raw decodes 145/145; identity/continuity and source-topic linkage fail | deferred |
| 2026-08-06 S1 | Facebook carousel only, `VIDEO_DEFERRED` | hashes match; 1088x1920 raw decodes 145/145; sequence triage is not full-resolution acceptance | deferred; historical Facebook post unchanged |
| 2026-08-06 S2 | FB+IG Reel exists; Instagram attempts 2 | repair raw decodes 145/145; formal Reel is a different scheduled asset | deferred; attempts 2 is a governance alert, not a retry reason |
| 2026-08-07 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | two exact first frames fail rail/anatomy; zero submissions; image package material NO-GO | deferred |
| 2026-08-07 S2 | FB+IG Reel exists for another topic | two exact first frames fail anatomy; zero repair submissions; published Reel is not the canvas-shoe repair | deferred |
| 2026-08-08 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | two exact first frames fail conflict/hand geometry; zero submissions | deferred; historical posts unchanged |
| 2026-08-08 S2 | FB+IG backpack Reel, attempts 1 | two makeup-pouch first frames fail rail/zipper/powder/hand gates; zero repair submissions | deferred; published Reel cannot be linked retroactively |
| 2026-08-10 S1 | FB+IG carousel, attempts 1, `VIDEO_DEFERRED` | exact first frame hash `537E4D...` fails conflict/hand/pseudo-text gates; zero submissions | deferred; historical image posts unchanged |
| 2026-08-10 S2 | FB+IG plush-doll Reel, attempts 1 | exact repair first frame hash `D19D88...` fails seam/hand/powder gates; repair prompt hash `54BE0E...` differs from published review hash `664C8D...`; zero repair submissions | deferred; published Reel is not the repair candidate |

## Integrity and validation

- Queue SHA-256 before this cycle's correction: `30BB97110E9D98E9DA8120933348F3E1B77C2980E18F7997158417B98A9A1A70`.
- Queue SHA-256 after correction: `4525C5F87EA33D314F9F89FE2CCBD8644D431A01EA8CDD46132501F4B0E5310D`.
- 2026-08-10 posted-log SHA-256 remained `86B7E9A861493ABBA972EEA008DBF6CE66D52B00DC1F3E0584536D769720BE4D`.
- Current prompt/first-frame/output hash verification: 12/12 submitted prompts match, 12/12 submitted first frames match at 1080x1920, and 12/12 submitted raw outputs match.
- Current-run raw decode: 12/12 PASS; each is 1088x1920, 145 frames, 6.041667 seconds; accepted native 1080x1920 count is 0.
- 2026-07-29 Slot 1 formal master: 1080x1920, 240/240 frames, 8 seconds, full decode PASS; Slot 1 formal review count remains 0.
- `npm.cmd test`: 40 files / 199 tests PASS.
- `npm.cmd run typecheck`: PASS.
- `git diff --check -- data/video-repair-queue/queue.json`: PASS.
- Fable headless planning was unavailable because the installed safe launcher blocks unattended startup. The protection was not bypassed.

## Next safe action

Do not spend another submission while `generation_authorized=false` and provider-native 1080x1920 remains unproven. Redesign the action so the conflict is mechanically visible without a close-up finger-detail dependency, approve a newly versioned exact-ratio first frame, then run a fresh sanitized Hermes inspection before exactly one submission of a new generation ID. Bind only a topic-matched unpublished package. Keep `VIDEO_DEFERRED` until that later video actually publishes on both Facebook and Instagram.

Current run time: `2026-08-10T20:44:12.5953642+08:00`.

