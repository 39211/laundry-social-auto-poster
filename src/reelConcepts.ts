import { access } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

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
  /**
   * Spoken from 0.5s while the hook is burned in as a subtitle for the first
   * 2.6 seconds. It therefore must not restate the hook: the viewer would read
   * and hear the same sentence at once, which spends the only seconds that
   * decide whether they keep watching. It continues the thought instead.
   */
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
      "問題多半在中底和鞋邊，那裡是材質在氧化。越用力刷，布面越容易起毛。",
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
      "那不是灰塵，是手汗一天一天堆起來的。等到摸起來發黏，就比較難救了。",
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
      "水痕通常過幾天才浮出來。這時候上油，等於把它鎖進皮裡面。",
    before_subject: "one pair of unbranded leather dress shoes, faint dried rain marks across both vamps",
    after_subject: "the same shoes, same position, rain marks gone, leather evenly toned and not glossy"
  },
  {
    id: "plush-doll",
    object_type: "plush-doll",
    hook: "娃娃不是不能洗，是不能亂洗",
    close: "家裡有不敢洗的娃娃？私訊我們",
    narration: "怕的不是水，是脫水那一段。填充會結塊，黏上去的五官也可能掉。",
    before_subject: "one unbranded plush toy, fur flattened and dulled grey",
    after_subject: "the same toy, same position, fur lifted and clean, stitching and features unchanged"
  },
  {
    id: "duvet-storage",
    object_type: "duvet",
    hook: "棉被收進櫃子前，先聞一下",
    close: "換季前想清一次？台中收送",
    narration:
      "摸起來乾，中間那層不一定乾。帶著濕氣收進去，下一季就是那個味道。",
    before_subject:
      "one folded duvet with a fabric storage bag beside it, cover slightly limp and dull",
    after_subject: "the same duvet, same position, cover clean and evenly pressed"
  },
  {
    id: "leather-bag-corner",
    object_type: "leather-bag",
    hook: "精品包最怕的不是髒，是邊角",
    close: "邊角開始磨就該處理了",
    narration: "邊油磨掉就補不回來了。能處理的時間，比大部分人想的短很多。",
    before_subject: "a close view of one unbranded leather bag corner, edge coating worn and abraded",
    after_subject: "the same corner, same angle, edge treated and even, wear honestly reduced not erased"
  },

  // Batch two. Produced during batch one's run so 2026-08-04 follows without a
  // gap, and drawn from six more of the shop's real service pages so no object
  // type repeats across twelve days.
  {
    id: "shirt-collar",
    object_type: "shirt",
    hook: "襯衫領口發黃，洗衣精加倍沒有用",
    close: "領口開始黃就可以私訊我們",
    narration: "那不是沒洗乾淨，是皮脂氧化了。加倍的洗衣精只會把布洗薄。",
    before_subject: "one white dress shirt laid flat, collar band and inner collar edge yellowed",
    after_subject: "the same shirt, same position, collar even and clean, fabric still showing normal wear"
  },
  {
    id: "suit-shoulder",
    object_type: "suit",
    hook: "西裝變形，通常從肩線開始",
    close: "收起來前想檢查？台中收送",
    narration: "掛錯衣架、擠在衣櫃裡，肩襯塌下去就回不來了。那比髒更難處理。",
    before_subject: "one suit jacket on a padded hanger, shoulder line collapsed and lapel edge creased",
    after_subject: "the same jacket, same hanger and position, shoulder line restored and lapel flat"
  },
  {
    id: "curtain-hem",
    object_type: "curtain",
    hook: "窗簾最髒的地方，你可能沒看過",
    close: "整片窗簾不用自己拆，我們收",
    narration: "下緣那一折，灰塵和濕氣都積在裡面。摸起來乾，味道其實藏在那裡。",
    before_subject: "the lower hem section of one curtain panel spread on the counter, dust ingrained along the fold",
    after_subject: "the same hem section, same position, dust removed and fabric evenly toned"
  },
  {
    id: "luggage-wheel",
    object_type: "luggage",
    hook: "行李箱收進櫃子前，先看輪子",
    close: "旅行回來想清一次？私訊我們",
    narration: "輪子和底板整趟旅程都在地上磨。帶著那些灰收進櫃子，下次就是那個味道。",
    before_subject: "one fabric suitcase on a floor mat, wheels and lower panel visibly grimy",
    after_subject: "the same suitcase, same position, wheels and lower panel clean, fabric still worn"
  },
  {
    id: "backpack-base",
    object_type: "backpack",
    hook: "後背包底部，是全包最髒的一面",
    close: "背了一年沒洗過？私訊我們",
    narration: "它天天放在地上，卻幾乎沒人洗過。背帶的汗和底部的灰，是兩種不同的髒。",
    before_subject: "one fabric backpack tipped to show its base, ground grime across the bottom panel",
    after_subject: "the same backpack, same angle, base panel clean, straps and fabric still worn"
  },
  {
    id: "canvas-shoe-mud",
    object_type: "canvas-shoe",
    hook: "帆布鞋沾泥，越用力刷越糟",
    close: "沾到泥先別刷，拍給我們看",
    narration: "濕的時候刷，泥會被推進織紋裡，布面也會起毛。等乾了再處理反而好救。",
    before_subject: "one pair of canvas shoes with dried mud worked into the woven fabric",
    after_subject: "the same shoes, same position, mud gone, canvas texture intact and not fluffed"
  }
];

