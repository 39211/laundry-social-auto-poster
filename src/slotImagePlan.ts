import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadImagePromptManifest, manifestEntryFor } from "./imageStamp";
import { loadDailyContent } from "./logging";
import { imageAssetsForSlot, type SlotImageAsset } from "./mediaAssets";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// What one day's calendar still needs generated, in a form the hermes-Grok
// driver (scripts/hermes-image-gen.py) can execute without re-deriving any
// decision. The split is deliberate: everything that decides WHAT to generate
// (which files are missing, which prompt certifies each file, which image
// anchors a slot's identity) lives here where vitest can hold it still; the
// driver only executes the plan.
//
// Prompts come from the image-prompts manifest, not from the calendar directly,
// because the approval gate's prompt_sha256 check certifies manifest prompts --
// generating from any other text would produce an image whose recorded prompt
// is not the prompt that made it.

/**
 * Appended to every generation prompt at plan time. Two systematic Grok
 * image-model failures made this mandatory (2026-08-24, six of six heroes
 * violated house rules before it existed): Chinese topic strings get rendered
 * as in-scene signage or captions, and background products grow Nike/Vans
 * trademarks. The suffix lives here and only here -- the driver must never
 * append its own copy, and the manifest keeps the un-suffixed prompt so
 * existing prompt_sha256 stamps stay valid.
 */
export const IMAGE_GUARD_SUFFIX =
  "ABSOLUTELY no text of any kind anywhere in the image: no signs, placards, posters, captions, " +
  "subtitles, handwriting or printed labels. Every item in frame including all background items and " +
  "products is completely unbranded and generic: no logos, no swooshes, no brand stripes, no trademark-like marks.";

// The double-append check keys on the suffix's opening words so a manifest that
// one day embeds the guard itself (or a re-run over a plan file) cannot stack
// two copies and dilute the prompt.
const GUARD_MARKER = "ABSOLUTELY no text of any kind";

export interface SlotImagePlanItem {
  slot: number;
  slide: number;
  role: "hero" | "edit";
  target_path: string;
  public_image_url: string;
  /** Repo-relative path of the slot's identity anchor. Edits only. */
  base_path?: string;
  /**
   * Edits only: true when the anchor already exists on disk (the driver edits
   * from that final), false when the anchor is the hero being generated in
   * this same run (the driver edits from the hero's raw output for fidelity).
   */
  base_exists?: boolean;
  prompt: string;
}

export interface SlotImagePlan {
  date: string;
  generated_at: string;
  items: SlotImagePlanItem[];
  blockers: string[];
}

async function fileHasBytes(root: string, relPath: string): Promise<boolean> {
  try {
    return (await stat(join(root, ...relPath.split("/")))).size > 0;
  } catch {
    return false;
  }
}

export function withGuardSuffix(prompt: string): string {
  if (prompt.includes(GUARD_MARKER)) return prompt;
  return `${prompt}\n\n${IMAGE_GUARD_SUFFIX}`;
}

export async function buildSlotImagePlan(date: string, root = projectRoot()): Promise<SlotImagePlan> {
  const content = await loadDailyContent(date, root);
  if (!content) {
    throw new Error(`No content calendar for ${date}; nothing to plan.`);
  }
  if ((content as { tampered?: boolean }).tampered) {
    throw new Error(`Calendar for ${date} failed integrity inspection; refusing to plan images from it.`);
  }

  const blockers: string[] = [];
  const items: SlotImagePlanItem[] = [];

  const manifest = await loadImagePromptManifest(root, date);
  if (!manifest) {
    // Without the manifest there is no certified prompt for any file, and an
    // image generated from an uncertified prompt can never pass approval.
    blockers.push(`image-prompts manifest for ${date} is missing or unreadable; run generate-image-manifest first`);
    return { date, generated_at: new Date().toISOString(), items, blockers };
  }

  for (const slot of content.slots) {
    let assets: SlotImageAsset[];
    try {
      assets = imageAssetsForSlot(slot);
    } catch (error) {
      blockers.push(`slot ${slot.slot}: ${(error as Error).message}`);
      continue;
    }
    if (assets.length === 0) continue;

    const missing: SlotImageAsset[] = [];
    for (const asset of assets) {
      if (!(await fileHasBytes(root, asset.local_image_path))) missing.push(asset);
    }
    if (missing.length === 0) continue;

    // imageAssetsForSlot returns slides sorted ascending; the lowest slide is
    // the slot's identity anchor. Every other slide is generated as an edit of
    // it so a carousel shows one object, not four cousins.
    const anchor = assets[0];
    if (!anchor) continue;
    const anchorMissing = missing.some((asset) => asset.local_image_path === anchor.local_image_path);

    const prompts = new Map<string, string>();
    let slotBlocked = false;
    for (const asset of missing) {
      const entry = manifestEntryFor(manifest, asset.local_image_path, slot.slot);
      if (typeof entry?.prompt !== "string" || entry.prompt.trim() === "") {
        blockers.push(
          `slot ${slot.slot} ${asset.local_image_path} has no unique manifest prompt entry; regenerate the manifest before generating`
        );
        slotBlocked = true;
        continue;
      }
      prompts.set(asset.local_image_path, entry.prompt);
    }
    // A slot missing its anchor prompt can never complete, and a partially
    // generated carousel is worse than an absent one -- approval would block it
    // anyway, so do not spend generations on a slot that cannot finish.
    if (slotBlocked) continue;

    for (const asset of missing) {
      const isAnchor = asset.local_image_path === anchor.local_image_path;
      const item: SlotImagePlanItem = {
        slot: slot.slot,
        slide: asset.slide,
        role: isAnchor && anchorMissing ? "hero" : "edit",
        target_path: asset.local_image_path,
        public_image_url: asset.public_image_url,
        prompt: withGuardSuffix(prompts.get(asset.local_image_path) ?? "")
      };
      if (item.role === "edit") {
        item.base_path = anchor.local_image_path;
        item.base_exists = !anchorMissing;
      }
      items.push(item);
    }
  }

  // Hero-before-edits within each slot, slots in calendar order. The driver
  // consumes the list sequentially, so this ordering IS the contract that the
  // identity anchor exists before anything tries to edit from it.
  items.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot - b.slot;
    if (a.role !== b.role) return a.role === "hero" ? -1 : 1;
    return a.slide - b.slide;
  });

  return { date, generated_at: new Date().toISOString(), items, blockers };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  const outPath = getOption(args, "out");

  const plan = await buildSlotImagePlan(date, root);
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  console.log(`PLAN ${date}: ${plan.items.length} image(s) to generate, ${plan.blockers.length} blocker(s).`);
  for (const blocker of plan.blockers) {
    console.log(`BLOCKER ${blocker}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
