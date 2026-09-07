/**
 * Object library: variety for everyday items and trade-dress passports for
 * luxury classics (owner directive 2026-09-07: "客人每天洗的襯衫、T恤、logo、
 * 圖示都不一樣;鞋子有不同款式、不同品牌;精品經典款很多人買就有清洗需求,
 * 要站在客人角度推").
 *
 * Two mechanisms:
 *   1. LUXURY: a brand or model word in the topic (香奈兒/愛馬仕/Gucci/風衣/髒髒鞋…)
 *      selects a fixed passport that describes the item by *shape, material and
 *      hardware* — never by printed letters (形不靠字; docs-internal luxury study
 *      2026-08-27: AI renders letters badly and letters are the trademark).
 *   2. VARIETY: generic topics (鞋/球鞋/襯衫/T恤/包/外套) rotate through a list of
 *      concrete variants by date, so the feed stops showing the same grey
 *      sneaker and the same white shirt every time.
 *
 * Every shoe/bag variant carries the NO_MARK clause: Codex tends to stamp faint
 * cursive pseudo-text on tongues and insoles unless every surface is declared
 * blank (CODEX_MARK_HABIT, 2026-08-27).
 */

export type LibraryFamily = "shoe" | "bag" | "garment" | "bedding";

export interface ObjectVariant {
  id: string;
  family: LibraryFamily;
  /** exactly-one noun phrase used in the passport */
  noun: string;
  material: string;
  lockNote: string;
  wearFallback: string;
  luxury?: boolean;
}

export const NO_MARK_CLAUSE =
  "every surface is blank: no printed, embossed, woven or stitched marks, letters or emblems of any size on the tongue, heel, side panels, insole, lining or sole";

const BAG_NO_MARK =
  "no printed or embossed letters anywhere; hardware is plain polished metal with no engraving";

/* ------------------------------------------------------------------ */
/* Luxury classics — trade dress by shape, material and hardware only. */
/* ------------------------------------------------------------------ */

export interface LuxuryRule {
  match: RegExp;
  variant: ObjectVariant;
}

