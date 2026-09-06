/**
 * Image prompt doctrine layer (owner directive 2026-09-07: "提示詞太少,要發揮
 * Codex 作圖全部的能力").
 *
 * Applies the director doctrine in docs-internal/chuanzhang (digest §2E, §3,
 * rule 40 "靜圖七段") to the carousel image prompts:
 *   [Subject+Condition] [Location] [Composition] [Lighting] [Style] [Camera/Lens] [Color]
 * with three concrete upgrades over the pre-9/9 prompt:
 *   1. material optics written as events (how light behaves on THIS surface),
 *      not adjectives ("suede", "honest used fabric");
 *   2. wear written as a physical mechanism with a boundary and a position,
 *      not "honest everyday wear at the positions the topic names";
 *   3. composition/lens per slide (hero vs. checkpoint macro) and a short
 *      per-family negative list instead of one fixed 14-item tail.
 *
 * Date-gated so calendars already stamped before the start date keep the
 * prompts their images were certified with (prompt_sha256 chain).
 */
import type { ObjectSpec } from "./contentPlan";

export const IMAGE_DOCTRINE_START_DATE = "2026-09-09";

export function imageDoctrineActive(date: string): boolean {
  return date >= IMAGE_DOCTRINE_START_DATE;
}

interface OpticsRule {
  id: string;
  match: RegExp;
  text: string;
}

/**
 * Matched against `${noun} ${material}` lower-cased. More specific rows first:
 * suede before generic shoe, knit indoor slippers before mesh, shirting before
 * generic cotton.
 */
