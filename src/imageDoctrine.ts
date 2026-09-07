/**
 * Image prompt doctrine layer.
 *
 * v1 (2026-09-07 morning, PR #68): seven-segment prompt with material optics,
 * wear mechanism, per-slide composition/lens, per-family negatives.
 *
 * v2 (2026-09-07, owner review of the first Codex batch — "物件太乾淨、每天同一張
 * 桌子、擺法是商品照、光太平"; owner decisions: hands and tools may appear,
 * rotate scene stations, wear must read at a glance, cropping allowed):
 *   1. WEAR FIRST: the wear is the first sentence after the passport, sized
 *      (25-40% of the named area) and placed on the camera-facing side; topics
 *      that name an interior spot (insole, lining, opening) open it in the hero.
 *   2. STATIONS: four shop stations rotated by date; the lock is still "same
 *      station on all four slides", but the pink mat is no longer the only set.
 *   3. INSPECTION STAGING: one hand (wrist only) holds the problem area, one
 *      tool at the frame edge, item opened/turned as a shop worker would.
 *   4. CROP + OFF-CENTRE: the hero may frame the half that carries the problem,
 *      cut by the frame edge on one side; no catalogue symmetry.
 *   5. LIGHTING with a visible shadow side; mat/counter must not tint whites.
 *
 * Date-gated so calendars stamped before the start date keep their prompts.
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
    id: "two-tone-grosgrain",
    match: /grosgrain|goatskin/,
    text:
      "MATERIAL OPTICS: the goatskin body is a fine-grained matte with a soft broad highlight rolling over the toe; the black grosgrain cap shows a dry, directional ribbed texture that catches light as thin parallel lines and frays into fuzz where it is worn; the block heel has a dull leather-wrapped surface."
  },
  {
    id: "quilted-lambskin",
    match: /lambskin|diamond-quilted|cane-lattice/,
    text:
      "MATERIAL OPTICS: soft lambskin carries a buttery low sheen that pools in the quilted valleys and lifts to a soft highlight on each raised diamond or lattice; worn corners flatten the quilting and turn glossy and darker; the chain shows small crisp metallic points with the leather threading dull where hands touch it."
  },
  {
    id: "coated-canvas",
    match: /coated canvas|coated-canvas|vachetta/,
    text:
      "MATERIAL OPTICS: the coated canvas has a hard, slightly waxy sheen with a fine grain that reads as one even texture; the untreated vachetta trim is matte and honey-coloured, darker and shinier exactly where hands hold it, with water spots as sharp-edged darker rings."
  },
  {
    id: "gabardine",
    match: /gabardine|trench/,
    text:
      "MATERIAL OPTICS: the gabardine is a tight diagonal twill with a dry matte surface and a faint sheen only along pressed edges; oil darkening at the inside collar reads as a soft-edged darker band; grime along the belt shows as a greyer stripe with a visible edge."
  },
  {
    id: "cork-footbed",
    match: /cork footbed|cork-footbed/,
    text:
      "MATERIAL OPTICS: the cork footbed is a warm speckled matte whose sealant has a faint gloss where intact and a dull flaking edge where worn; the suede straps are a dry matte that greys at the edges; the buckles are small dull-satin points."
  },
  {
    id: "fur-trim-parka",
    match: /fur-look hood|faux-fur|down parka/,
    text:
      "MATERIAL OPTICS: the matte shell has a soft dry surface with wide quilting ridges catching a faint highlight; the fur trim scatters light into fine bright tips when fresh and clumps into dull grey strands where it is soiled; cuff grime reads as a greyer, slightly glossy band."
  },
  {
    id: "sheepskin",
    match: /sheepskin|shearling/,
    text:
      "MATERIAL OPTICS: the suede sheepskin is a deep matte that darkens sharply where water soaked in, with pale salt lines along the stain edge; the wool cuff scatters light softly when fresh and mats into dull grey clumps where it is worn."
  },
  {
    id: "cashmere",
    match: /cashmere/,
    text:
      "MATERIAL OPTICS: cashmere has a soft halo of fine fibres catching light along every edge; pilling shows as many small fibre balls each casting a tiny shadow; a sweat-darkened underarm reads as a slightly greyer, flatter patch."
  },
  {
    id: "screen-print",
    match: /screen-print|graphic tee|plastisol/,
    text:
      "MATERIAL OPTICS: the cotton jersey is a dry matte knit; the screen print sits on top as a thin plastic film with a slightly glossier surface that has cracked into a fine crazed pattern where the fabric stretched; faded areas show lower contrast along the knit ridges."
  },
  {
    id: "nylon-shell",
    match: /ripstop|nylon upper|nylon trainers|windbreaker|ballistic nylon/,
    text:
      "MATERIAL OPTICS: the nylon has a crisp low sheen with a visible grid or weave texture; highlights are small and hard-edged; grime reads as a dull greyed area where the sheen is gone."
  },
  {
    id: "leather-sneaker",
    match: /white leather court|calf leather.*sneaker|leather low-top|cupsole|star sneakers/,
    text:
      "MATERIAL OPTICS: smooth white leather carries one broad soft highlight with fine creases showing as darker lines; the rubber cupsole is matte with a faint yellow cast where it aged; suede patches are a dry matte that darkens when soiled."
  },
  {
    id: "foam-clog",
    match: /foam clog|foam resin|moulded foam/,
    text:
      "MATERIAL OPTICS: the moulded foam is a soft matte with a faint satin highlight on curved surfaces; grime collects as dark lines inside the ventilation holes and a grey film on the footbed."
  },
  {
    id: "gum-sole-trainers",
    match: /gum rubber|gum sole/,
    text:
      "MATERIAL OPTICS: black suede is a deep matte that greys where the nap is worn; the smooth leather panels carry a soft window highlight; the gum rubber sole is translucent amber with a satin sheen and dirt settled along its edge."
  },
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
    match: /pebbled|handbag|hobo|bag corners|saffiano|togo/,
    text:
      "MATERIAL OPTICS: the bag's surface breaks the light into a fine dotted or brushed highlight pattern; the corners show the finish worn through in a hard-edged patch exposing lighter, fuzzier material underneath; handles are darker and smoother where hands grip them, with a faint oily sheen; stitched seams sit proud with a highlight on each stitch."
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
      "MATERIAL OPTICS: warm-white cotton percale is a fine matte weave with soft broad shading across the folds; the navy piping is a thin crisp line; soiled areas read as a greyer, slightly limp region whose edge is clearly visible against the clean white."
  },
  {
    id: "curtain",
    match: /curtain/,
    text:
      "MATERIAL OPTICS: the woven polyester curtain fabric is a dense matte weave with a faint sheen only along the pleat ridges; dust at the hem reads as a distinctly greyer, duller band with a visible upper boundary; sun-fade shows as lighter stripes along the pleat folds that faced the window; the metal hooks are small dull-satin points at the header."
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
      "MATERIAL OPTICS: the fabric shows its real weave or knit texture at close range, matte with a faint sheen only along fold ridges; worn or soiled areas read as clearly darker regions that follow the contact line, with a visible edge, never as painted patches."
  }
];

export function materialOptics(spec: Pick<ObjectSpec, "noun" | "material">): string {
  const key = `${spec.noun} ${spec.material}`.toLowerCase();
  return (MATERIAL_OPTICS.find((rule) => rule.match.test(key)) ?? MATERIAL_OPTICS[MATERIAL_OPTICS.length - 1]!).text;
}

/** Physical mechanism per wear kind (keys are wearKindFromTopic outputs). */
export const WEAR_MECHANISM: Record<string, string> = {
  yellowing:
    "yellowing as a distinct warm-yellow band, strongest at the outer edge and fading inward, the original white still visible next to it for contrast",
  "sweat residue":
    "sweat darkening as a clearly darker tide line that follows the contact shape, with salt-white rims at its border",
  "oil darkening":
    "oil darkening with a slightly glossy centre and a diffuse halo that has soaked into the fibres, clearly darker than the surrounding fabric",
  "mud shadow in the weave":
    "dried mud as brown specks and a thin crust with crisp edges, thicker along the lower edge and thinning upward",
  "trapped moisture":
    "damp darkening with a blurred boundary and a limp, heavier drape where it soaked in, clearly darker than the dry area",
  "sun-faded grey":
    "sun-faded grey with a visible step in colour where the fold protected the original tone",
  "odour and sweat residue":
    "sweat and odour residue as a clearly darker tide line on the contact surfaces with salt-white rims, the lining greyed and matted where the foot sits, the outside still ordinary everyday-clean so the inside reads as the problem",
  "mould spotting":
    "mould as grey-green speckles clustered in a patch with a powdery halo, following the fold or seam where moisture sat",
  "sole separation":
    "sole separation as a dark gap opening between upper and midsole with a crisp edge, widest at the flex point, the glue line visible as a dull yellowed strip",
  pilling:
    "pilling as many small fibre balls standing on the surface where it rubbed, casting tiny shadows, densest at the friction zone",
  abrasion:
    "abrasion as a matte roughened patch with a crisp boundary where the finish was rubbed off, lighter than the surrounding surface",
  "honest everyday wear":
    "everyday wear as grey dust in the texture valleys, greyed contact points and small scuffs with crisp edges, clearly visible against the cleaner areas"
};