export const LUXURY_RULES: LuxuryRule[] = [
  {
    match: /(香奈兒|chanel).*(芭蕾|平底|娃娃鞋)|(芭蕾|平底|娃娃鞋).*(香奈兒|chanel)/i,
    variant: {
      id: "two-tone-ballet-flats",
      family: "shoe",
      luxury: true,
      noun: "pair of beige lambskin ballet flats with rounded black leather toe caps and a thin black bow at the vamp",
      material: "beige lambskin with black leather toe caps, thin leather sole",
      lockNote: `object locked as two-tone beige-and-black ballet flats; ${NO_MARK_CLAUSE}`,
      wearFallback: "grey scuffing along the black toe caps, darkened beige at the heel edge, creased vamp"
    }
  },
  {
    match: /(香奈兒|chanel).*(鞋|slingback|包頭)|(雙色鞋|米黑鞋)/i,
    variant: {
      id: "two-tone-slingback",
      family: "shoe",
      luxury: true,
      noun: "pair of beige goatskin slingback pumps with round black grosgrain toe caps, a 65mm block heel and an elastic back strap",
      material: "beige goatskin body with ribbed black grosgrain toe caps, leather sole",
      lockNote: `object locked as beige-and-black two-tone slingbacks with a block heel, not a pointed stiletto; ${NO_MARK_CLAUSE}`,
      wearFallback: "frayed grosgrain at the toe-cap edge, greyed beige along the topline, a slack back strap"
    }
  },
  {
    match: /(香奈兒|chanel).*(包|flap)|菱格.*(包|鏈)/i,
    variant: {
      id: "quilted-chain-flap-bag",
      family: "bag",
      luxury: true,
      noun: "black diamond-quilted lambskin flap bag with a gold chain strap threaded with black leather and a plain rectangular gold turn-lock",
      material: "black diamond-quilted lambskin, gold-tone chain with leather threading",
      lockNote: `object locked as one black quilted chain flap bag; ${BAG_NO_MARK}`,
      wearFallback: "flattened quilting and shine at the bottom corners, worn leather threading where the chain rubs, faint scratches on the turn-lock"
    }
  },
  {
    match: /(愛馬仕|hermes|hermès).*(涼鞋|拖鞋|oran)|(涼鞋|拖鞋).*(愛馬仕|hermes|hermès)/i,
    variant: {
      id: "h-cutout-slide-sandals",
      family: "shoe",
      luxury: true,
      noun: "pair of flat tan calfskin slide sandals whose single wide strap is cut into a rounded H-shaped opening over the foot, with a natural leather footbed",
      material: "smooth tan calfskin strap, natural leather footbed, thin leather sole",
      lockNote: `object locked as tan flat slide sandals with an H-shaped strap cut-out; ${NO_MARK_CLAUSE}`,
      wearFallback: "dark foot prints on the leather footbed, greyed edge paint along the strap, dust in the strap cut-out"
    }
  },
  {
    match: /(愛馬仕|hermes|hermès).*(樂福|平底|皮鞋)|(樂福|皮鞋).*(愛馬仕|hermes|hermès)/i,
    variant: {
      id: "gold-buckle-loafers",
      family: "shoe",
      luxury: true,
      noun: "pair of black box-calf loafers with one polished gold rectangular buckle across the vamp",
      material: "glossy black box-calf leather, leather sole",
      lockNote: `object locked as black leather loafers with a plain gold rectangular buckle; ${NO_MARK_CLAUSE}`,
      wearFallback: "dull grey film and fine creases across the vamp, scuffed toe caps, tarnished buckle"
    }
  },
  {
    match: /(愛馬仕|hermes|hermès|柏金|凱莉).*(包)|(包).*(愛馬仕|hermes|hermès)/i,
    variant: {
      id: "belted-top-handle-bag",
      family: "bag",
      luxury: true,
      noun: "structured tan pebbled-leather top-handle bag with two rolled handles, a front flap closed by two belted straps over a plain turn-lock plate, and a small padlock",
      material: "tan pebbled togo-style leather, palladium-tone plain hardware, hand-painted edge paint",
      lockNote: `object locked as one tan structured belted top-handle bag; ${BAG_NO_MARK}`,
      wearFallback: "darkened handles from hand oil, whitened bottom corners where the edge paint wore off, scratches on the plate"
    }
  },
  {
    match: /(lv|路易威登|louis vuitton|neverfull).*(包|托特)|(包|托特).*(lv|路易威登|louis vuitton)/i,
    variant: {
      id: "coated-canvas-tote",
      family: "bag",
      luxury: true,
      noun: "large brown coated-canvas tote with natural untreated vachetta leather trim and handles, side laces and an open top",
      material: "brown coated canvas kept as a plain even texture, honey-tan vachetta leather trim",
      lockNote: `object locked as one brown coated-canvas tote with tan leather trim; the canvas reads as a plain texture with no repeating emblem; ${BAG_NO_MARK}`,
      wearFallback: "vachetta handles darkened to a deep honey with dark grip patches, water spots on the trim, cracked canvas at the bottom corners"
    }
  },
  {
    match: /(gucci|古馳|馬銜|horsebit).*(鞋|樂福)|(樂福).*(gucci|古馳|馬銜)/i,
    variant: {
      id: "horsebit-loafers",
      family: "shoe",
      luxury: true,
      noun: "pair of black smooth-leather loafers with a gold horsebit — two metal rings joined by a straight bar — across the vamp",
      material: "smooth black calfskin, gold-tone horsebit hardware, leather sole",
      lockNote: `object locked as black leather horsebit loafers (rings and bar, not a chain, not a buckle); ${NO_MARK_CLAUSE}`,
      wearFallback: "deep creases across the vamp, dull scratched horsebit, greyed toe caps, worn sole edge"
    }
  },
  {
    match: /(gucci|古馳).*(包)|(包).*(gucci|古馳)/i,
    variant: {
      id: "web-stripe-shoulder-bag",
      family: "bag",
      luxury: true,
      noun: "beige canvas shoulder bag with a green-red-green striped fabric band down the front, tan leather trim and a horsebit clasp",
      material: "beige woven canvas, green-red-green striped web, tan leather trim",
      lockNote: `object locked as one beige canvas bag with a green-red-green web stripe; ${BAG_NO_MARK}`,
      wearFallback: "greyed canvas at the base, frayed web edge, darkened leather trim at the corners"
    }
  },
  {
    match: /(dior|迪奧|黛妃|籐格).*(包)|(包).*(dior|迪奧)/i,
    variant: {
      id: "cane-quilted-top-handle-bag",
      family: "bag",
      luxury: true,
      noun: "black lambskin top-handle bag quilted in a woven-cane lattice pattern, with two short handles and small plain metal charms on the handle",
      material: "black lambskin with cane-lattice quilting, gold-tone plain hardware",
      lockNote: `object locked as one black cane-quilted top-handle bag; the charms are plain shapes; ${BAG_NO_MARK}`,
      wearFallback: "flattened quilting at the corners, shine on the handles, faint scratches on the charms"
    }
  },
  {
    match: /風衣|trench|burberry|巴寶莉/i,
    variant: {
      id: "gabardine-trench",
      family: "garment",
      luxury: true,
      noun: "honey-beige cotton gabardine trench coat with epaulettes, a storm flap, a belted waist and a check-lined collar folded so the lining shows only as a soft blur",
      material: "densely woven honey-beige cotton gabardine with horn-look buttons",
      lockNote: "object locked as one beige gabardine trench coat; no printed letters anywhere; the lining is out of focus",
      wearFallback: "oil darkening on the inside collar and cuffs, grey grime along the belt and pocket edges, creased storm flap"
    }
  },
  {
    match: /(精品|moncler|盟可睞|羽絨).*(羽絨|外套|夾克).*(精品|moncler|盟可睞)|(moncler|盟可睞)/i,
    variant: {
      id: "glossy-down-jacket",
      family: "garment",
      luxury: true,
      noun: "glossy black nylon down jacket with narrow horizontal quilting, a blank fabric patch on the upper left sleeve and a two-way zip",
      material: "high-gloss black nylon shell with dense narrow quilting",
      lockNote: "object locked as one glossy black quilted down jacket; the sleeve patch is a plain blank shape with no letters or figures",
      wearFallback: "oil sheen and greying on the cuffs and collar, flattened chest channels, dull patches where the gloss wore off"
    }
  },
  {
    match: /(ugg|雪靴|羊毛靴)/i,
    variant: {
      id: "sheepskin-boots",
      family: "shoe",
      luxury: true,
      noun: "pair of chestnut sheepskin ankle boots with a suede shaft, a creamy wool cuff and a flat foam sole",
      material: "chestnut suede sheepskin with cream wool lining, lightweight foam sole",
      lockNote: `object locked as chestnut sheepskin boots; ${NO_MARK_CLAUSE}`,
      wearFallback: "water stains and salt lines on the suede, matted greyed wool at the cuff, a slumped shaft"
    }
  },
  {
    match: /(髒髒鞋|小髒鞋|golden goose|做舊球鞋|做舊款)/i,
    variant: {
      id: "distressed-star-sneakers",
      family: "shoe",
      luxury: true,
      noun: "pair of white leather low-top sneakers with a large suede five-point star on each side panel, a factory-distressed grey toe and a grey rubber sole",
      material: "white calf leather with suede star patch, intentionally scuffed toe, grey rubber sole",
      lockNote: `object locked as white distressed star sneakers; apart from the star shape, ${NO_MARK_CLAUSE}`,
      wearFallback: "real grey grime on the laces and inside the collar lining on top of the factory distressing, dark sweat marks on the insole"
    }
  },
  {
    match: /(longchamp|瓏驤|摺疊包|尼龍摺疊|餃子包)/i,
    variant: {
      id: "nylon-fold-tote",
      family: "bag",
      luxury: true,
      noun: "navy nylon foldable tote with a brown leather flap closure, rounded brown leather handles and a small snap tab",
      material: "crisp navy nylon canvas with smooth brown cowhide trim",
      lockNote: `object locked as one navy nylon fold-up tote with brown leather trim; the flap is plain leather with no embossed figure; ${BAG_NO_MARK}`,
      wearFallback: "greyed nylon at the bottom corners with the coating worn through, darkened leather handles, a frayed flap edge"
    }
  },
  {
    match: /(勃肯|birkenstock|軟木涼鞋|軟木拖鞋)/i,
    variant: {
      id: "cork-footbed-sandals",
      family: "shoe",
      luxury: true,
      noun: "pair of taupe suede two-strap sandals on a contoured cork footbed with a brown buckle on each strap and a flat tan sole",
      material: "taupe suede straps, natural cork footbed with a suede liner, EVA sole",
      lockNote: `object locked as taupe two-strap cork-footbed sandals; ${NO_MARK_CLAUSE}`,
      wearFallback: "dark foot prints pressed into the suede footbed, cork edge sealant flaking and darkened, greyed strap edges"
    }
  },
  {
    match: /(加拿大鵝|canada goose|派克大衣|長版羽絨|羽絨派克)/i,
    variant: {
      id: "down-parka",
      family: "garment",
      luxury: true,
      noun: "black matte down parka with a coyote-colour faux-fur hood trim, a blank round fabric patch on the upper left sleeve and a two-way front zip",
      material: "matte black poly-cotton shell with wide quilting, tan fur-look hood trim",
      lockNote: "object locked as one black matte down parka with a fur-trimmed hood; the sleeve patch is a plain blank disc with no letters or figures",
      wearFallback: "oil sheen and grey grime on the cuffs and inside collar, flattened quilting at the elbows, matted greyed fur trim"
    }
  },
  {
    match: /(喀什米爾|cashmere|羊絨).*(毛衣|針織)|(毛衣|針織).*(喀什米爾|cashmere|羊絨)/i,
    variant: {
      id: "cashmere-sweater",
      family: "garment",
      luxury: true,
      noun: "camel cashmere crew-neck sweater laid flat with one sleeve folded across",
      material: "fine soft camel cashmere knit with a light halo of fibres",
      lockNote: "object locked as one camel cashmere sweater; no labels or printed letters visible",
      wearFallback: "pilling on the underarms and sides, a faint darker patch at the underarm, stretched cuffs"
    }
  }
];

