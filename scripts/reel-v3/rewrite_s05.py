#!/usr/bin/env python3
"""Rewrite s05 as the second bottle bead it was briefed to be.

The authoring agent quietly changed this shot. Its brief asked for a second
thick foam bead squeezed from the bottle, closer to the cut-outs, with the grime
still packed in the holes underneath. What it wrote instead was the owner holding
"the stiffer cream cylinder brush, taken down off its shaft, its bristle face
already loaded with dense white lather", and the image generated from that is
correct for its own prompt -- a brush laying lather.

Two things are wrong with that:

  * It costs the film one of its two foam-bead beats and gives it a fourth roller
    shot. The reference alternates tool type deliberately; that alternation is
    most of what keeps a one-second cut from feeling repetitive.
  * Those cylinder brushes are mounted on a driven shaft. Taking one down and
    holding it is not something this shop does, so the shot would have been
    inventing equipment use.

This frame is deliberately NOT a re-run of s03. s03 is straight down from 70 cm;
this one is a low shallow angle along the midsole, so the bead is seen in relief
against the light instead of from above, and the two beats do not look like the
same photograph twice.

Usage: rewrite_s05.py <job-dir>
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

STILL = """CAMERA
One locked-off macro photograph, vertical 9:16 frame, on a tripod set low beside the shoe-washing bench. The lens is almost level with the bench top, roughly 4 cm above the perforated stainless drain tray, looking along the length of the shoe at a shallow angle of about ten degrees so the midsole wall is seen almost edge on and everything standing proud of it is read in relief against the light behind. 60 mm macro-equivalent at roughly f/5.6: the foam bead, the nozzle tip and the row of midsole cut-outs are critically sharp; the far end of the bench and the wall tiles behind fall gently soft. The camera is bolted down and stays bolted for the whole shot, one fixed focal length, one fixed focus distance. The frame is composed once and held. This is a different viewpoint from the overhead bead shot earlier in the film, not a repeat of it.

WHAT THIS FRAME MUST PROVE
1. A SECOND THICK WHITE FOAM BEAD is being laid along the midsole, and because the camera is low it stands up off the surface as a raised rope with a rounded crown, catching a soft highlight along its top and throwing a thin shadow down the midsole wall beneath it. About 10-12 mm wide and 6-8 mm tall, dense and matte white with very fine bubbles, glossy where it is still wet.
2. THE BEAD IS CONTINUOUS with the run already laid earlier: it starts where that one ended, near the middle of the foot, and travels forward toward the toe as one unbroken rope. Its leading tip is soft, wet and slightly bulbous.
3. THE ROW OF CUT-OUTS UNDERNEATH IS STILL DIRTY, and this is the point of the shot: clean white foam sitting directly above grey-brown grime packed inside the openings. The bead runs above the holes, bridging cleanly across them, never filling them and never hiding them. Each opening stays legible as an opening with its grime visible inside.
4. THE BEAD IS BEING EXTRUDED AT THIS INSTANT: a short glossy thread of lather connects the bottle's nozzle tip to the leading end of the rope.

PEOPLE AND HANDS
Exactly one person contributes to this frame, the shop owner, and only his hands and forearms enter it. NO face, NO head, no hair, no shoulders, no torso, no second person anywhere in frame, and no human reflection in the steel. Exactly TWO bare hands, both his: broad, thick-fingered, wet, real skin with visible pores, knuckle creases and short clean nails, no watch, no ring, no bracelet. BARE HANDS throughout, never a glove of any colour. Five fingers per hand, no third hand, no extra arm. His left hand steadies the heel of the shoe flat against the tray, fingers low and clear of the midsole wall. His right hand holds the bottle above and slightly behind the bead, squeezing it. Both forearms carry the rolled cuff of a PLAIN LIGHT GREY SHORT-SLEEVE POLO, rolled once above the elbow, clipping the frame edge -- light grey and short on both arms, never black, never long.

SETTING AND LIGHT
The wet room of a small tidy neighbourhood laundry in Taichung. The shoe stands on the perforated stainless drain tray of the shoe-washing bench: round punched holes in a regular grid, brushed steel slightly scratched from use, beaded with water, a shallow film of water sitting in the low spots and draining through. Behind and above, far out of focus, the stainless back panel of the bench, the three horizontal cylinder brushes on their common steel shaft, the blue articulated segmented nozzle with its orange collar, a coiled green hose, a red plastic bucket, a small plastic stool and white square wall tiles. Cool even ceiling light of the wet room, no hard sunlight, soft broad specular highlights sliding along the wet steel and along the crown of the bead. Honest cool-white interior colour, fine sensor grain, no colour grading, no studio lighting, no rim light, no bloom.

OBJECT PASSPORT
Exactly ONE chunky white cushioned running shoe is the subject, and no other footwear appears anywhere in frame.
* Upper: fine white engineered knit, a tight flat-faced weave with faint tonal bands, soft and clearly fabric-like, its individual filaments readable at this distance. It is a textile made of thread.
* Midsole: THICK white moulded foam, roughly four fingers deep at the heel and tapering forward, with a single row of LARGE ROUNDED-RECTANGULAR CUT-OUTS punched right through the side of the midsole and running heel to forefoot -- real openings with visible inner walls and real depth. This row is the shoe's whole visual signature and is fully visible along the whole length of the frame.
* Toe bumper: a DARK GREY moulded rubber cap wrapping the front of the toe, one continuous moulded surface running up to a clean raised arc where it meets the knit, with no stitching across it, smooth and blank.
* Heel: a matching dark grey moulded rubber heel clip, same blank matte rubber.
* Laces: thin flat white laces through plain eyelets, with small dark cylindrical lace anchors.
* Collar: a soft sock-like collar, low and relaxed, no rigid padding.
* Outsole: white rubber, softly scalloped along its edge, rockered so the toe curves gently up.
* THE DIRT, still present in this frame: grey-brown road grime worked INTO the knit weave, heaviest along the toe box and the low panels near the midsole, so the weave still reads clearly through it as staining in the fibre. Grime is packed inside the cut-outs, sitting below each rim so the opening stays legible. The white foam has gone grey-yellow along its lower edge. The shoe is wet through and the knit is darkened where it has taken water.

