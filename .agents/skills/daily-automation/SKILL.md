---
name: daily-automation
description: Daily Codex Project Automation workflow for the laundry social publishing project.
---

# Daily Automation Skill

## Who does what (read this before generating anything)

Since 2026-07-29 the content for each day is produced AHEAD of time by the
scheduled pipeline (`Laundry-Daily-Generate` 06:30, `Laundry-Reel-Production`
14:00). On a normal morning the calendar, images and the slot 2 Reel for today
ALREADY EXIST and are already reviewed. The morning agent's job is to verify
and fill gaps, never to rebuild.

🔴 **Never publish to any platform, never disable or modify any scheduled
task, and never edit files under `src/` or `scripts/`.** Publishing outside
the 11:30/19:30 windows is refused by the tooling itself; a disabled task is
re-enabled and reported by the 06:30 watchdog; uncommitted edits to
production code are stashed before the day runs. On 2026-08-05 a midnight run
that did all three cost the shop a day and a half of publishing — the guards
exist because of it, and working around them only produces a report to the
owner, not a publish.

🔴 **Never run `npm run generate` with `--force`, and never delete or rewrite
an existing `data/content-calendar/<date>.json`.** A forced regeneration on
2026-07-30 and 07-31 reverted scheduled, reviewed Reels to carousels whose
slides never existed: both days published nothing or lost their Reel. The
generator now preserves reel slots even under force, but force remains
forbidden here — regenerating same-day content is an owner-requested repair
action only.

## Morning Generation
Run for the current Asia/Taipei date:
1. Read `data/video-learning/index.json`, the latest daily learning log, and the newest eligible 72-hour review.
2. Choose at most one creative experiment per slot, and only for content that does not exist yet. Treat every new method as a hypothesis until an eligible 72-hour comparison supports it.
3. If `data/content-calendar/YYYY-MM-DD.json` does not exist: run `npm run generate-context -- --date YYYY-MM-DD` then `npm run generate -- --date YYYY-MM-DD` (no --force). If it exists, do not touch it.
4. Run `npm run validate-publishable-images -- --date YYYY-MM-DD`. If it passes, the day is complete — skip to step 8.
5. Run `npm run generate-image-manifest -- --date YYYY-MM-DD` and generate ONLY the missing images with built-in `image_gen` / gpt-image-2, once per missing manifest item, saving to the exact manifest path.
6. After each saved image, run `npm run mark-image-source -- --date YYYY-MM-DD --slot X --path <manifest target_path> --source gpt-image-2` (the --path is required: carousels need one record per slide).
7. Re-run `npm run validate-publishable-images -- --date YYYY-MM-DD`; the day is not done until it passes.
8. Run `npm run generate-public-site` so `docs/llms.txt`, `docs/social-posts.json`, `docs/latest.json`, `docs/robots.txt`, and `docs/sitemap.xml` include the newest daily package. Site push and IndexNow are handled by the scheduled task; do not push.

## Concept authoring duty (this is how the line keeps running)

When the runway report from `npm run reel-concepts` shows
`needs_new_concepts: true`, author the next batch of six Reel concepts as
DATA in `data/reel-concepts-extension.json` (create it if absent):

```json
{
  "concepts": [
    { "id": "kebab-case-id", "object_type": "one-word-type",
      "hook": "7-20字，具體、講一個物件的一個問題",
      "close": "7字以上，私訊/收送 CTA",
      "narration": "21-36字，接續 hook 往下講，絕不可重述 hook 開頭",
      "before_subject": "one <object>, <honest visible problem>, English",
      "after_subject": "the same <object>, same position, treated, English" }
  ],
  "schedule": [ { "date": "接在現有排程最後一天的隔天", "conceptId": "kebab-case-id" } ]
}
```