export function luxuryVariantForTopic(topic: string): ObjectVariant | undefined {
  return LUXURY_RULES.find((rule) => rule.match.test(topic))?.variant;
}

/* ------------------------------------------------------------------ */
/* Everyday variety — rotated by date for generic topics.              */
/* ------------------------------------------------------------------ */

export const SHOE_VARIANTS: ObjectVariant[] = [
  {
    id: "suede-leather-trainers",
    family: "shoe",
    noun: "pair of black suede-and-leather low-profile trainers with a gum rubber sole and a plain T-shaped suede toe overlay",
    material: "black suede and smooth leather upper, gum rubber sole",
    lockNote: `object locked as black low-profile suede trainers with a gum sole; ${NO_MARK_CLAUSE}`,
    wearFallback: "greyed suede at the toe, dirt in the gum sole edge, greyed laces"
  },
  {
    id: "retro-runners",
    family: "shoe",
    noun: "pair of grey suede-and-mesh retro running shoes with a plain side panel and a cream foam midsole",
    material: "grey suede overlays on grey mesh, cream EVA midsole, black rubber outsole",
    lockNote: `object locked as grey retro running shoes with plain side panels; ${NO_MARK_CLAUSE}`,
    wearFallback: "yellowed cream midsole at the toe, greyed mesh, dark insole heel print"
  },
  {
    id: "white-court-sneakers",
    family: "shoe",
    noun: "pair of white leather court sneakers with a chunky white cupsole and a plain perforated toe",
    material: "white smooth leather upper, thick white rubber cupsole",
    lockNote: `object locked as plain white leather court sneakers; ${NO_MARK_CLAUSE}`,
    wearFallback: "yellowed cupsole edge, grey creases across the toe, scuffed heel"
  },
  {
    id: "canvas-high-tops",
    family: "shoe",
    noun: "pair of black canvas high-top sneakers with a white rubber toe cap and white foxing strip",
    material: "black cotton canvas, white rubber toe cap and foxing",
    lockNote: `object locked as black canvas high-tops with a white toe cap; ${NO_MARK_CLAUSE}`,
    wearFallback: "yellowed foxing strip, faded grey canvas at the ankle, mud in the canvas weave"
  },
  {
    id: "slim-nylon-trainers",
    family: "shoe",
    noun: "pair of slim yellow-and-black nylon trainers with thin suede stripes and a low flat sole",
    material: "yellow nylon upper with black suede overlays, thin rubber sole",
    lockNote: `object locked as slim yellow nylon trainers; ${NO_MARK_CLAUSE}`,
    wearFallback: "greyed nylon at the toe, darkened suede stripes, worn heel edge"
  },
  {
    id: "trail-runners",
    family: "shoe",
    noun: "pair of black-and-grey trail running shoes with a chunky lugged sole and a quick-lace cord",
    material: "black ripstop mesh with grey TPU overlays, deep-lug rubber outsole",
    lockNote: `object locked as black trail running shoes with a lugged sole; ${NO_MARK_CLAUSE}`,
    wearFallback: "dried mud caked in the lugs, dust in the mesh, salt marks on the collar"
  },
  {
    id: "kids-velcro-sneakers",
    family: "shoe",
    noun: "pair of small kids sneakers with two velcro straps, a blue mesh upper and a white foam sole",
    material: "blue synthetic mesh with velcro straps, white EVA sole",
    lockNote: `object locked as blue kids velcro sneakers; ${NO_MARK_CLAUSE}`,
    wearFallback: "grey grime on the velcro straps, dark insole prints, scuffed toe bumper"
  },
  {
    id: "foam-clogs",
    family: "shoe",
    noun: "pair of light-grey moulded foam clogs with ventilation holes and a pivoting heel strap",
    material: "light-grey closed-cell foam resin",
    lockNote: `object locked as light-grey foam clogs; ${NO_MARK_CLAUSE}`,
    wearFallback: "dark grime in the ventilation holes and footbed, greyed rim, scuffed heel strap"
  }
];

