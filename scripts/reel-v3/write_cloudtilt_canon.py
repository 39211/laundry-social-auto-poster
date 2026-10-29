#!/usr/bin/env python3
"""Write the On Cloudtilt object-canon prompts, dirty then clean.

This is the file that fixes the drift. Four cuts in a row the shoe changed
between shots -- the dark toe rubber vanished in two of them, the midsole
opening count and shape varied, and one shot produced a different object
entirely. The cause was that the anchor was a studio photograph plus a
description in generic terms, while the generation instruction simultaneously
told the model not to copy the camera, distance or orientation. "A chunky white
runner with a row of rounded cut-outs" can be satisfied a hundred ways.

The owner's diagnosis was right: a model name is an anchor and a paraphrase is
not. On Cloudtilt is one object the image model has seen thousands of pictures
of; "chunky white knit runner" is a category. So the model is named, and every
countable feature below comes from the 60-beat decode's CONTINUITY ANCHORS.

The single most important line is the toe rubber. It is part of the shoe, not
dirt, and the last cut washed it off in two shots because nothing said otherwise.

Usage: write_cloudtilt_canon.py <job-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

# Every number here is from the decode's CONTINUITY ANCHORS. They are production
# lock values for a 28 cm reconstruction, not manufacturer specifications.
IDENTITY = """OBJECT IDENTITY -- ON CLOUDTILT, AND EVERY NUMBER HERE IS FIXED
This is an On Cloudtilt. Not a generic trainer, not another On model, not a
blend of models. Reconstruct it at 28 cm length and about 10 cm maximum forefoot
width, and hold that proportion.

UPPER: fine pale-grey engineered mesh with a visible woven grain, readable as
textile at macro distance. It darkens when wet. It is never white leather, never
suede, never a smooth coated skin, never a crazed or cracked surface.

THE MIDSOLE OPENINGS -- the shoe's signature, and the thing that must never drift:
NINE CloudTec Phase openings punched through the LATERAL midsole wall and NINE
through the MEDIAL wall. They are rounded oblique slots and flattened ovals, not
equal circles and not equal capsules. Counting heel to toe on the lateral side,
their long axes tilt approximately +15, +25, +45, +20, +20, 0, -30, -30 and -15
degrees from horizontal with the shoe level and the toe to the right. The third
opening back from the heel is the tall teardrop and is the landmark for the row.
Centre-to-centre spacing runs about 2.4, 2.5, 2.6, 2.7, 2.7, 2.6, 2.5 and 2.3 cm
-- deliberately unequal. A given camera angle may hide some of the nine; that
changes how many are VISIBLE, never how many EXIST.

TOE RUBBER -- READ THIS TWICE: a small CHARCOAL / DARK GREY rubber tip wraps the
very front of the toe, about 3.5 cm wide and 2 cm high, turning up over the toe.
IT IS PART OF THE SHOE. IT IS NOT DIRT. It stays exactly the same colour, size
and shape when the shoe is clean. Around it the forefoot stays pale mesh and
ivory midsole -- the dark rubber never spreads into a large black toe cap over
the whole forefoot.

HEEL: a pale grey / off-white reinforced heel wrap across roughly the rear 7 cm.
No large protruding black plastic heel cage.

LACING: grey elastic speed-laces, threaded and fastened for the entire film.
There is no unlacing, no re-lacing, no bow. TWO small pale upper lace anchors per
shoe, one each side -- not one large central cylindrical dial. TWO dark lower
keepers at the front, which are hardware and not dirt, and which survive cleaning.

COLLAR: a padded grey sock-like collar, one normal opening per shoe. It deforms
under a hand and returns to shape.

MARKINGS: one grey On marking on each side of the shoe, each keeping its own
fixed position and orientation on the quarter. Foam may cover one; it is never
erased, moved or mirrored. A small red tab sits on the LATERAL rear only and is
never duplicated onto the medial side.