/** Interior or hidden spots: the hero must open the item to show them. */
const INTERIOR_SPOT = /insole|lining|inner|shoe opening|tongue|inside|underarm/i;

export function wearMechanism(kind: string, spots: string[], fallbackWear: string): string {
  const mechanism = WEAR_MECHANISM[kind] ?? WEAR_MECHANISM["honest everyday wear"]!;
  const where = spots.length > 0 ? `at the ${spots.join(" and ")}` : `at the positions named by the topic (${fallbackWear})`;
  return (
    `WEAR FIRST (this is the story of the photo): ${mechanism}, ${where}; it covers roughly 25-40% of that area and is strong enough to read at thumbnail size from arm's length, ` +
    "on the side that faces the camera; the rest of the object is clean enough that the marked area is unmistakably the problem, but the object is a used everyday item, not new stock."
  );
}

export function needsOpening(spots: string[], wear: string): boolean {
  return spots.some((s) => INTERIOR_SPOT.test(s)) || INTERIOR_SPOT.test(wear);
}

export type ObjectFamily = "shoe" | "bag" | "garment" | "bedding" | "plush" | "other";

export function objectFamily(spec: Pick<ObjectSpec, "noun" | "material">): ObjectFamily {
  const key = `${spec.noun} ${spec.material}`.toLowerCase();
  if (/shoe|sneaker|slipper|boot|loafer|sandal|pump|flat|trainer|clog/.test(key)) return "shoe";
  if (/handbag|hobo|bag|suitcase|tote|backpack|crossbody/.test(key)) return "bag";
  if (/duvet|bedding|pillow|sheet/.test(key)) return "bedding";
  if (/plush|doll/.test(key)) return "plush";
  if (/shirt|jacket|coat|tee|denim|jeans|uniform|suit|towel|blouse|curtain|trench|sweater|windbreaker/.test(key)) return "garment";
  return "other";
}