export const MATERIAL_OPTICS: OpticsRule[] = [
  {
    id: "suede",
    match: /suede/,
    text:
      "MATERIAL OPTICS: the suede nap swallows light into a velvety matte; where the nap has been pressed flat it reads darker and faintly glossy, and the boundary between raised and flattened nap is visible as a soft directional change when the light rakes across it; stitching sits slightly proud with a thin highlight on each thread."
  },
  {
    id: "knit-slipper",
    match: /knit-mesh|indoor slippers|cloth lining/,
    text:
      "MATERIAL OPTICS: the knit-mesh upper scatters light into a soft matte sheen with tiny specular points on the knit ridges; the cloth lining at the opening is matte and shows fibre fuzz; the EVA footbed is chalky matte with a faint compressed shine at the heel print."
  },
  {
    id: "mesh-sneaker",
    match: /mesh|sneaker|running|kids|chunky|rubber outsole|foam midsole/,
    text:
      "MATERIAL OPTICS: engineered mesh scatters light into a soft matte sheen with tiny specular points on the knit ridges; the foam midsole is chalky matte with fine pitting and a broad low-contrast highlight on its curve; the rubber outsole has a low satin sheen that narrows to one thin bright line along its rounded edge; laces are matte woven polyester with visible flat weave."
  },
  {
    id: "canvas",
    match: /canvas/,
    text:
      "MATERIAL OPTICS: cotton canvas shows a visible plain weave with dust caught in the weave valleys and a dry matte surface; the rubber foxing strip carries a yellowed satin sheen with one soft window highlight sliding along its curve; eyelets show small crisp metallic points."
  },
  {
    id: "split-leather",
    match: /split-leather|hiking/,
    text:
      "MATERIAL OPTICS: split leather is a fine-grained matte that darkens where oil and water soaked in, with a soft blurred boundary; the padded collar shows compressed creases; the lugged rubber outsole has a satin sheen on the lug tops and dry dust in the grooves."
  },
  {
    id: "smooth-leather",
    match: /leather sneakers|dress shoe|leather shoe|loafer|smooth leather|皮鞋/,
    text:
      "MATERIAL OPTICS: smooth leather carries one soft broad window reflection that slides across the toe curve and rolls off gently; creases show as darker fine lines with tiny highlights on their ridges; scuffed areas lose that reflection and go dry matte with a crisp edge; the welt and sole edge are dull with dust in the stitch line."
  },
  {
    id: "pebbled-bag",
    match: /pebbled|handbag|bag corners/,
    text:
      "MATERIAL OPTICS: pebbled leather-look grain breaks the light into a fine dotted highlight pattern; the corners show edge paint worn through in a hard-edged patch exposing lighter, fuzzier material underneath; handles are darker and smoother where hands grip them, with a faint oily sheen; stitched seams sit proud with a highlight on each stitch."
  },
  {
    id: "shirting",
    match: /shirting|poly-cotton|sailor|dress shirt/,
    text:
      "MATERIAL OPTICS: fine cotton shirting shows a tight weave with a faint sheen along fold ridges and matte in the valleys; the collar ring reads as a soft-edged darker band following the fold line, strongest at the inside crease; button threads and seams sit slightly proud with a thin highlight."
  },
  {
    id: "cotton-twill",
    match: /cotton twill|work jacket|cotton jersey|cotton tee/,
    text:
      "MATERIAL OPTICS: cotton twill or jersey is a dry matte with the diagonal or knit texture visible at close range; darkened areas at collar and cuffs are a soft-edged band that follows the contact line; fading shows as lower contrast along ridges, not as a painted patch."
  },
  {
    id: "wool",
    match: /wool/,
    text:
      "MATERIAL OPTICS: wool is a matte fibrous surface with tiny fly-away fibres catching light along the silhouette edge; the shoulder line and lapel roll show soft broad shading rather than sharp highlights; dust at the shoulder reads as a slightly lighter, duller strip."
  },
  {
    id: "down-nylon",
    match: /down|nylon/,
    text:
      "MATERIAL OPTICS: the nylon shell gives small directional highlights on the quilted ridges and darker matte in the stitched channels; flattened channels look dull and thin with visible stitch tension, full channels are rounded with a soft highlight roll-off."
  },
  {
    id: "denim",
    match: /denim/,
    text:
      "MATERIAL OPTICS: indigo denim shows the diagonal twill with lighter warp threads on the ridges; fade at the thigh and hem is a gradual loss of indigo along the ridges with the valleys still dark; seams are thick and matte."
  },
  {
    id: "plush",
    match: /plush|pile/,
    text:
      "MATERIAL OPTICS: fresh plush pile scatters light softly with a halo along the edges; matted pile lies flat, reflects as dull slightly shiny patches, and shows the direction it was pressed; seams are visible as fine valleys."
  },
  {
    id: "terry",
    match: /terry|towel/,
    text:
      "MATERIAL OPTICS: terry loops scatter light into a soft matte surface; used loops flatten and go slightly grey with a dull sheen; folded edges show the loop texture in profile."
  },
  {
    id: "duvet-cotton",
    match: /duvet|piping|bedding|cotton with thin navy/,
    text:
      "MATERIAL OPTICS: warm-white cotton percale is a fine matte weave with soft broad shading across the folds; the navy piping is a thin crisp line; moisture or odour areas read as a faintly greyer, slightly limp region with a blurred boundary."
  },
  {
    id: "curtain",
    match: /curtain/,
    text:
      "MATERIAL OPTICS: the woven polyester curtain fabric is a dense matte weave with a faint sheen only along the pleat ridges; dust at the hem reads as a greyer, duller band with a soft upper boundary; sun-fade shows as lighter stripes along the pleat folds that faced the window; the metal hooks are small dull-satin points at the header."
  },
  {
    id: "woven-suitcase",
    match: /suitcase|woven suitcase/,
    text:
      "MATERIAL OPTICS: the woven polyester shell is a coarse matte texture with dust settled in the weave; plastic wheels and the handle have a hard satin sheen with grey grime in the recesses."
  },
  {
    id: "generic-fabric",
    match: /.*/,
    text:
      "MATERIAL OPTICS: the fabric shows its real weave or knit texture at close range, matte with a faint sheen only along fold ridges; worn or soiled areas read as soft-edged darker regions that follow the contact line, never as painted patches."
  }
];

export function materialOptics(spec: Pick<ObjectSpec, "noun" | "material">): string {
  const key = `${spec.noun} ${spec.material}`.toLowerCase();
  return (MATERIAL_OPTICS.find((rule) => rule.match.test(key)) ?? MATERIAL_OPTICS[MATERIAL_OPTICS.length - 1]!).text;
}