SOLE: dark grey outsole rubber with its original tread zoning and fine wear.
Rockered: the toe lifts about 2 cm across the front 7 cm, the heel about 0.5 cm
across the rear 3 cm. The rocker is still there when the shoe is picked up -- it
does not flatten onto the bench."""

DIRTY_STATE = """STATE: DIRTY, AS RECEIVED. Grey-brown road grime is worked INTO the
mesh weave -- heaviest across the toe box, the outer forefoot and the low panels
near the midsole, thinner and blotchier toward the collar -- so the weave still
reads through it as staining in the fibre, never as an opaque painted crust. Grime
is packed inside the midsole openings, sitting below each rim so every opening
stays legible as an opening. The ivory midsole has gone grey-yellow along its
lower edge. The grey speed-laces are dulled and darkest near the lower keepers.
The charcoal toe rubber carries a dusty film -- it is dirty, but it is still
charcoal rubber, and it was charcoal before it got dirty."""

CLEAN_STATE = """STATE: THE SAME PAIR, WASHED. The mesh is a clean even pale grey
with its weave open and legible. The ivory midsole is one even tone along its
whole lower edge. The openings are pale and clear inside. The grey laces are
clean. THE CHARCOAL TOE RUBBER IS STILL CHARCOAL -- it was never dirt, so washing
does not lighten it, shrink it or remove it; same 3.5 by 2 cm, same colour as in
the dirty frame. The two dark lower keepers are still dark. The grey On markings
and the lateral red tab are still there. Permanent wear survives: the same fine
scuffs on the toe rubber, the same tread wear, the same softly rounded outer heel
edge. This is the SAME used pair cleaned -- not a new shoe, not a restored-to-
factory shoe, not a different model."""

CAMERA = """CAMERA
One locked-off studio photograph, vertical 9:16, 1080x1920. A 90mm-equivalent
product lens on a bolted tripod, optical axis dead level and square to the
subject, lens centre at the height of the top of the midsole foam. Working
distance about 1.9 m. The pair is turned just off full profile toward camera-left
so the OUTER face of the near shoe presents to the lens and the whole row of nine
lateral openings runs across the frame. Aperture behaves like f/9: everything
from the near toe rubber to the far heel is critically sharp, including every
opening and the individual mesh filaments. The camera does not move."""

SETTING = """SETTING AND LIGHT
A plain mid-grey seamless paper sweep, neutral, about 45 percent reflectance,
filling the frame with no visible seam, corner, edge, stand or clamp. One large
softbox high on the CAMERA-LEFT side, feathered, giving a soft directional key
that wraps the near shoe and defines each midsole opening by the shadow inside
it. A weak white bounce on camera-right opens the shadow side. ONE soft contact
shadow pools under the pair and falls slightly to camera-right, fading within
about one shoe-length. Neutral white balance near 5200K. No coloured gel, no rim
light, no colour grading, no vignette, no glow."""

STAGING = """STAGING
Exactly TWO shoes, a left and a right of the SAME pair -- not one shoe duplicated
and mirrored, which would put the On marking and the red tab on the wrong sides.
The right shoe stands square on its own outsole, flat on the sweep, its outer face
to the lens. The left shoe stands beside and slightly in front, heel planted, its
body leaning against the right shoe so it is plainly supported and plainly subject
to gravity. Both rest under their own weight; nothing props, hangs or floats them.
Nothing is lifted, angled or presented toward the camera. The pair sits across the
lower-middle of the tall frame with clean empty grey above. Nothing else is in the
picture."""

RENDER = """RENDERING
Photorealistic still photography from a real camera in a small product studio:
true material response, correct soft-shadow physics, believable contact shadow,
natural micro-contrast. Mesh renders as textile with fibre detail. Midsole foam
renders matte and slightly open-celled, each opening showing real wall thickness
and interior shadow so it reads as a hole right through. Rubber renders semi-matte.
Dirt, where present, renders as translucent staining that lets the material texture
show through. No CGI or 3D-render look, no plastic smoothing, no HDR halo, no
bloom, no beauty retouching that whitens or brightens the shoes."""

FORBID = """FORBID -- NONE OF THE FOLLOWING ANYWHERE IN FRAME
No burned-in caption, subtitle, title card, watermark, logo bug, timestamp, date
stamp, frame number, colour chart, ruler or scale card. No split-screen, no
before/after panel, no divided frame, no inset, no arrow, no circle, no annotation.
No people, no hands, no sleeves, no human shadow, no reflected face, no mannequin,
no feet inside the shoes. No second pair, no spare single shoe, no other footwear
of any kind. No wet-room hardware: no stainless bench, no perforated tray, no
cylinder brushes, no nozzle, no hose, no bucket, no stool, no wall tiles, no steam
wand, no towel, no bottle, no brush, no cloth. No water, droplets, lather, suds,
puddle or damp sheen. No shoe box, tissue, tag, price sticker, dust bag, stand,
riser or acrylic block. No change of material: never leather, never suede, never
smooth plastic, never a crazed, cracked or peeling surface. The midsole openings
must be real holes punched through the foam -- never printed or painted hole
shapes, never shallow dimples, never embossed outlines, never closed foam where
the row should be. No flat painted white fill, no paper-white, no glossy plastic
sheen. No camera movement, no motion blur, no perspective distortion, no fisheye."""


# The clean plate must NOT restate the camera, the light or the staging. It is an
# edit of the dirty plate, and the generator's own rule is that when the text and
# the attached photograph disagree, the photograph wins -- so any geometry written
# here that the attachment does not happen to match is not an instruction, it is a
# coin-flip. The dirty plate came back as a three-quarter product angle rather than
# the dead-level profile the text asked for; leaving that text in the clean prompt
# would be asking the model to both match the attachment and contradict it.
CAMERA_SAME = """CAMERA, LIGHT AND STAGING -- TAKEN ENTIRELY FROM THE ATTACHED FRAME
Do not compose this picture. It is already composed: the attached photograph is
this exact shot, and every geometric and lighting decision is already made in it.
Camera position, height, angle, lens, distance, crop, aspect ratio, where each
shoe stands, which way each shoe faces, how much of the frame each fills, the
backdrop, the key direction, the shadow, the exposure and the white balance all
come from the attachment unchanged."""


def build(state: str, proves: str, registration: str = "") -> str:
    """Dirty gets the full studio spec; clean inherits geometry from the attachment."""
    if registration:
        return "\n\n".join([CAMERA_SAME, registration, proves, IDENTITY, state,
                            RENDER, FORBID])
    return "\n\n".join([
        CAMERA, proves, "PEOPLE AND HANDS\nNobody. Zero people, zero "
        "hands, no forearm, no sleeve, no human shadow, no reflection of a person.",
        SETTING, IDENTITY, state, STAGING, RENDER, FORBID])


DIRTY_PROVES = """WHAT THIS FRAME MUST PROVE
1. This is an On Cloudtilt, identifiable as that model: the nine lateral CloudTec
   openings in their stated tilt sequence, the tall third-from-heel teardrop, the
   charcoal toe rubber, the pale heel wrap, the grey speed-laces with two pale
   upper anchors and two dark lower keepers, the padded grey sock collar.
