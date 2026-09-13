#!/usr/bin/env python3
"""The eight still prompts for the two-person shoe film, plus the gates.

Written down rather than typed into the browser so that a still which comes
back wrong can be diffed against the words that produced it. Every clause here
was earned:

  * The OBJECT block repeats the canvas weave in every prompt. The weave is what
    stops the model reading the silhouette as a leather sneaker, which on
    2026-09-12 is how a swoosh appeared on a shoe nobody asked to brand.
  * Faces carry "mouth closed". The voice-over is added afterwards and the image
    model cannot hear it, so an open mouth is a lip-sync failure by construction.
  * Two-person shots name whose hands are where, and how many hands the frame is
    allowed to contain. Four hands in one frame is the worst case for hand
    distortion, so each of those shots is one clear action.
  * The negative block forbids lettering everywhere except the three embroidered
    characters on the apron, which are the one piece of text the owner wants.

Usage:
  two_person_still_prompts.py list
  two_person_still_prompts.py show t01-customer-arrives
  two_person_still_prompts.py refs t01-customer-arrives
"""
from __future__ import annotations

import sys

REPO = "C:/Users/cyc39/laundry-repo"
SHEET_OWNER = REPO + "/data/persona/master-owner/anchor/master-sheet-approved-20260912F.png"
SHEET_CUSTOMER = REPO + "/data/persona/customer-canvas-shoes/anchor/customer-sheet-v1.png"
CANON_COUNTER = REPO + "/output/reel-shoe-wash-20260912/s01-intake.png"
CANON_WETROOM = REPO + "/output/reel-shoe-wash-20260912/wetroom-bench-02.png"
CANON_PACK = REPO + "/output/reel-shoe-wash-20260912/s08-pack.png"

OBJECT = (
    "THE SHOES: one pair of plain cream cotton-canvas low-top plimsolls, exactly the pair in the "
    "attached canon photo. Visible cotton canvas weave across the whole upper, a cream rubber "
    "foxing band running right round above the sole, a rubber toe cap, flat cotton laces through "
    "plain metal eyelets, and completely blank side panels and blank tongue. Where they are dirty "
    "the dirt is grey-brown camping soil sitting IN the weave and in the seam above the foxing "
    "band, and the weave still reads through it -- never an opaque crust, and never a leather or "
    "synthetic sneaker."
)

NEG_COMMON = (
    "NOT ALLOWED: no logo, emblem, swoosh, side stripe, badge, printed graphic, watermark, camera "
    "information bar or readable lettering of any kind anywhere in frame, and nothing at all "
    "printed or stitched on the shoes. No brand name on any bottle, machine or bag. No text burned "
    "into the picture. No extra hands, no extra people, no mirror and no reflected face. Natural "
    "skin texture with visible pores, no airbrushed plastic skin, no beauty retouching."
)

APRON = (
    "His apron is plain dark navy and carries the shop name embroidered on the chest panel: "
    "exactly the three Traditional Chinese characters \u79c1\u4eab\u5bb6, in that order, correctly "
    "and cleanly formed, upright sans-serif, off-white thread, centred, about one sixth of the "
    "apron's width. If those three characters cannot be formed correctly, leave the apron "
    "completely plain instead of rendering them wrongly. Nothing else is on the apron."
)

OWNER_ID = (
    "IDENTITY -- the man in the attached character sheet, and nobody else. Keep his real "
    "proportions: a Taiwanese man in his early thirties, heavy-set and solidly built, a wide round "
    "face clearly wider than it is long and widest low at the full soft cheeks, a soft undefined "
    "jawline, a thick short neck, a broad thick torso and thick soft-strong arms. Do NOT slim his "
    "face, do NOT carve a jawline, do NOT give him gym muscle. Narrow hooded dark brown eyes, low "
    "set dark brows, a short broad nose with a low flat bridge, very short jet-black hair faded at "
    "the sides, clean-shaven cheeks, a sparse moustache past both corners of the mouth and a neat "
    "chin beard two to three centimetres below the chin. He wears a plain light grey short-sleeve "
    "polo with the sleeves rolled once above the elbow under a dark navy bib apron."
)