Rules the validator enforces (entries that break them are rejected and
logged, never fixed up): unique new ids; hook 7-20 chars; narration 21-36
chars that does NOT begin with the hook's opening; schedule dates strictly
consecutive after the current last date; no two consecutive days sharing an
object_type. Base each new batch on `output/reviews/batch-review-*.json`:
keep what cleared the bar, change ONE variable, and pick object types from
the shop's real service pages. Never edit `src/reelConcepts.ts` — the
extension file is the only place new concepts go, and the pipeline ingests
it automatically.

Video is NOT part of the morning run. The slot 2 Reel is produced by the 14:00
task one batch ahead (see `src/reelConcepts.ts` REEL_SCHEDULE), reviewed under
the owner's standing policy, and scheduled by `npm run schedule-reel`. The
Hermes OAuth route in `C:\Users\cyc39\Documents\Codex\2026-06-30\copx` remains
the only video generation route: never automate grok.com, never fall back to
`XAI_API_KEY`, and never submit a generation the schedule did not ask for.
A failed or missing video must not cancel an otherwise approved image post:
publishing degrades it and records `VIDEO_DEFERRED` in
`data/video-repair-queue/queue.json` by itself.

## Daily Improvement Contract
- Every slot keeps the stable spine: the item or problem is visible in the first second, one observable conflict, one physical action, one payoff, and one direct CTA.
- Reduce synthetic appearance with motivated imperfect lighting, real material microtexture and wear, controlled asymmetry, plausible weight and inertia, contact shadows, restrained camera movement, and continuous anatomy/object geometry.
- Avoid sterile showroom staging, floating objects, fake text or logos, excessive depth blur, glossy plastic skin/fabric, and camera motion without story motivation.
- Add at most one unexpected micro-beat or sensory cue when it supports the product problem. Never invent a result, testimonial, customer, or store process.
- Each daily log must identify the single changed variable, the fixed controls, the expected signal, the 72-hour decision rule, and whether the outcome is `PENDING`, `ADOPT`, `RETEST`, `REJECT`, or `INCONCLUSIVE`.
- Compare eligible posts using views/reach, saves, shares, LINE clicks, inquiries, and bookings. Preserve unavailable metrics as `null`; never claim improvement from generation quality or view counts alone.
- Learn methods, not wording: never copy another creator's script, shot list, prompt, or brand treatment verbatim.

## Shot Design Within Model Limits
Independent testing of this video model class establishes what it holds and what
it breaks. Design each shot inside these limits instead of fighting them; a shot
that asks for the impossible fails on the frame a viewer screenshots.

- Detailed finger work deforms: scrubbing, folding, fastening, flipping a
  collar. Fingers fuse, extra fingers appear, joints bend the wrong way. Keep
  hands out of close-up and never ask for finger detail.
- A person still has to be present. This is a trust business, and an object
  alone on a turntable reads as a cold product demo. Let a forearm, or a tool
  such as a spray bottle, brush or hanger, enter from the edge of frame.
- A stain changing to clean inside one continuous shot is not held: the stain
  drifts or the fabric texture collapses partway through. Show a state, not a
  transformation. Where a before and after is wanted, generate two clips and
  join them.
- One generation carries one continuous take with one slow camera move. More
  than one hard cut inside a generation breaks consistency.
- Joining two clips needs histogram matching and a 0.3 to 0.5 second dissolve.
  Two generations will not agree on colour temperature or shadow direction, and
  an unmatched hard cut reads as two unrelated images. This is the most likely
  thing to fail in a two-clip Reel.
- Both clips of a pair start from the same base still where possible, and both
  prompts pin the same lighting: fluorescent ceiling light mixed with cool
  window daylight from the left, roughly 4500K, same shadow direction and
  exposure.
- Subtitles are mandatory. More than 40% of viewers watch muted, so the hook in
  the first two seconds and the closing line must carry the message with the
  sound off.
- Keep generated audio out of the delivered file. Lay one ambient shop bed at
  roughly -25 to -20 dB underneath. Exporting silent measurably costs watch time.
- Cap Reels at three to four a week on distinct topics. A run of near identical
  generated clips is what triggers repetition downranking.