/** Physical mechanism per wear kind (keys are wearKindFromTopic outputs). */
export const WEAR_MECHANISM: Record<string, string> = {
  yellowing:
    "yellowing as a diffuse gradient that is strongest at the outer edge and fades inward, with the original colour still visible in protected spots",
  "sweat residue":
    "sweat darkening as a soft-edged tide line that follows the contact shape, with faint salt-white rims at its border",
  "oil darkening":
    "oil darkening with a slightly glossy centre and a diffuse halo that has soaked into the fibres",
  "mud shadow in the weave":
    "dried mud as dull brown specks and a thin crust with crisp edges, thicker along the lower edge and thinning upward",
  "trapped moisture":
    "damp darkening with a blurred boundary and a slightly limp, heavier drape where it soaked in",
  "sun-faded grey":
    "sun-faded grey with lowered contrast along the ridges and the original colour surviving in the folds",
  "odour and sweat residue":
    "sweat and odour residue as a soft-edged darker tide line on the contact surfaces with faint salt-white rims, the lining slightly greyed and matted where the foot sits, the outside still ordinary everyday-clean",
  "mould spotting":
    "mould as small grey-green speckles clustered in a patch with a faint powdery halo, following the fold or seam where moisture sat",
  "sole separation":
    "sole separation as a thin dark gap opening between upper and midsole with a crisp edge, widest at the flex point, the glue line visible as a dull yellowed strip",
  pilling:
    "pilling as many tiny fibre balls standing on the surface where it rubbed, casting minute shadows, densest at the friction zone and thinning outward",
  abrasion:
    "abrasion as a matte roughened patch with a crisp boundary where the finish was rubbed off, lighter than the surrounding surface, along the contact edge",
  "honest everyday wear":
    "everyday wear as dust settled in texture valleys, a slightly greyed tone at contact points, and small scuffs with crisp edges"
};

export function wearMechanism(kind: string, spots: string[], fallbackWear: string): string {
  const mechanism = WEAR_MECHANISM[kind] ?? WEAR_MECHANISM["honest everyday wear"]!;
  const where = spots.length > 0 ? `at the ${spots.join(" and ")}` : `at the positions named by the topic (${fallbackWear})`;
  return `WEAR MECHANISM: ${mechanism}, ${where}; the rest of the object stays in ordinary used condition so the marked positions read as the story.`;
}

export type ObjectFamily = "shoe" | "bag" | "garment" | "bedding" | "plush" | "other";

export function objectFamily(spec: Pick<ObjectSpec, "noun" | "material">): ObjectFamily {
  const key = `${spec.noun} ${spec.material}`.toLowerCase();
  if (/shoe|sneaker|slipper|boot|loafer|sandal/.test(key)) return "shoe";
  if (/handbag|bag|suitcase/.test(key)) return "bag";
  if (/duvet|bedding|pillow|sheet/.test(key)) return "bedding";
  if (/plush|doll/.test(key)) return "plush";
  if (/shirt|jacket|coat|tee|denim|jeans|uniform|suit|towel|blouse/.test(key)) return "garment";
  return "other";
}

const NEGATIVES: Record<ObjectFamily, string> = {
  shoe: "Avoid: brand logos or logo-like marks, a second pair, readable text on the shoe, a waxy plastic-coated surface.",
  bag: "Avoid: brand lettering on hardware, a second bag, readable tags, a waxy plastic-coated surface.",
  garment: "Avoid: readable care-label or hang-tag text, a second garment, a mannequin, a waxy plastic-coated surface.",
  bedding: "Avoid: readable label text, a second duvet, a bedroom set, a waxy plastic-coated surface.",
  plush: "Avoid: character faces from known franchises, a second doll, readable tags.",
  other: "Avoid: brand logos, readable text on the object, a second object of the same kind, a waxy plastic-coated surface."
};

export function familyNegatives(family: ObjectFamily): string {
  return NEGATIVES[family];
}

export function locationBlock(anchor: string): string {
  return `LOCATION: a light laminate counter with a pink self-healing cutting mat, white slat-wall panels behind, ${anchor}, everyday Taiwanese laundry-shop clutter only at the frame edges; any paperwork or labels in the background are out of focus and unreadable.`;
}

