---
name: daily-automation
description: Daily Codex Project Automation workflow for the laundry social publishing project.
---

# Daily Automation Skill

## Morning Generation
Run for the current Asia/Taipei date:
1. Read `data/video-learning/index.json`, the latest daily learning log, and the newest eligible 72-hour review.
2. Research 3-5 current, reproducible sources from upstream GitHub repositories, releases, official video/camera documentation, or primary platform guidance. On the first run use a 30-day baseline; later runs only collect changes since `last_checked_at`.
3. Deduplicate by canonical repository, file, revision, or release. Save the canonical URL, revision/date, license, exact reusable method, evidence tier, limitation, and adopt/test/reject decision in `data/video-learning/YYYY-MM-DD.json`; then update `data/video-learning/index.json`.
4. Choose exactly one main creative experiment per slot. Treat every new method as a hypothesis until an eligible 72-hour comparison supports it.
5. Use `laundry-content`.
6. Run `npm run generate-context -- --date YYYY-MM-DD`.
7. Run `npm run generate -- --date YYYY-MM-DD`.
8. Use `laundry-image`.
9. Run `npm run generate-image-manifest -- --date YYYY-MM-DD`.
10. Use built-in `image_gen` / gpt-image-2 exactly once per manifest item.
11. Save final images into `docs/assets/YYYY-MM-DD/slot-XX.png`.
12. After each saved image, run `npm run mark-image-source -- --date YYYY-MM-DD --slot X --source gpt-image-2`.
13. Run `npm run generate-video-manifest -- --date YYYY-MM-DD`.
14. If the manifest contains video slots, use the official xAI-supported Hermes OAuth subscription route in `C:\Users\cyc39\Documents\Codex\2026-06-30\copx`. Run its sanitized Hermes readiness check, require `xai_oauth_logged_in=true` and `video_gen_enabled=true`, then submit each reviewed shot exactly once through `generate-shot.ps1 -ConfirmPaidRun`.
    Never automate grok.com. Never fall back from Hermes OAuth to `XAI_API_KEY`. Use the separately billed xAI API route only when the owner explicitly requests that different billing route.
15. Run technical, normal-speed, continuity, physics, claim, caption, and audio review. A contact sheet is only triage evidence.
16. Validate each planned video independently. A validated MP4 keeps the planned video delivery. A failed or missing video must not cancel an otherwise approved image post: publish the validated image or four-image carousel, mark the operational record `VIDEO_DEFERRED`, and add the exact failure to `data/video-repair-queue/queue.json`.
17. Run `npm run generate-public-site` so `docs/llms.txt`, `docs/social-posts.json`, `docs/latest.json`, `docs/robots.txt`, and `docs/sitemap.xml` include the newest daily package.

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
- The policy never bypasses content review, Grok judgment, Sol review, local media validation, approval-log, public HTTPS asset, duplicate, or Meta API gates.
- Missing, expired, or out-of-scope policy data must stop the action. Never infer authorization for ads, paid APIs, extra posts, new platforms, service changes, or prior-date backfills.

## Grok CLI Reliability
- Pass the review packet as labeled plain text through one PowerShell variable; do not embed raw JSON or ASCII double quotes.
- Around the native Grok process, do not use `ErrorActionPreference=Stop`. Collect stdout and stderr, save `$LASTEXITCODE` immediately, and restore the prior preference afterward.
- Hook, MCP, and large-session bootstrap warnings are non-fatal when the process exits `0` and every required slot has an explicit verdict.
- If the execution tool returns a running session, poll that same session to completion. Never start a second Grok process while the first is alive.