CUSTOMER_ID = (
    "IDENTITY -- the man in the attached customer character sheet, and nobody else. A Taiwanese "
    "man in his late twenties, slim to average build. An oval face of ordinary width with a "
    "slightly pointed chin and light hollows under the cheekbones -- clearly narrower and bonier "
    "in the face than a heavy-set man. Dark brown eyes of ordinary size with a clear double eyelid "
    "on both sides, straight dark brows, a straight nose with a defined bridge. Clean-shaven, no "
    "beard and no moustache. Soft black hair of medium length parted loosely on his left and "
    "falling over the forehead, not short and not faded at the sides. He wears a plain "
    "heather-grey crew-neck t-shirt under a plain dark charcoal zip-up hoodie worn open, sleeves "
    "pushed to mid-forearm, and plain dark jeans. No hat, glasses, watch, ring or necklace."
)

SHOP_COUNTER = (
    "SET -- the service counter of a small tidy neighbourhood laundry shop in Taichung, exactly as "
    "in the attached canon photo: a cream counter top with a rose-pink cutting mat laid on it, "
    "white slat-wall and open shelves of plain unlabelled white and pale blue detergent bottles "
    "behind, the glass shop frontage and a daylit street at the left edge. Broad soft daylight "
    "from the left, warm interior light behind."
)

WETROOM = (
    "SET -- the shop's wet room, exactly as in the attached canon photo: a stainless-steel "
    "shoe-washing bench with a perforated stainless drain tray, a row of horizontal rotating "
    "cylinder brushes on a stainless housing behind it with coloured push-buttons above them, an "
    "articulated blue segmented water nozzle, white square wall tiles, a coiled green hose and a "
    "red plastic bucket at the left, a wet grey tiled floor with a round floor drain. Cool even "
    "ceiling light."
)