export function compositionBlock(slide: number, spot?: string): string {
  if (slide === 1) {
    return "COMPOSITION: three-quarter front view, the object centred slightly low with its centre near x=50% y=58%, filling about 55-65% of the frame height; foreground is the mat texture in front of the object, midground is the object, background is softened shop depth; the whole object stays inside the frame with breathing room at the top.";
  }
  if (spot) {
    return `COMPOSITION: macro framing on the ${spot}, that area filling about 60-70% of the frame with the rest of the same object recognizable at the frame edge; the wear boundary sits near the centre so its edge is readable; a fingertip may rest at the edge of the frame but no full hand.`;
  }
  if (slide === 2) {
    return "COMPOSITION: closer three-quarter view, the object filling about 65-75% of the frame height so seams, grain and full silhouette stay readable; centre slightly low.";
  }
  if (slide === 3) {
    return "COMPOSITION: tight close-up on the problem area, the wear filling most of the frame with its boundary near the centre; the rest of the same object visible at the edge.";
  }
  return "COMPOSITION: the same object on the same mat, framed the same way as photo 1, so the two states compare directly.";
}

export const LIGHTING_BLOCK =
  "LIGHTING: key light from the storefront window on the left, soft and directional, so highlights have a clear side and roll off gently; fluorescent ceiling fill lifts the shadows without killing them; one real contact shadow under the object with a soft edge, denser where the object touches the mat.";

export const STYLE_BLOCK =
  "STYLE: documentary phone photo taken by the shop staff at the inspection counter, real physics, slight handheld framing imperfection; not editorial, not cinematic, not studio.";

export function cameraBlock(slide: number, macro: boolean): string {
  if (slide === 1) {
    return "CAMERA: phone main camera, 26mm-equivalent, held slightly high looking down about 15 degrees, f/1.8 look with natural phone depth: the object sharp front to back, the background softened but still recognizable.";
  }
  if (macro) {
    return "CAMERA: phone close-focus at about 50mm-equivalent, f/2.8 feel with moderate shallow depth of field, focus locked on the wear boundary, optical bokeh not artificial blur.";
  }
  return "CAMERA: phone main camera, 26mm-equivalent, a step closer than photo 1, focus on the object, background softened.";
}

export const COLOR_BLOCK =
  "COLOR: neutral warm indoor tone, low saturation close to documentary colour, honest whites that read slightly grey, no colour cast on the pink mat beyond what the fluorescent fill gives.";

export function slideSpot(brief: string): string | undefined {
  const match = brief.match(/checkpoint \d+: ([^.]+)\./);
  return match?.[1]?.trim();
}

export interface DoctrinePromptInput {
  spec: Pick<ObjectSpec, "noun" | "material" | "wear">;
  wearKind: string;
  spots: string[];
  passport: string;
  sceneLock: string;
  anchor: string;
  briefs: string[];
  sameGarment: string;
}

/** Full four-slide prompt set in seven-segment doctrine order. */
export function buildDoctrinePrompts(input: DoctrinePromptInput): string[] {
  const family = objectFamily(input.spec);
  const subject = `${input.passport} ${materialOptics(input.spec)} ${wearMechanism(input.wearKind, input.spots, input.spec.wear)}`;
  const shared = `${subject} ${input.sceneLock} Create one portrait 4:5 photo. Keep the exact featured object consistent across all four photos. ${locationBlock(input.anchor)}`;
  return input.briefs.map((brief, index) => {
    const slide = index + 1;
    const spot = slideSpot(brief);
    const macro = slide > 1 && (Boolean(spot) || slide === 3);
    const continuity = slide === 1 ? "" : ` ${input.sameGarment}.`;
    return [
      shared,
      compositionBlock(slide, spot),
      LIGHTING_BLOCK,
      STYLE_BLOCK,
      cameraBlock(slide, macro),
      COLOR_BLOCK,
      `Photo ${slide} of 4.${continuity} ${brief}`,
      familyNegatives(family)
    ].join(" ");
  });
}