export const SHIRT_VARIANTS: ObjectVariant[] = [
  {
    id: "white-oxford-shirt",
    family: "garment",
    noun: "white cotton oxford button-down shirt laid flat with the collar open",
    material: "white cotton oxford weave with a visible basket texture",
    lockNote: "object locked as one white oxford shirt, no printed letters or logos",
    wearFallback: "a yellow-grey ring inside the collar and greyed cuff edges"
  },
  {
    id: "light-blue-poplin-shirt",
    family: "garment",
    noun: "light-blue cotton poplin dress shirt laid flat with the collar open",
    material: "smooth light-blue cotton poplin",
    lockNote: "object locked as one light-blue poplin shirt, no printed letters or logos",
    wearFallback: "a darker sweat band inside the collar and oil darkening at the cuffs"
  },
  {
    id: "striped-shirt",
    family: "garment",
    noun: "blue-and-white fine-striped cotton shirt laid flat with the collar open",
    material: "fine blue-and-white striped cotton shirting",
    lockNote: "object locked as one blue-and-white striped shirt, no printed letters or logos",
    wearFallback: "a greyed collar fold and darkened cuff edges"
  }
];

export const TEE_VARIANTS: ObjectVariant[] = [
  {
    id: "black-graphic-tee",
    family: "garment",
    noun: "black cotton tee with a large cracked white screen-print of abstract geometric shapes across the chest",
    material: "black cotton jersey, matte cracked plastisol print",
    lockNote: "object locked as one black graphic tee; the print is abstract shapes with no letters or faces",
    wearFallback: "faded grey along the shoulders and side seams, cracking in the print, a lighter deodorant band at the underarms"
  },
  {
    id: "heather-grey-patch-tee",
    family: "garment",
    noun: "heather-grey cotton tee with a small blank embroidered rectangle patch on the left chest",
    material: "heather-grey cotton-poly jersey",
    lockNote: "object locked as one heather-grey tee; the chest patch is a plain blank shape with no letters",
    wearFallback: "yellowed underarms and a darker ring inside the collar"
  },
  {
    id: "breton-stripe-tee",
    family: "garment",
    noun: "cream-and-navy horizontal-striped cotton tee with a boat neck",
    material: "heavy cream-and-navy striped cotton jersey",
    lockNote: "object locked as one striped boat-neck tee, no printed letters",
    wearFallback: "greyed cream stripes at the collar and a faint stain on the front"
  }
];