const NEGATIVES: Record<ObjectFamily, string> = {
  shoe: "Avoid: brand logos or logo-like marks, a second pair, readable text on the shoe, a waxy plastic-coated surface, a second hand.",
  bag: "Avoid: brand lettering on hardware, a second bag, readable tags, a waxy plastic-coated surface, a second hand.",
  garment: "Avoid: readable care-label or hang-tag text, a second garment, a mannequin, a waxy plastic-coated surface, a second hand.",
  bedding: "Avoid: readable label text, a second duvet, a bedroom set, a waxy plastic-coated surface, a second hand.",
  plush: "Avoid: character faces from known franchises, a second doll, readable tags, a second hand.",
  other: "Avoid: brand logos, readable text on the object, a second object of the same kind, a waxy plastic-coated surface, a second hand."
};

export function familyNegatives(family: ObjectFamily): string {
  return NEGATIVES[family];
}

/** Tool at the frame edge, chosen by family; the hand may hold it in checkpoint slides. */
export function familyTool(family: ObjectFamily): string {
  switch (family) {
    case "shoe":
      return "a worn horsehair shoe brush";
    case "bag":
      return "a folded white microfibre cloth";
    case "bedding":
      return "a handheld lint roller";
    case "plush":
      return "a soft-bristle garment brush";
    default:
      return "a white plastic spray bottle with no readable label";
  }
}