SHOTS = [
    {
        "id": "t01-customer-arrives",
        "out": "t01-customer-arrives.png",
        "refs": [SHEET_CUSTOMER, CANON_COUNTER],
        "face": True,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 35mm-equivalent, taken "
            "from behind the service counter looking across it at a customer who has just walked in. "
            "Shallow depth of field, the customer sharp.",

            CUSTOMER_ID + " He is the only person in frame: no shop staff, and no hands other than "
            "his own.",

            "He stands on the far side of the counter framed from the hips up, and has just set both "
            "filthy shoes down side by side on the pink mat in front of him, one hand still resting "
            "on the mat beside them. He is looking DOWN at the shoes, not at the camera, with a "
            "slightly resigned expression. His mouth is closed.",

            OBJECT + " Both shoes are filthy. They stand flat and upright on the mat, side by side, "
            "and nothing is lifted toward the camera.",

            SHOP_COUNTER,

            NEG_COMMON + " No apron on this man, he is a customer. No second customer.",
        ]),
    },
    {
        "id": "t02-intake",
        "out": "t02-intake.png",
        "refs": [SHEET_OWNER, SHEET_CUSTOMER, CANON_COUNTER],
        "face": True,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 35mm-equivalent, taken "
            "from over the shop owner's right shoulder from behind him, so his shoulder, the back of "
            "his navy apron strap and the back of his short faded hair fill the lower left of the "
            "frame out of focus, and the customer across the counter is sharp.",

            "TWO PEOPLE, and only two. " + OWNER_ID + " " + APRON + " He is seen from BEHIND -- his "
            "face is not visible at all in this frame. His two broad thick-fingered hands rest flat "
            "on the near edge of the pink mat, one on each side of the shoes, fingers relaxed and "
            "separate and clearly countable.",

            CUSTOMER_ID + " He stands on the far side of the counter framed from the chest up, both "
            "of his own hands drawn back to his sides away from the shoes, looking down at them. "
            "His mouth is closed.",

            OBJECT + " Both shoes are filthy and stand flat and upright on the pink mat midway "
            "between the two men, and nothing is lifted.",

            SHOP_COUNTER,

            NEG_COMMON + " Exactly four hands in frame in total, two per man, each with five fingers.",
        ]),
    },
    {
        "id": "t03-prep",
        "out": "t03-prep.png",
        "refs": [CANON_WETROOM, CANON_COUNTER],
        "face": False,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 50mm-equivalent, "
            "looking down at a shallow angle at the dry end of the stainless bench. Close framing on "
            "the hands and the shoe only.",

            "ONE PAIR OF ADULT MALE HANDS ONLY -- broad, thick-fingered working hands with short "
            "clean nails, a plain light grey polo sleeve rolled once above the elbow at the frame "
            "edge. NO face, NO head, NO shoulders above chest level, and no second person.",

            "One hand holds a single filthy canvas shoe steady on the dry stainless bench top; the "
            "other hand has drawn its flat cotton lace almost all the way out, and the loose lace "
            "lies coiled on the bench beside a grey foam insole already taken out and laid flat. A "
            "stiff short-bristled hand brush lies within reach on the bench. Everything in this "
            "frame is DRY: no water, no foam, no wet patches on the bench top.",

            OBJECT + " The shoe in frame is filthy, its tongue loose and its eyelets empty of lace "
            "down one side.",

            WETROOM + " The brush cylinders and the nozzle are behind and out of focus; this shot is "
            "at the dry end and the bench top under the shoe is dry.",

            NEG_COMMON + " No running water, no foam, no spray and no steam in this frame.",
        ]),
    },
    {
        "id": "t04-outsole",
        "out": "t04-outsole.png",
        "refs": [CANON_WETROOM, CANON_COUNTER],
        "face": False,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 50mm-equivalent, "
            "close-up looking down into the perforated stainless drain tray. Tight framing on the "
            "hands, the brush and one shoe.",

            "ONE PAIR OF ADULT MALE HANDS ONLY -- broad, thick-fingered, short clean nails, wet "
            "forearms, a plain light grey sleeve rolled above the elbow at the frame edge. NO face, "
            "NO head, and no second person.",

            "One hand holds a single canvas shoe tipped onto its side so the rubber outsole faces up "
            "toward the light; the other hand presses a stiff short-bristled scrubbing brush against "
            "that outsole. Grey-brown grit and thin dirty water run off the sole into the perforated "
            "tray and a little white foam has gathered in the tread. The upper of the shoe is still "
            "dirty and still dry -- only the sole is being worked.",

            OBJECT + " The sole tread is plain: concentric rubber ribbing with no lettering, no "
            "pattern logo and no numbers moulded into it.",

            WETROOM,

            NEG_COMMON + " Nothing is lifted toward the camera; the shoe stays low over the tray.",
        ]),
    },
    {
        "id": "t07-drycabinet",
        "out": "t07-drycabinet.png",
        "refs": [CANON_WETROOM, CANON_COUNTER],
        "face": False,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 35mm-equivalent, "
            "standing square in front of an open drying cabinet and looking slightly down into it.",

            "A tall stainless-steel constant-temperature drying cabinet stands against the "
            "white-tiled wall of the wet room with its door open toward the camera. Inside are three "
            "wire-mesh shelves; a slim tubular ultraviolet germicidal lamp is fixed under the roof of "
            "the cabinet and lays a faint cool violet-white light over the stainless interior, while "
            "the shop's ordinary ceiling light falls on the front edge. A small round analogue "
            "thermometer dial and a plain black rocker switch sit on the door frame, both blank.",

            "ONE PAIR OF ADULT MALE HANDS ONLY -- broad, thick-fingered, a plain light grey sleeve "
            "rolled above the elbow -- setting one freshly washed damp canvas shoe down on the middle "
            "mesh shelf, upright and level. Its washed flat cotton lace and its grey foam insole are "
            "already laid out beside it on the same shelf. NO face, NO head, and no second person.",

            # Counted, not implied. The first take put a second clean shoe on the
            # shelf above, which breaks the one line the whole film turns on --
            # only ONE shoe of the pair was washed. The other shelves are empty.
            "EXACTLY ONE SHOE is anywhere in this picture. The upper shelf and the lower shelf are "
            "completely EMPTY -- bare wire mesh, nothing on them at all. There is no second shoe, no "
            "other pair, and no other garment anywhere in the cabinet or in the room.",

            # The dirt sentence from OBJECT is dropped here on purpose: this is the
            # only shot where the shoe in frame is clean, and describing camping
            # soil in the weave while also asking for no dirt left in the weave is
            # a contradiction the model resolves by putting some back.
            "THE SHOES: one pair of plain cream cotton-canvas low-top plimsolls, exactly the pair in "
            "the attached canon photo. Visible cotton canvas weave across the whole upper, a cream "
            "rubber foxing band running right round above the sole, a rubber toe cap, flat cotton "
            "laces through plain metal eyelets, and completely blank side panels and blank tongue. "
            "The shoe on the shelf is the washed one: clean cream canvas with its weave clearly "
            "visible, damp and slightly darker at the toe, with no dirt left in the weave. Never an "
            "opaque crust, and never a leather or synthetic sneaker.",

            NEG_COMMON + " No readable text on the cabinet, the dial, the switch or anywhere else. "
            "No purple neon glow flooding the room -- the ultraviolet light is a faint tint inside "
            "the cabinet only.",
        ]),
    },
    {
        "id": "t10-bagging",
        "out": "t10-bagging.png",
        "refs": [CANON_PACK],
        "face": False,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 50mm-equivalent, "
            "looking down at a shallow angle at the counter. Close framing on the hands, the shoes "
            "and the bag.",

            "ONE PAIR OF ADULT MALE HANDS ONLY -- broad, thick-fingered working hands with short "
            "clean nails, a plain light grey polo sleeve rolled once above the elbow, and the lower "
            "edge of a plain dark navy bib apron across the top of the frame. NO face, NO head above "
            "chest level, and no second person.",

            "Both hands are sliding the pair of shoes down into an open plain kraft-paper bag "
            "standing upright on the rose-pink cutting mat: the clean shoe is already inside with "
            "only its heel showing above the rim, and the second shoe is being lowered in beside it. "
            "A folded clear polythene sleeve lies flat on the mat beside the bag.",

            OBJECT + " One shoe is clean -- bright cream canvas, weave clearly visible, foxing band "
            "white -- and the other is still dirty, grey-brown in the weave. The difference between "
            "the two is obvious.",

            "SET -- the cream counter top with the rose-pink cutting mat, white slat-wall and shelves "
            "of plain unlabelled bottles softly out of focus behind. Broad soft daylight from the "
            "left.",

            NEG_COMMON + " The kraft bag is completely plain: no printing, no logo, no handle tag "
            "and no sticker.",
        ]),
    },
    {
        "id": "t11-handover",
        "out": "t11-handover.png",
        "refs": [SHEET_OWNER, SHEET_CUSTOMER, CANON_PACK],
        "face": True,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 35mm-equivalent, taken "
            "from the side of the counter so both men are in frame at three-quarters, with the "
            "counter running across the lower third.",

            "TWO PEOPLE, and only two. " + OWNER_ID + " " + APRON + " He stands on the shop side at "
            "the left framed from the chest up, his face turned three-quarters down toward the "
            "counter and his eyes on the bag, not on the camera. His mouth is closed. Both of his "
            "hands rest on the kraft bag, one at its base and one steadying its rim.",

            CUSTOMER_ID + " He stands on the customer side at the right framed from the chest up, "
            "with ONE hand reaching in to take the rim of the bag and his other hand down out of "
            "frame. He looks down into the bag. His mouth is closed.",

            "A plain open kraft-paper bag stands upright on the rose-pink cutting mat between them. "
            "Both shoes are standing inside it, heels up, so that the heel and part of the quarter "
            "of each shoe shows above the rim -- the point of the shot is that the customer can see "
            "both of them in there.",

            # Same reason as t07: only the heels show here, so the long "dirt in
            # the weave and in the seam above the foxing band" sentence describes
            # a part of the shoe this frame cannot see, and competes with the one
            # fact the frame has to carry -- one heel clean, one heel dirty.
            "THE SHOES: one pair of plain cream cotton-canvas low-top plimsolls, exactly the pair in "
            "the attached canon photo. Visible cotton canvas weave across the whole upper, a cream "
            "rubber foxing band running right round above the sole, a rubber toe cap, flat cotton "
            "laces through plain metal eyelets, and completely blank side panels and blank tongue. "
            "Of the two heels showing above the rim of the bag, one is clean -- bright cream canvas "
            "with its weave clearly visible and a white foxing band -- and the other is still dirty "
            "and grey-brown in the weave. Never an opaque crust, and never a leather or synthetic "
            "sneaker. Nothing is lifted toward the camera.",

            "SET -- the cream counter top with the rose-pink cutting mat, white slat-wall and shelves "
            "of plain unlabelled bottles behind, the glass shop frontage and a daylit street at the "
            "far left. Broad soft daylight from the left.",

            NEG_COMMON + " Exactly three hands in frame, each with five fingers: two belonging to the "
            "man in the apron and one to the customer. The kraft bag is completely plain.",
        ]),
    },
    {
        "id": "t12-customer-confirms",
        "out": "t12-customer-confirms.png",
        "refs": [SHEET_CUSTOMER, CANON_PACK],
        "face": True,
        "prompt": "\n\n".join([
            "Photorealistic candid smartphone photo, vertical portrait 9:16, 35mm-equivalent, taken "
            "from behind the counter looking across at the customer, with the counter running across "
            "the lower third of the frame.",

            CUSTOMER_ID + " He is the only person in frame: no shop staff and no other hands.",

            "He stands on the far side of the counter framed from the chest up, looking DOWN at the "
            "two shoes now standing side by side on the pink mat in front of him, both of his own "
            "hands resting on the counter edge either side of them. His eyebrows are slightly raised "
            "and one corner of his mouth is lifted in a small pleased expression, but his mouth is "
            "closed and no teeth show. He is not looking at the camera.",

            # The dirt description is folded into the RIGHT shoe rather than left
            # standing as a general statement about the pair: this is the one
            # frame where the pair is half clean and half dirty side by side, and
            # a sentence that describes both as dirty fights the whole picture.
            "THE SHOES: one pair of plain cream cotton-canvas low-top plimsolls, exactly the pair in "
            "the attached canon photo. Visible cotton canvas weave across the whole upper, a cream "
            "rubber foxing band running right round above the sole, a rubber toe cap, flat cotton "
            "laces through plain metal eyelets, and completely blank side panels and blank tongue. "
            "The two shoes stand upright and flat on the mat side by side: the LEFT one clean -- "
            "bright cream canvas, weave clearly visible, foxing band white -- and the RIGHT one "
            "still dirty, grey-brown camping soil sitting IN the weave and in the seam above the "
            "foxing band with the weave still reading through it. The difference between them is "
            "the point of the picture and must be unmistakable. Never an opaque crust, and never a "
            "leather or synthetic sneaker. Nothing is lifted toward the camera.",

            "SET -- the cream counter top with the rose-pink cutting mat, white slat-wall and shelves "
            "of plain unlabelled bottles behind him, the glass shop frontage and a daylit street at "
            "the left edge. Broad soft daylight from the left.",

            NEG_COMMON + " No apron on this man, he is a customer. No second customer.",
        ]),
    },
]

