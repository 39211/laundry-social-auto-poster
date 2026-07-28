---
name: sixiangjia-video-evidence
description: Research, write, direct, generate, validate, edit, publish-gate, and backtest customer-facing Sixiangjia laundry promotional videos. Use for screenplays and dramaturgy, director treatments, shooting scripts and storyboards, Grok Video manifests, first-frame realism, laundry or shoe/bag care claims, frame QA, Meta/IG creative, evidence collection, agent knowledge packs, and campaign evaluation.
---

# 私享家影片證據與驗證

## Start with evidence

1. Read the current knowledge-pack manifest and only the relevant references.
2. Record `knowledge_pack_version`, cutoff date, source IDs, role, and forbidden claims in every substantial review.
3. Never claim an agent “learned” a source count unless the accepted, deduplicated evidence registry proves it.
4. Keep Sol as the primary executor. Use Grok only for explicitly authorized video generation. Never operate Grok or ChatGPT Pro consumer browsers for search or review.

Read:

- `references/source-policy.md` for collection, tiers, deduplication, and the 2500-unit target.
- `references/evidence-schema.md` before adding evidence.
- `references/validation-rubric.md` before accepting screenplays, shooting scripts, frames, clips, masters, or campaign results.

## Workflow

### 1. Research

- Search official and primary sources first; use GitHub only when the repository is reproducible.
- Treat X, forums, and creator posts as hypotheses until corroborated.
- Preserve publication/retrieval dates, model/platform versions, limitations, and conflicts.
- Do not convert general internet cleaning advice into a private-store SOP without material evidence and store confirmation.

### 2. Screenplay before production

- Write the screenplay first: protagonist, situation, desire, obstacle, conflict, emotional turn, decisive action, resolution, and brand action.
- Lock one audience problem, one value promise, one CTA, and one primary metric per film without replacing drama with a marketing checklist.
- Only after the screenplay works, derive the scene breakdown, director treatment, shooting script, storyboard, voiceover/dialogue, and shot table.
- Generate final TTS at normal speed, measure it, then derive runtime. Do not let runtime design the story.
- Build a Production Bible, exact start/end states, continuity anchors, evidence claims, and failure rules.
- A customer ad must answer: “Why should I care?”, “Why trust this?”, and “What do I do next?”

### 3. Generation

- Prefer real store, customer-consented, object, and craft evidence. Label synthetic shots as concepts.
- Approve the exact-ratio first frame before any video generation.
- Use one observable action per raw clip. Six seconds is an internal reliability unit, not an xAI universal minimum.
- Preserve raw media, manifest, prompt hash, input hash, request ID, model, timestamps, and output hash.
- xAI officially supports using a Grok subscription inside Hermes Agent, including Grok Imagine video. The approved subscription route is `provider=xai-oauth` through the local copx job engine; it must never automate grok.com and must never fall back to `XAI_API_KEY`.
- Before using the subscription route, require the sanitized Hermes readiness report to show OAuth logged in, `video_gen` enabled, and dependencies ready. Submit each generation ID once, preserve the job record, and reconcile the same request instead of creating duplicates.

### 4. Validation

- Run technical validation, full decode, full-frame PTS ledger, normal-speed human review, continuity review, factual/physics review, and claim/provenance review.
- Reject a creative failure; never hide it with a crop and call the raw clip passed.
- Require real evidence for cleaning results, brand locations, customers, testimonials, and before/after claims.
- A contact sheet is triage evidence, not full-frame proof.

### 5. Edit and publish gate

- Save a reproducible timeline/EDL or FFmpeg command, audio settings, subtitle source, safe-zone proof, and final hashes.
- Use official Logo and verified contact CTA. Never generate brand text in video pixels.
- Retain provenance and required AI disclosure. “Less AI-looking” never means claiming synthetic media is human-shot.
- Publishing requires explicit approval and platform checks; technical PASS is not publication approval.

### 6. Backtest and improve

- Convert reviewed failures and real campaign outcomes into versioned eval fixtures.
- Use event time and ingest time; freeze the knowledge cutoff before every historical prediction.
- Walk forward through time and retain a final holdout. Do not tune on future outcomes.
- Change one main creative variable per experiment. If power or sample size is inadequate, report `INCONCLUSIVE`.
- Measure effective inquiries and cost per effective inquiry, not views alone.

### 7. Daily learning and anti-AI iteration

- Before writing each day's scripts, read `data/video-learning/index.json`, the most recent learning log, and the latest eligible 72-hour review.
- Collect 3-5 reproducible methods from upstream GitHub repositories, releases, official video/camera documentation, or primary platform guidance. Record canonical URL, revision/date, license, evidence tier, exact method, limitation, and adoption decision.
- Deduplicate by repository, file, revision, and method. A star count, social post, or generated summary is discovery evidence, not proof of effectiveness.
- Never copy another creator's script, prompt, storyboard, or brand treatment verbatim. Translate only the production method into an original Sixiangjia experiment.
- Change exactly one main creative variable per slot and keep the other controls stable. New ideas remain `hypothesis_ready` until an eligible 72-hour comparison supports adoption.
- Use this realism rubric: motivated imperfect lighting; material microtexture and wear; controlled asymmetry; plausible weight, inertia, grip, and contact shadows; restrained lens and camera movement; anatomy and object continuity; no synthetic text or logos.
- Use this script rubric: show the item/problem within the first second; create one observable conflict; perform one action; reveal one payoff; state one direct CTA. An optional micro-beat or sensory cue must support the problem and may not invent a service result.
- Save the dated record to `data/video-learning/YYYY-MM-DD.json` and update `data/video-learning/index.json`.
- Evaluate eligible work after 72 hours with views/reach, saves, shares, LINE clicks, inquiries, and bookings. Missing values remain `null`; weak sample sizes remain `INCONCLUSIVE`.

## Agent qualification

Before an agent may review a domain, bind it to the current knowledge pack and require:

- 20 blind source/version/safety questions;
- 5 production scenarios;
- 5 adversarial cases;
- 100% traceable citations and safety items, at least 90% overall, and zero invented sources.

An unqualified agent may collect candidates but may not approve professional claims or release gates.

Before professional script approval, first-frame approval, shot-plan approval, or release approval, run:

`python .agents/skills/sixiangjia-video-evidence/scripts/validate_preproduction_contract.py --repo-root . --json`

Any nonzero exit, knowledge-pack mismatch, missing active artifact, duplicate accountable owner, or missing fail-closed marker blocks professional approval and release. This contract validates governance only; it does not qualify evidence, approve a screenplay, or decide whether the owner may spend subscription quota on a clearly labeled synthetic test.

For the standing daily companion-video lane, a date-scoped candidate manifest, a Sol-reviewed exact-ratio first frame, an active owner policy, a passing Hermes OAuth readiness report, and the absence of cleaning-result, testimonial, customer, real-store-process, or effectiveness claims authorize one subscription generation per unique `generation_id`. The result remains synthetic, unpublished, and outside KPI until clip QA, separate TTS, owner review, and publishing approval pass.
