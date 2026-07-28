import { access } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

// The concept list is the thing that gets iterated, so it lives in code where a
// change is reviewable and a regeneration can be scoped to one concept. Chasing
// a weak Reel by regenerating all twelve stills wastes the eleven that worked.
//
// Scripts are in docs/reels-concepts.md. This carries what the pipeline needs:
// which stills belong to which concept, and what each still is meant to show.

export interface ReelConcept {
  id: string;
  object_type: string;
  hook: string;
  close: string;
  narration: string;
  before_subject: string;
  after_subject: string;
}

export const REEL_CONCEPTS: ReelConcept[] = [
  {
    id: "white-shoe-yellowing",
    object_type: "white-shoe",
    hook: "白鞋泛黃，不是刷得不夠用力",
    close: "台中收送，拍給我們看能不能救",
    narration:
      "白鞋泛黃，問題常在中底和鞋邊。硬刷只會起毛，拍給我們先幫你判斷。",
    before_subject:
      "one pair of unbranded white sneakers, midsole edge and rubber trim visibly greyed and yellowed",
    after_subject:
      "the same sneakers, same position, midsole and trim clean, canvas still showing normal wear"
  },
  {
    id: "handbag-handle",
    object_type: "handbag",
    hook: "包包最先變舊的地方，是提把",
    close: "提把開始發黏就可以私訊我們",
    narration:
      "包包最先變舊的是提把。那不是灰塵，是手汗堆的，發黏前處理比較好救。",
    before_subject:
      "one everyday unbranded handbag, the handle darkened and slightly glossy where it is gripped",
    after_subject: "the same handbag, same position, handle restored to matte even colour"
  },
  {
    id: "leather-shoe-rain",
    object_type: "leather-shoe",
    hook: "皮鞋淋雨，擦乾就沒事了嗎",
    close: "別急著上油，先拍給我們看",
    narration:
      "皮鞋淋過雨，水痕會過幾天才浮出來。先別上油，先拍給我們看。",
    before_subject: "one pair of unbranded leather dress shoes, faint dried rain marks across both vamps",
    after_subject: "the same shoes, same position, rain marks gone, leather evenly toned and not glossy"
  },
  {
    id: "plush-doll",
    object_type: "plush-doll",
    hook: "娃娃不是不能洗，是不能亂洗",
    close: "家裡有不敢洗的娃娃？私訊我們",
    narration: "娃娃可以洗，但不能當一般衣服洗。填充和五官最怕脫水那一段。",
    before_subject: "one unbranded plush toy, fur flattened and dulled grey",
    after_subject: "the same toy, same position, fur lifted and clean, stitching and features unchanged"
  },
  {
    id: "duvet-storage",
    object_type: "duvet",
    hook: "棉被收進櫃子前，先聞一下",
    close: "換季前想清一次？台中收送",
    narration:
      "棉被收櫃前先聞一下。帶著濕氣收，下一季就是那個味道。",
    before_subject:
      "one folded duvet with a fabric storage bag beside it, cover slightly limp and dull",
    after_subject: "the same duvet, same position, cover clean and evenly pressed"
  },
  {
    id: "leather-bag-corner",
    object_type: "leather-bag",
    hook: "精品包最怕的不是髒，是邊角",
    close: "邊角開始磨就該處理了",
    narration: "精品包最先出問題的是邊角。邊油磨掉補不回來，要在磨穿前處理。",
    before_subject: "a close view of one unbranded leather bag corner, edge coating worn and abraded",
    after_subject: "the same corner, same angle, edge treated and even, wear honestly reduced not erased"
  }
];

// Kept identical across every still so that separate generation sessions still
// cut together, and so that a single regenerated still drops back into a pair
// without the join showing.
export const SHARED_STILL_PROMPT =
  "Ordinary square shop photo for 私享家洗衣店. [SUBJECT] on the inspection counter of a Taiwanese " +
  "laundry and item-care shop. Shot on a phone by shop staff, handheld with slight natural camera shake " +
  "and imperfect framing, tiled floor and metal racks visible, soft fluorescent ceiling light mixed with " +
  "cool window daylight from the left at roughly 4500K, consistent shadow direction, realistic material " +
  "texture with genuine wear, everyday clutter at the edge of frame. No laundry basket, no washing " +
  "machine, no domestic living room, no shopfront. Not cinematic, not studio lighting, not glossy, not " +
  "perfectly symmetrical, no stock-photo feel, no dramatic colour grade. No brand name, no logo, no " +
  "readable text, no watermark, no faces.";

export function stillPathsFor(concept: ReelConcept): { before: string; after: string } {
  return {
    before: `data/reference-photos/${concept.object_type}/${concept.id}-before.png`,
    after: `data/reference-photos/${concept.object_type}/${concept.id}-after.png`
  };
}

export function promptFor(concept: ReelConcept, state: "before" | "after"): string {
  const subject = state === "before" ? concept.before_subject : concept.after_subject;
  return SHARED_STILL_PROMPT.replace("[SUBJECT]", subject);
}

export interface ConceptStatus {
  id: string;
  object_type: string;
  hook: string;
  has_before: boolean;
  has_after: boolean;
  ready: boolean;
}

export async function conceptStatuses(root = projectRoot()): Promise<ConceptStatus[]> {
  const statuses: ConceptStatus[] = [];

  for (const concept of REEL_CONCEPTS) {
    const paths = stillPathsFor(concept);
    const exists = async (relative: string) => {
      try {
        await access(join(root, ...relative.split("/")));
        return true;
      } catch {
        return false;
      }
    };
    const hasBefore = await exists(paths.before);
    const hasAfter = await exists(paths.after);
    statuses.push({
      id: concept.id,
      object_type: concept.object_type,
      hook: concept.hook,
      has_before: hasBefore,
      has_after: hasAfter,
      ready: hasBefore && hasAfter
    });
  }

  return statuses;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = getOption(args, "concept");
  const wantPrompts = getFlag(args, "prompts");
  const root = projectRoot(getOption(args, "root"));

  const statuses = await conceptStatuses(root);
  const selected = only ? REEL_CONCEPTS.filter((concept) => concept.id === only) : REEL_CONCEPTS;
  if (only && selected.length === 0) {
    throw new Error(`Unknown concept: ${only}. Known: ${REEL_CONCEPTS.map((c) => c.id).join(", ")}`);
  }

  if (wantPrompts) {
    // Regenerating one concept is the normal iteration, so the prompts print
    // per concept rather than as one undifferentiated batch.
    for (const concept of selected) {
      const paths = stillPathsFor(concept);
      console.log(`\n=== ${concept.id} (${concept.object_type}) ===`);
      console.log(`hook: ${concept.hook}`);
      console.log(`\n[before] -> ${paths.before}\n${promptFor(concept, "before")}`);
      console.log(`\n[after]  -> ${paths.after}\n${promptFor(concept, "after")}`);
    }
    return;
  }

  console.log(
    JSON.stringify(
      {
        total: statuses.length,
        ready: statuses.filter((status) => status.ready).length,
        concepts: only ? statuses.filter((status) => status.id === only) : statuses
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