/**
 * Four shop stations, rotated by date. Continuity stays inside one carousel
 * (same station on all four slides); the day-to-day feed no longer shows the
 * same pink mat every post.
 */
export interface SceneStation {
  id: string;
  lock: string;
  location: string;
}

export const SCENE_STATIONS: SceneStation[] = [
  {
    id: "counter-mat",
    lock: "SCENE LOCK: the same light laminate reception counter with the pink cutting mat on every slide; do not change location, backdrop, or room across slides.",
    location:
      "LOCATION: the reception counter of a small Taiwanese laundry shop: light laminate top, a pink self-healing cutting mat covering less than a fifth of the frame in one corner, white slat-wall panels behind, a receipt pad and pen pushed to the frame edge; background shelves softly out of focus; any paperwork or labels unreadable."
  },
  {
    id: "steel-table",
    lock: "SCENE LOCK: the same brushed stainless-steel work table with the white tiled wall on every slide; do not change location, backdrop, or room across slides.",
    location:
      "LOCATION: the back work table of the same laundry shop: brushed stainless-steel top with fine scratches and a few water spots, white ceramic tile wall behind with grey grout, a row of unlabelled care-product bottles and a folded towel softly out of focus at the back edge; no pink mat."
  },
  {
    id: "wash-station",
    lock: "SCENE LOCK: the same shoe-washing sink station with the wet stainless drainboard on every slide; do not change location, backdrop, or room across slides.",
    location:
      "LOCATION: the shoe-washing station: a stainless drainboard beside a deep sink, still damp with small water beads, two brushes and a bar of saddle soap at the frame edge, a green rubber mat on the floor beyond, fluorescent tube light overhead and a small window to one side; no pink mat."
  },
  {
    id: "garment-rail",
    lock: "SCENE LOCK: the same wooden counter in front of the garment conveyor rail on every slide; do not change location, backdrop, or room across slides.",
    location:
      "LOCATION: a worn light-oak wooden counter in front of the garment conveyor rail, plastic-covered finished clothes hanging softly out of focus behind, a paper ticket clipped to one hanger (unreadable), a tape measure coiled at the frame edge; no pink mat."
  }
];

export function sceneStationForDate(date: string): SceneStation {
  const n = Number(date.replace(/-/g, ""));
  return SCENE_STATIONS[n % SCENE_STATIONS.length] ?? SCENE_STATIONS[0]!;
}

export function compositionBlock(slide: number, spot?: string, opening = false, tool = "a tool"): string {
  if (slide === 1) {
    const open = opening
      ? " Because the problem is inside, the item is opened toward the camera: the insole pulled halfway out, the opening tilted to the lens, or the lining turned outward, so the marked area is fully visible."
      : "";
    return (
      "COMPOSITION (hero, crop allowed): frame the half of the object that carries the problem, the object cut by the frame edge on one side and set off-centre with its mass near x=40% or x=60%, filling 60-75% of the frame height; one adult hand entering from the frame edge, wrist only, fingers holding or pressing right beside the problem area with five clearly separated fingers; " +
      `${tool} rests at the frame edge as a foreground occlusion; the surface fills the bottom of the frame, not empty space.` +
      open
    );
  }
  if (spot) {
    return `COMPOSITION: macro framing on the ${spot}, that area filling 60-75% of the frame; one fingertip points at or presses the exact spot from the frame edge; the wear boundary sits near the centre so its edge is readable; the rest of the same object is recognizable at the edge.`;
  }
  if (slide === 2) {
    return "COMPOSITION: closer three-quarter view, the object filling 65-80% of the frame, off-centre, the hand turning or lifting it so the problem side faces the lens; seams and texture readable.";
  }
  if (slide === 3) {
    return "COMPOSITION: tight close-up on the problem area, the wear filling most of the frame with its boundary near the centre, a fingertip at the frame edge; the rest of the same object visible at the edge.";
  }
  return "COMPOSITION: the same object at the same station, framed like photo 1 with the hand withdrawn, so the two states compare directly.";
}