export const JACKET_VARIANTS: ObjectVariant[] = [
  {
    id: "denim-jacket",
    family: "garment",
    noun: "mid-blue cotton denim trucker jacket with copper buttons and pointed chest-pocket flaps",
    material: "mid-blue cotton denim, plain copper buttons",
    lockNote: "object locked as one blue denim jacket, no printed letters or leather label text",
    wearFallback: "darkened collar fold and cuff edges, whiskered fading at the elbows"
  },
  {
    id: "beige-work-jacket",
    family: "garment",
    noun: "beige cotton twill work jacket with a shirt collar and buttoned cuffs",
    material: "beige cotton twill",
    lockNote: "object locked as one beige cotton work jacket, not a down jacket, not a dress shirt, not a wool overcoat",
    wearFallback: "collar and cuff darkening"
  },
  {
    id: "navy-windbreaker",
    family: "garment",
    noun: "navy nylon windbreaker with a hood, a half zip and elastic cuffs",
    material: "crisp navy ripstop nylon",
    lockNote: "object locked as one navy nylon windbreaker, no printed letters",
    wearFallback: "grey grime on the inside collar and cuffs, a faint water ring on the front"
  }
];

export const BAG_VARIANTS: ObjectVariant[] = [
  {
    id: "black-nylon-backpack",
    family: "bag",
    noun: "black nylon commuter backpack with a padded laptop compartment and a top grab handle",
    material: "black ballistic nylon with plain black zips",
    lockNote: `object locked as one black nylon backpack; ${BAG_NO_MARK}`,
    wearFallback: "greyed bottom panel, darkened grab handle, frayed zip pulls"
  },
  {
    id: "natural-canvas-tote",
    family: "bag",
    noun: "natural cotton canvas tote with two flat shoulder handles",
    material: "heavy natural cotton canvas",
    lockNote: `object locked as one natural canvas tote; ${BAG_NO_MARK}`,
    wearFallback: "grey grime along the bottom seam, darkened handles, a coffee ring on the front"
  },
  {
    id: "pebbled-crossbody",
    family: "bag",
    noun: "small tan pebbled-leather crossbody bag with a flap and a thin adjustable strap",
    material: "tan pebbled leather, plain brass hardware",
    lockNote: `object locked as one small tan pebbled crossbody bag; ${BAG_NO_MARK}`,
    wearFallback: "edge paint worn off the bottom corners, darkened flap edge, scratched clasp"
  },
  {
    id: "structured-leather-tote",
    family: "bag",
    noun: "structured black saffiano-textured leather tote with two rolled handles",
    material: "black cross-hatched saffiano-textured leather",
    lockNote: `object locked as one black structured leather tote; ${BAG_NO_MARK}`,
    wearFallback: "whitened bottom corners, greyed handle grips, a scuffed base"
  }
];