BY_ID = {s["id"]: s for s in SHOTS}
REAL_BRANDS = ("nike", "adidas", "converse", "vans", "new balance", "asics", "puma")


def gate(s: dict) -> list[str]:
    """Refuse a prompt that carries a defect this pipeline has already paid for."""
    p = s["prompt"]
    bad = []
    if "9:16" not in p:
        bad.append("no 9:16 aspect")
    if "canvas weave" not in p:
        bad.append("object passport missing the canvas weave")
    if s["face"] and "mouth is closed" not in p:
        bad.append("a face is in frame but the mouth is not stated closed")
    if not s["face"] and "NO face" not in p:
        bad.append("hands-only shot does not forbid the face")
    if "NOT ALLOWED" not in p:
        bad.append("negative block missing")
    low = p.lower()
    for word in REAL_BRANDS:
        if word in low:
            bad.append("names a real brand: " + word)
    return bad


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "list":
        fail = 0
        for s in SHOTS:
            problems = gate(s)
            words = len(s["prompt"].split())
            if problems:
                fail += 1
            mark = "FAIL" if problems else "ok  "
            line = "%s %-24s %4d words  refs=%d" % (mark, s["id"], words, len(s["refs"]))
            if problems:
                line += "  " + "; ".join(problems)
            print(line)
        print()
        print("%d of %d prompts pass the gate" % (len(SHOTS) - fail, len(SHOTS)))
        return 1 if fail else 0
    if cmd in ("show", "refs"):
        if len(sys.argv) < 3:
            print("which shot?")
            return 1
        s = BY_ID.get(sys.argv[2])
        if not s:
            print("unknown shot %r" % sys.argv[2])
            return 1
        problems = gate(s)
        if problems:
            print("REFUSED: " + "; ".join(problems))
            return 1
        print(s["prompt"] if cmd == "show" else "\n".join(s["refs"]))
        return 0
    print("unknown command %r" % cmd)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
