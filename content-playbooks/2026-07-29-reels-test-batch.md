# Task: Reels test batch, three concepts

## Why this exists

The account reaches strangers but almost nobody responds: over 28 days, 743
accounts reached, 478 of them non-followers, and only 13 accounts engaged at
all. Reels are the only format that reliably reaches beyond existing followers.

This is a **test batch, not a new standing routine.** Three Reels, reviewed by
the owner before anything is published. The point is to find out whether a
generated Reel can hold attention at all for this shop, before any of it is
automated.

Do not extend this into daily Reel production. Do not change the existing
06:30 / 10:20 / 11:30 / 19:30 pipeline. Do not modify the already approved
content for 2026-07-28 or 2026-07-29.

## Hard stops

- Do not approve anything. Do not write `data/approved-log/`.
- Do not publish anything. Do not write `data/posted-log/`. Do not call Meta.
- Do not add these to `data/content-calendar/`. They are candidates for the
  owner to review, and get scheduled later only if the owner says so.
- If a step cannot be completed, stop and report it. Do not substitute a
  placeholder image, a stock clip, or a still in place of a video.
- Do not download images or video from the web. Reposted material is excluded
  from recommendations, and product photography belongs to whoever shot it.

## What the video model can and cannot do

Independent testing of this class of image-to-video model reports the following.
Design every shot inside these limits rather than fighting them.

**Fails reliably, do not attempt:**
- Detailed finger work: scrubbing, folding, fastening buttons, flipping a
  collar. Fingers deform, extra fingers appear, joints twist.
- A stain changing to clean inside one continuous shot. The stain drifts, or
  the fabric texture collapses partway through.
- Precise liquid physics: running water, spreading foam, spray particles.
- More than one hard cut inside a single generation.
- Close-ups where text or a care label must stay legible.

**Works:**
- One object, held, with one slow camera push-in and slight handheld shake.
- A forearm or a tool — spray bottle, brush, hanger — entering from the edge of
  frame. This implies a person is working without asking the model to draw a
  hand in close-up, which matters because a laundry is a trust business and a
  pure object turntable reads as a cold product demo.
- Eight to ten seconds, one continuous take, from a starting still.

**Therefore:** each Reel is built from two separately generated clips, cut
together in post. Never ask one generation to show the change itself.

## Step 1: generate six stills

Save as PNG, 1080x1350, into `data/reference-photos/<type>/`. Create the
directories. These stills are reusable: later Reels on the same subject should
start from these rather than generating new ones, because two clips of the same
shop have to look like the same shop.

**Consistency requirement.** Within each pair the two images must read as the
same camera in the same session. Same lighting direction, same colour
temperature, same counter surface, same background, same framing distance. Only
the state of the subject changes. Generate each pair back to back.

Apply this to all six prompts:

> Shot on a phone by shop staff inside an ordinary Taiwanese laundry shop,
> handheld with slight natural camera shake and imperfect framing, tiled floor
> and metal racks visible, soft fluorescent ceiling light mixed with cool window
> daylight from the left at roughly 4500K, consistent shadow direction, realistic
> material texture with genuine wear, everyday clutter at the edge of frame. Not
> cinematic, not studio lighting, not glossy, not perfectly symmetrical, no
> stock-photo feel, no dramatic colour grade. No brand name, no logo, no readable
> text, no watermark, no faces.

| Path | Subject |
|---|---|
| `shirt/reel-stain-before.png` | One white shirt laid flat on the inspection counter, a clear coffee stain across the chest, collar slightly yellowed. |
| `shirt/reel-stain-after.png` | The same shirt, same position, same counter, stain gone. Clean but not brand new: same wrinkles, same shot. |
| `bedding/reel-pile-before.png` | A large heap of mixed everyday clothes piled untidily on a home sofa, ordinary Taiwanese living room, late afternoon. |
| `bedding/reel-pile-after.png` | The same clothes washed and folded into neat stacks, same sofa, same room, same light. |
| `knitwear/reel-sorting-wrong.png` | One laundry basket with dark and light clothes mixed together, on the shop floor. |
| `knitwear/reel-sorting-right.png` | Two baskets side by side in the same spot and light, darks in one and lights in the other. |

## Step 2: generate six clips

Use the existing Grok video route already in this project. Do not introduce a
new provider, and do not enable paid API generation: `paid_xai_api_authorized`
is `false` in `data/publishing-policy.json`. If the authorised route is
unavailable, stop and report it rather than switching routes.

One clip per still, image-to-video, 9:16, four to five seconds each.

Motion prompt, applied to every clip with the subject swapped in:

> Vertical 9:16, image-to-video from this still. One continuous take of four to
> five seconds. Hold on the subject with one slow gentle push-in and slight
> natural handheld shake. Identical lighting to the source still: soft
> fluorescent ceiling light mixed with cool window daylight from the left,
> roughly 4500K, same shadow direction, same exposure, same grain, same
> background blur. A forearm or a tool such as a spray bottle, brush or hanger
> may enter from the edge of frame, but keep hands out of close-up and never
> show finger detail. Near-silent, faint room tone only. No scrubbing, no
> folding, no stain changing within the shot, no second setup, no cut, no
> cinematic look, no studio lighting, no gimbal or drone move, no colour grade,
> no on-screen text, no logo, no watermark.

## Step 3: assemble three Reels

Each Reel is before-clip then after-clip, about ten seconds total.

**Colour match is mandatory.** Two separate generations will not agree on colour
temperature or shadow direction, and a hard cut between them reads as two
unrelated images. Run histogram matching between the two clips before joining,
and use a 0.3 to 0.5 second dissolve, not a hard cut. Without this the join
fails visibly most of the time — it is the single most likely thing to go wrong
in this task.

**Subtitles are mandatory,** because more than 40% of viewers watch muted. The
hook in the first two seconds and the closing line must carry the whole message
without sound. Large, high contrast, safely inside frame.

| Reel | Hook, 0–2s | Closing line | Caption CTA |
|---|---|---|---|
| Stain | 這件衣服真的還能救嗎? | 台中有這種污漬,直接私訊我們 | 私訊給我們看看,我們先幫你判斷 |
| Pile | 忙到連洗衣服的時間都沒有? | 台中市區收送,忙的人真的可以用 | 私訊「忙」,我們告訴你怎麼安排 |
| Sorting | 很多人衣服越洗越糟的原因 | 下次記得這樣分,或直接交給我們 | 你遇過最難洗的是哪一件? |

Audio: keep the generated track near-silent, then lay one ambient laundry-shop
bed underneath at roughly -25 to -20 dB. Silence measurably costs watch time, so
do not export silent. No music-led mix, no model-generated speech.

## Step 4: report back

Save the three MP4s under `output/reels-test/2026-07-29/` and write a short
report next to them covering:

- Which of the six stills came out usable, and which needed regenerating.
- Whether any pair failed the consistency requirement, and what you did.
- Whether colour matching was applied, and how the join looks.
- Anything the model refused or produced badly, stated plainly.

Then stop and wait for the owner to review. The owner decides whether any of
these three get scheduled.

## Acceptance criteria

- Three MP4s exist, 9:16, roughly ten seconds, each visibly two shots joined.
- No finger detail anywhere in any clip.
- No clip attempts to show a stain changing to clean.
- Subtitles readable with sound off, hook visible within the first two seconds.
- Nothing was approved, published, or added to the content calendar.

## Afterwards

If the owner approves publishing, per-Reel thresholds and the day 30 and day 60
decision rules are in `docs/reels-roadmap.md`. Three consecutive Reels with a
7-day watch ratio below 20% stops this format.