STAGING
The shoe stands upright on the perforated drain tray, sole down, toe pointing to the RIGHT of frame and heel to the LEFT, its outboard side square to the lens so the whole row of cut-outs runs left to right across the middle of the picture. It is fully settled on the tray under its own weight, flat and stable. Nothing about it is lifted, raised, tipped, propped, balanced, angled or presented toward the camera, and it stays on the tray for the whole shot.
The owner's right hand enters from the upper right holding a plain white squeeze bottle with a fine tapered nozzle: smooth blank plastic, completely unmarked, held at a shallow angle with the nozzle tip about 2 cm above the midsole wall and about a thumb's width behind the leading end of the bead. The bottle stays high over the bench and never comes between the lens and the cut-out row.
The foam bead already runs from the heel end forward to the middle of the foot as one unbroken rope, following the top band of the midsole wall just above the row of openings and parallel to it. Its leading tip sits at the middle of the foot and is advancing toward the toe. Behind the nozzle the rope is settled and still; only the short thread at the tip is in motion.
The left hand rests flat on the tray at the heel end, fingertips on the steel and the heel of the palm steadying the shoe's heel, entirely below the midsole wall and never crossing the row of cut-outs.

RENDERING
Photoreal candid macro capture from a real camera: honest cool-white interior colour, fine sensor grain, believable shallow depth of field, real specular highlights on wet steel and on the wet crown of the bead, correct occlusion and real depth inside each cut-out. Foam renders as dense wet lather with fine bubble structure, never as a painted white shape and never as glowing light. No beauty retouching, no HDR halo, no studio rim light, no colour grading, no CGI gloss, no over-sharpening.

FORBID -- NONE OF THE FOLLOWING MAY APPEAR ANYWHERE IN FRAME
NO lettering anywhere in frame, in any language, at any size, and specifically NO letters, numerals, wordmark, monogram, logo, emblem, swoosh, tick, stripe, side stripe, star, badge, patch, heat-stamp, embossed shape or printed graphic ANYWHERE on the shoe -- not on the toe bumper, not on the heel clip, not on the tongue, not on the collar, not on the midsole, not on the sole, not on the laces, not on the lace anchors, not on any eyelet. The toe bumper and heel clip are BLANK dark grey rubber. This is an advert for a real shop: a real brand's mark must never appear on it, and no shape resembling one may appear either. No brand names or labels on the bottle, on any machine, bucket, bag or on the bench. No burned-in caption, subtitle, title card, watermark, timestamp, date stamp or camera information bar.
The midsole cut-outs must be real openings punched through the foam: no printed or painted hole shapes, no shallow dimples, no embossed outlines, no closed or filled-flat foam where the row should be, and nothing may fill them, cover them or hide them.
The upper must stay engineered knit textile: never leather, never suede, never coated or smooth plastic, never a crazed, cracked, flaking or peeling surface.
Also forbidden: gloves of any colour; a second person, a face, a head or a human reflection in the steel; a third hand or an extra arm; any black or long sleeve; any cylinder brush held in a hand or taken off its shaft; a second shoe, boot, sandal or slipper; any object lifted, raised or presented toward the lens; any camera movement, pan, tilt, push, pull, zoom, orbit or handheld drift; motion blur or streaking that would imply the camera moved; split-screen, before/after panel, divided frame, inset, arrow, circle or annotation."""

MOTION = ("Extruding steadily, the foam bead grows forward along the midsole toward the toe and stops "
          "in a rounded tip, one unbroken rope above the dirty cut-outs; the bottle stays high over "
          "the bench, nothing rising toward the lens. Camera not moving. Sound: a slow bottle squeeze, "
          "wet lather settling. No music, no voices, no dialogue.")

MICRO = ("The bead advances about a hand's width toward the toe and stops, leaving one continuous white "
         "rope running the length of the midsole wall directly above cut-outs that are still packed "
         "with grey-brown grime.")


def main() -> int:
    job = Path(sys.argv[1]).resolve()
    p = job / "prompts" / "revised" / "s05-foam-bead-2.json"
    d = json.loads(io.open(p, encoding="utf-8").read())
    d["still_prompt"] = STILL
    d["motion_prompt"] = MOTION
    d["micro_event"] = MICRO
    d["revision_note"] = (
        "Rewritten by hand on 2026-09-15. The authoring pass had silently turned this shot into a "
        "hand-held cylinder brush laying lather, which cost the film one of its two bottle-bead "
        "beats, gave it a fourth roller shot, and had the owner using a machine-mounted brush as a "
        "hand tool. Restored as the second bottle bead, from a low shallow angle so it is not a "
        "repeat of the overhead bead earlier in the film.")
    io.open(p, "w", encoding="utf-8", newline="\n").write(
        json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print(f"rewrote {p.name}: still {len(STILL)} chars, motion {len(MOTION.split())} words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