export const LIGHTING_BLOCK =
  "LIGHTING: one clear key light from a window on one side: the lit side of the object is bright and the far side falls to mid-grey with a visible shadow edge running across the object; a dense contact shadow at the base that softens outward; ceiling fluorescent fills only enough to keep shadow detail; the counter or mat must not tint the whites.";

export const STYLE_BLOCK =
  "STYLE: candid documentary phone photo taken by the shop worker mid-inspection, the action caught while it happens, slight handheld tilt and framing imperfection; not editorial, not catalogue, not studio.";

export function cameraBlock(slide: number, macro: boolean): string {
  if (slide === 1) {
    return "CAMERA: phone main camera, 26mm-equivalent, held from the worker's standing eye line looking down about 25 degrees, f/1.8 look: the problem area sharp, the far side of the object slightly softer, the background clearly out of focus.";
  }
  if (macro) {
    return "CAMERA: phone close-focus at about 50mm-equivalent, f/2.8 feel with moderate shallow depth of field, focus locked on the wear boundary, optical bokeh not artificial blur.";
  }
  return "CAMERA: phone main camera, 26mm-equivalent, a step closer than photo 1, focus on the object, background softened.";
}

export const COLOR_BLOCK =
  "COLOR: neutral daylight indoor tone with honest contrast, low saturation close to documentary colour, whites read white where clean and grey where soiled; no pink or warm cast on the object.";

export function slideSpot(brief: string): string | undefined {
  const match = brief.match(/checkpoint \d+: ([^.]+)\./);
  return match?.[1]?.trim();
}

export interface DoctrinePromptInput {
  date: string;
  spec: Pick<ObjectSpec, "noun" | "material" | "wear">;
  wearKind: string;
  spots: string[];
  passport: string;
  briefs: string[];
  sameGarment: string;
}

/** Full four-slide prompt set in doctrine order: passport, wear first, optics, station, framing, light, style, lens, colour, brief, negatives. */
export function buildDoctrinePrompts(input: DoctrinePromptInput): string[] {
  const family = objectFamily(input.spec);
  const station = sceneStationForDate(input.date);
  const tool = familyTool(family);
  const opening = needsOpening(input.spots, input.spec.wear);
  const subject = `${input.passport} ${wearMechanism(input.wearKind, input.spots, input.spec.wear)} ${materialOptics(input.spec)}`;
  const shared = `${subject} ${station.lock} Create one portrait 4:5 photo. Keep the exact featured object consistent across all four photos. ${station.location}`;
  return input.briefs.map((brief, index) => {
    const slide = index + 1;
    const spot = slideSpot(brief);
    const macro = slide > 1 && (Boolean(spot) || slide === 3);
    const continuity = slide === 1 ? "" : ` ${input.sameGarment}.`;
    return [
      shared,
      compositionBlock(slide, spot, opening, tool),
      LIGHTING_BLOCK,
      STYLE_BLOCK,
      cameraBlock(slide, macro),
      COLOR_BLOCK,
      `Photo ${slide} of 4.${continuity} ${brief.replace("Keep the entire object readable", "Keep the object recognizable even when cropped")}`,
      familyNegatives(family)
    ].join(" ");
  });
}