## Rules
- Daily cadence is exactly 2 slots: 11:30 knowledge and 19:30 situation.
- Do not use local SVG/template fallback images for final publishable assets.
- Do not approve posts, write approved-log entries, write posted-log entries, or publish unless the user explicitly asks.
- The standing daily-video request authorizes subscription-quota generation through xAI's official `xai-oauth` Hermes integration while the publishing policy is active and the manifest remains in scope. This does not authorize separately billed API-key usage.
- Hermes readiness must pass before every generation session. Preserve the request ID, input hash, prompt hash, QC report, output hash, and subscription route marker without printing OAuth credentials.
- Keep `GROK_REELS_ENABLED=false` only when Hermes OAuth readiness fails. Record the exact failure and continue the slot through the explicit image fallback route.
- Never send a missing or invalid video as a Reel. Resolve the actual media type before Meta submission: mixed carousel becomes the validated image carousel; Reel becomes the validated still image. Store `published_media_type`, `video_status: VIDEO_DEFERRED`, `video_defer_kind`, and `video_deferred_reason` in the operational log.
- `video_defer_kind` separates a gate from a fault. `expected` means the video is simply not ready: no path, no file, or a review, freshness or metadata gate that has not passed. `unexpected` means the check itself failed, so the fallback was caused by something to go and fix rather than something to wait for. An `unexpected` entry in the repair queue is a defect report, not a backlog item.
- Approval is recorded per date, slot and platform, and it covers that slot's whole approved media package. A video that defers to its approved images does not need a new approval record, and there is no separate video approval entry to look for; video authorization is enforced by the media review gates in `validatePublishableReel`, not by the approval log.
- The public caption does not expose the internal failure marker. `VIDEO_DEFERRED` belongs only in the operational record and repair queue.
- Read unresolved items from `data/video-repair-queue/queue.json` at the next evening or morning production cycle. Fix the documented cause before spending a new generation, validate the replacement, place it into the next suitable unpublished caption package, then mark it ready with `npm run resolve-video-repair -- --ready --source-date YYYY-MM-DD --source-slot X --replacement-date YYYY-MM-DD --replacement-slot X`. Remove `--ready` only after that replacement is actually published on both platforms.
- A deferred video never changes the historical image-only post into a claimed video post. The replacement is linked to the later post that actually contains it.
- Image fallback is not permission to bypass missing images, content approval, active publishing policy, public HTTPS assets, duplicate prevention, or Meta platform checks. Those remain true publication blockers.
- Daily content must keep `visual_route` on every slot.
- Public AI/SEO feed files in `docs/` are allowed during morning generation; they are not approval or posted logs.

## Standing Authorization
- Read `data/publishing-policy.json` before approval or live posting.
- An active, unexpired policy is the owner's explicit authorization only for the listed dates, platforms, slots, and service facts. Do not require a new daily chat message when today's action is fully inside that scope.
- The policy never bypasses content review, video review, local media validation, approval-log, public HTTPS asset, duplicate, or Meta API gates.
- The review of record for a video is the owner's, recorded by `npm run owner-video-review -- --date YYYY-MM-DD --slot X --watched`. The earlier dual Grok-and-Sol review is retired: it never once produced a record, so every planned video silently fell back to images. Never write a review record on the owner's behalf; an unreviewed video defers to its approved images, which is the designed outcome and not a fault.
- Missing, expired, or out-of-scope policy data must stop the action. Never infer authorization for ads, paid APIs, extra posts, new platforms, service changes, or prior-date backfills.

## Grok CLI Reliability
- Pass the review packet as labeled plain text through one PowerShell variable; do not embed raw JSON or ASCII double quotes.
- Around the native Grok process, do not use `ErrorActionPreference=Stop`. Collect stdout and stderr, save `$LASTEXITCODE` immediately, and restore the prior preference afterward.
- Hook, MCP, and large-session bootstrap warnings are non-fatal when the process exits `0` and every required slot has an explicit verdict.
- If the execution tool returns a running session, poll that same session to completion. Never start a second Grok process while the first is alive.