2. It is DIRTY as received, and the dirt is soil on a real textile, not a costume.
3. It is a calm product photograph on a seamless sweep -- a "before" plate, not a
   scene in the shop. Its geometry must be reproducible, because the matching
   clean plate is made from this exact frame."""

CLEAN_PROVES = """WHAT THIS FRAME MUST PROVE
1. SAME PAIR OF ON CLOUDTILTS, WASHED -- not a new shoe. The nine lateral
   openings are still nine, in the same tilt sequence; the permanent wear
   survives; the charcoal toe rubber is unchanged.
2. Clean throughout, right down to the lowest edge of the midsole, with every
   opening pale and clear inside.
3. It reads clean because the SURFACES are clean, not because the exposure is
   higher. Same exposure and white balance as the dirty plate."""

REGISTRATION = """REGISTRATION -- CARRIED BY THE ATTACHED FRAME
The attached image is the DIRTY plate of this SAME pair. Make this photograph FROM
it, as an edit of it: same camera position, same height, same lens, same distance,
same pose of both shoes, same backdrop, same light direction and softness, same
shadow, same size in frame, same exposure. If the two frames were laid one on top
of the other, every silhouette edge would land in the same place. The ONLY
difference permitted anywhere is that the shoes are clean."""


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    out = job / "prompts"
    out.mkdir(parents=True, exist_ok=True)
    shots = [
        {"id": "canon-dirty", "still_prompt": build(DIRTY_STATE, DIRTY_PROVES),
         "motion_prompt": ""},
        {"id": "canon-clean", "still_prompt": build(CLEAN_STATE, CLEAN_PROVES, REGISTRATION),
         "motion_prompt": ""},
    ]
    io.open(out / "canon.json", "w", encoding="utf-8", newline="\n").write(
        json.dumps(shots, ensure_ascii=False, indent=2) + "\n")
    for s in shots:
        n = s["still_prompt"]
        print(f"  {s['id']:14} {len(n):6,} chars   "
              f"'On Cloudtilt' x{n.count('On Cloudtilt')}   "
              f"nine openings: {'yes' if 'NINE' in n else 'NO'}   "
              f"toe-rubber-is-not-dirt: {'yes' if 'NOT DIRT' in n or 'never dirt' in n else 'NO'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