/** Stable pick by date so the same generic topic gets a different variant on different days. */
export function variantForDate(list: ObjectVariant[], date: string, salt = 0): ObjectVariant {
  const n = Number(date.replace(/-/g, "")) + salt;
  return list[Math.abs(n) % list.length] ?? list[0]!;
}

export function everydayVariantForTopic(topic: string, date: string): ObjectVariant | undefined {
  if (/T恤|t-shirt|短T|短袖上衣|印花上衣/i.test(topic)) return variantForDate(TEE_VARIANTS, date, 1);
  if (/襯衫/.test(topic) && !/西裝/.test(topic)) return variantForDate(SHIRT_VARIANTS, date, 2);
  if (/外套|夾克/.test(topic) && !/羽絨|大衣|雨衣/.test(topic)) return variantForDate(JACKET_VARIANTS, date, 3);
  if (/(球鞋|運動鞋)/.test(topic) && !/白鞋|童鞋|老爹鞋|帆布|麂皮|登山|室內/.test(topic)) return variantForDate(SHOE_VARIANTS, date, 4);
  if (/(包包|背包|托特|手提袋|通勤包)/.test(topic) && !/化妝包|皮夾|錢包|精品包|名牌包/.test(topic)) return variantForDate(BAG_VARIANTS, date, 5);
  return undefined;
}