// The batch the schedule is currently publishing. Production runs one batch
// ahead: while these six publish, the next six are being made.
export const BATCH_ONE = REEL_CONCEPTS.slice(0, 6).map((concept) => concept.id);
export const BATCH_TWO = REEL_CONCEPTS.slice(6).map((concept) => concept.id);

// Which day each concept publishes. This lives beside the concepts because
// production order has to follow it: daily production must always build the
// one that runs out first, not the next one in the list. The two orders are
// deliberately different — publishing alternates object types so consecutive
// days do not look alike — so following the list would build the least urgent
// concept first and a single failed day would land on a publishing date.
export const REEL_SCHEDULE: Array<{ date: string; conceptId: string }> = [
  { date: "2026-07-29", conceptId: "leather-bag-corner" },
  { date: "2026-07-30", conceptId: "plush-doll" },
  { date: "2026-07-31", conceptId: "leather-shoe-rain" },
  { date: "2026-08-01", conceptId: "white-shoe-yellowing" },
  { date: "2026-08-02", conceptId: "handbag-handle" },
  { date: "2026-08-03", conceptId: "duvet-storage" },
  { date: "2026-08-04", conceptId: "shirt-collar" },
  { date: "2026-08-05", conceptId: "luggage-wheel" },
  { date: "2026-08-06", conceptId: "canvas-shoe-mud" },
  { date: "2026-08-07", conceptId: "suit-shoulder" },
  { date: "2026-08-08", conceptId: "backpack-base" },
  { date: "2026-08-09", conceptId: "curtain-hem" }
];

export function publishDateFor(conceptId: string): string | undefined {
  return REEL_SCHEDULE.find((entry) => entry.conceptId === conceptId)?.date;
}

export interface ProductionRunway {
  today: string;
  last_scheduled_date: string;
  days_of_runway: number;
  scheduled_unproduced: number;
  needs_new_concepts: boolean;
}

/**
 * How many more days of Reels are scheduled. Production goes quiet once every
 * concept is built, and a quiet daily task looks exactly like a healthy one, so
 * the runway is reported rather than inferred from silence: writing six more
 * concepts takes a sitting, but only if someone knows it is due.
 */
export async function productionRunway(
  today: string,
  root = projectRoot(),
  warnBelowDays = 14
): Promise<ProductionRunway> {
  const remaining = REEL_SCHEDULE.filter((entry) => entry.date >= today);
  const last = REEL_SCHEDULE[REEL_SCHEDULE.length - 1]?.date ?? today;

  let unproduced = 0;
  for (const entry of remaining) {
    try {
      await access(join(root, "output", "reels-run", "2026-07-29", "reels", `${entry.conceptId}.mp4`));
    } catch {
      unproduced += 1;
    }
  }

  return {
    today,
    last_scheduled_date: last,
    days_of_runway: remaining.length,
    scheduled_unproduced: unproduced,
    needs_new_concepts: remaining.length < warnBelowDays
  };
}

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
  close: string;
  narration: string;
  publish_date?: string;
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
      close: concept.close,
      narration: concept.narration,
      publish_date: publishDateFor(concept.id),
      has_before: hasBefore,
      has_after: hasAfter,
      ready: hasBefore && hasAfter
    });
  }

  // Production order is deadline order. An unscheduled concept sorts last: it
  // has no date to miss.
  return statuses.sort((a, b) => (a.publish_date ?? "9999").localeCompare(b.publish_date ?? "9999"));
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

  const today = getOption(args, "today") ?? getZonedDateParts(new Date(), getConfig().timezone).date;
  console.log(
    JSON.stringify(
      {
        total: statuses.length,
        ready: statuses.filter((status) => status.ready).length,
        runway: await productionRunway(today, root),
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
