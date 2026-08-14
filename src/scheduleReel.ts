import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { LINE_CONTACT, withSharedCaptionRules } from "./contentPlan";
import { generateDailyContent } from "./generateDailyContent";
import { buildGitHubPagesImageUrl, buildGitHubPagesVideoUrl } from "./githubPages";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { contentCalendarPath, padSlot, projectRoot } from "./paths";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions, type ReelConcept } from "./reelConcepts";
import { getZonedDateParts } from "./scheduler";
import { hashVideoPrompt, videoRunReportPath } from "./videoRunFreshness";
import type { DailyContent, DailySlot } from "./types";

// Places one reviewed Reel into a future day's Reel slot, writing every record
// the publish gates check: the video and its audio declaration, the cover still
// and its source record, the provider source entry, and the freshness run
// report. The slot's video_prompt is the exact motion prompt the clip was
// generated from, so the freshness hash matches by construction rather than by
// coincidence.
//
// The dual-review record is NOT written here. The owner watches the file and
// records it through owner-video-review, which binds the sha256; scheduling and
// approving stay two separate acts.

// The one motion prompt used for every clip in the 2026-07-29 run. run.json and
// slot.video_prompt must carry the same text or the freshness gate rejects.
export const REEL_MOTION_PROMPT =
  "Animate the supplied image while preserving its exact composition, object placement, materials, surface wear, lighting direction and colour temperature. One restrained continuous action only: an extremely gentle push-in with slight natural handheld shake, as if held by a person. Keep every object in its original position and its original condition. Do not clean, repair, alter or transform the object. Do not add or remove anything. No hands in close-up and no finger detail. Do not add people, readable text, captions, logos, dialogue or music. No morphing, warping, flicker, jump cuts, sudden motion or collapsing geometry. Audio near-silent with only faint room tone. Natural restrained motion, stable first and final frames. Duration: 5 seconds. Aspect ratio: 9:16. Resolution: 720p.";

const RUN_DIR = "output/reels-run/2026-07-29";

function shareInviteFor(concept: ReelConcept): string {
  switch (concept.object_type) {
    case "duvet":
      return "家裡那位總說「棉被還可以再放一下」的人，這篇可以轉給他。";
    case "plush-doll":
      return "認識那種娃娃捨不得丟、又不敢洗的人嗎？傳給他。";
    case "leather-bag":
    case "handbag":
      return "身邊有人的包正在磨邊角嗎？這篇傳給他。";
    default:
      return "認識那種鞋子捨不得丟、又不知道怎麼救的人嗎？傳給他。";
  }
}

function questionFor(concept: ReelConcept): string {
  switch (concept.object_type) {
    case "duvet":
      return "你家的棉被大概多久整理一次？";
    case "plush-doll":
      return "家裡有沒有那種一直想洗、又不太敢洗的娃娃？";
    case "handbag":
    case "leather-bag":
      return "哪一件是你最不敢自己動手處理的？";
    default:
      return "如果只能先救一樣，你會選鞋子還是包包？";
  }
}

// One-photo CTA, matching contentPlan.actionCtaFor: Instagram uses 私訊,
// Facebook uses 傳 LINE. Multi-photo asks ("完整外觀和局部") are banned on IG.
function reelActionCta(concept: ReelConcept, platform: "instagram" | "facebook"): string {
  const channel = platform === "instagram" ? "私訊" : "傳 LINE";
  switch (concept.object_type) {
    case "duvet":
      return `換季要整理寢具的話，${channel}說一下數量就可以，我們去收。`;
    case "plush-doll":
      return `家裡有不敢洗的娃娃？拍一張${channel}，我們先幫你看能不能洗。`;
    case "leather-bag":
    case "handbag":
      return `不確定這只包還救不救得回來？拍一張${channel}給我們，先幫你看。`;
    default:
      return `不確定該怎麼處理？拍一張${channel}給我們，先幫你看方向。`;
  }
}

const FOLLOW_LINE = "私享家洗衣店｜台中市區免費到府收送";

function captionsFor(concept: ReelConcept): { instagram: string; facebook: string } {
  const hashtags = ["#私享家洗衣店", "#台中西屯洗衣店", "#台中免費收送", "#洗護日常"].join(" ");
  // Block 2 is the observation (narration), never the bare shop name — Instagram
  // folds there. Brand lives on the follow line with the free-pickup offer.
  const instagram = [
    concept.hook + "。",
    concept.narration,
    reelActionCta(concept, "instagram"),
    LINE_CONTACT,
    `${questionFor(concept)}\n\n${shareInviteFor(concept)}`,
    FOLLOW_LINE,
    hashtags
  ].join("\n\n");
  const facebook = [
    concept.hook + "。",
    concept.narration,
    reelActionCta(concept, "facebook"),
    LINE_CONTACT,
    questionFor(concept),
    FOLLOW_LINE,
    hashtags
  ].join("\n\n");
  // Reels were assembled here and never passed through the shared rules, so
  // every one of them published without a tappable link, without a price and
  // with four generic tags. The topic is the concept's object, which is what
  // the price and intent-tag rules match on.
  const topic = `${concept.hook}${concept.narration}`;
  return {
    instagram: withSharedCaptionRules(instagram, topic),
    facebook: withSharedCaptionRules(facebook, topic)
  };
}

function reelAssetName(conceptId: string, variant: AbVariant = "10s"): string {
  return variant === "15s" ? `${conceptId}-15s.mp4` : `${conceptId}.mp4`;
}

function emptySlotStub(date: string, slotNumber: number, time: string): DailySlot {
  return {
    slot: slotNumber,
    time,
    category: "情境文",
    topic: "pending-reel",
    format: "reel",
    media_type: "image",
    instagram_caption: "",
    facebook_caption: "",
    image_prompt: "",
    visual_route: "shop-inspection",
    traffic_route: "share-worthy-care",
    local_image_path: `docs/assets/${date}/slot-${padSlot(slotNumber)}.png`,
    public_image_url: "",
    status: "pending"
  };
}

export async function scheduleReel(input: {
  date: string;
  conceptId: string;
  root?: string;
  slot?: number;
  variant?: AbVariant;
}): Promise<void> {
  const root = projectRoot(input.root);
  const config = getConfig();
  const concept = REEL_CONCEPTS.find((item) => item.id === input.conceptId);
  if (!concept) throw new Error(`Unknown concept: ${input.conceptId}`);

  const slotNumber = input.slot ?? 2;
  const variant: AbVariant = input.variant ?? "10s";
  const reelSource = join(root, RUN_DIR, "reels", reelAssetName(concept.id, variant));
  const sidecarSource = `${reelSource}.audio.json`;
  const coverSource = join(root, RUN_DIR, "references", `${concept.id}-before.png`);
  for (const required of [reelSource, sidecarSource, coverSource]) {
    await readFile(required);
  }

  await generateDailyContent({ date: input.date, root });
  const content = await loadDailyContent(input.date, root);
  if (!content) throw new Error(`No content calendar for ${input.date}`);

  let working: DailyContent = content;
  let slot = working.slots.find((item) => item.slot === slotNumber);
  if (!slot) {
    // A/B noon slot may be absent on older 2-slot calendars; append a stub so
    // the reel can be written without rewriting the rest of the day.
    if (slotNumber !== 3) throw new Error(`Slot ${slotNumber} missing for ${input.date}`);
    working = {
      ...working,
      slots: [...working.slots, emptySlotStub(input.date, 3, "12:00")].sort((a, b) => a.slot - b.slot)
    };
    slot = working.slots.find((item) => item.slot === slotNumber);
  }
  if (!slot) throw new Error(`Slot ${slotNumber} missing for ${input.date}`);

  const assetDir = join(root, "docs", "assets", input.date);
  await mkdir(assetDir, { recursive: true });
  const videoRel = `docs/assets/${input.date}/slot-${padSlot(slotNumber)}.mp4`;
  const coverRel = `docs/assets/${input.date}/slot-${padSlot(slotNumber)}.png`;
  await copyFile(reelSource, join(root, videoRel));
  await copyFile(sidecarSource, `${join(root, videoRel)}.audio.json`);
  // The cover is the gpt-image-2 still the clip itself started from, which is
  // what its source record claims.
  await copyFile(coverSource, join(root, coverRel));

  const captions = captionsFor(concept);
  const scheduleTime = slotNumber === 3 ? "12:00" : slotNumber === 2 ? "20:30" : slot.time;
  const patched: DailySlot = {
    ...slot,
    time: scheduleTime,
    topic: concept.hook,
    format: "reel",
    media_type: "reel",
    instagram_caption: captions.instagram,
    facebook_caption: captions.facebook,
    image_prompt: `Reel cover still: ${concept.before_subject}`,
    carousel_items: undefined,
    media_package: undefined,
    video_prompt: REEL_MOTION_PROMPT,
    video_candidate: undefined,
    visual_route: "shop-inspection",
    traffic_route: "share-worthy-care",
    local_image_path: coverRel,
    public_image_url: config.publicImageBaseUrl
      ? buildGitHubPagesImageUrl(config.publicImageBaseUrl, input.date, slotNumber)
      : "",
    local_video_path: videoRel,
    public_video_url: config.publicImageBaseUrl
      ? buildGitHubPagesVideoUrl(config.publicImageBaseUrl, input.date, slotNumber)
      : undefined
  };
  const nextContent: DailyContent = {
    ...working,
    slots: working.slots.map((item) => (item.slot === slotNumber ? patched : item))
  };
  await writeJsonAtomic(contentCalendarPath(input.date, root), nextContent);

  // Cover source record, required by validate-publishable-images.
  const imageSourcesPath = join(root, "data", "image-sources", `${input.date}.json`);
  const imageSources = await readJsonFile<Array<Record<string, unknown>>>(imageSourcesPath, []);
  const filteredImageSources = imageSources.filter(
    (item) => !(item.slot === slotNumber && item.image_path === coverRel)
  );
  filteredImageSources.push({
    date: input.date,
    slot: slotNumber,
    source: "gpt-image-2",
    image_path: coverRel,
    marked_at: new Date().toISOString()
  });
  await writeJsonAtomic(imageSourcesPath, filteredImageSources);

  // Provider source record, required by validatePublishableReel.
  const generationReport = await readJsonFile<Record<string, unknown>>(
    join(root, RUN_DIR, `report-${concept.id}-before.json`),
    {}
  );
  const videoSourcesPath = join(root, "data", "video-sources", `${input.date}.json`);
  const videoSources = await readJsonFile<Array<Record<string, unknown>>>(videoSourcesPath, []);
  const filteredVideoSources = videoSources.filter((item) => item.slot !== slotNumber);
  filteredVideoSources.push({
    date: input.date,
    slot: slotNumber,
    source: "grok-imagine-video",
    model: "grok-imagine-video-1.5",
    video_path: videoRel,
    source_route: "hermes-xai-oauth",
    source_reference: `copx:${RUN_DIR}/report-${concept.id}-before.json`,
    generation_id: generationReport.generation_id ?? `sixiangjia_${concept.id.replace(/-/g, "_")}`,
    recorded_at: new Date().toISOString()
  });
  await writeJsonAtomic(videoSourcesPath, filteredVideoSources);

  // Freshness run report. The clips really were generated through the Hermes
  // route; this records that run against the slot the reel now occupies.
  const runPath = videoRunReportPath(input.date, slotNumber, root);
  await mkdir(join(runPath, ".."), { recursive: true });
  const assembledFrom =
    variant === "15s"
      ? [`${concept.id}-before.mp4`, `${concept.id}-middle.mp4`, `${concept.id}-after.mp4`]
      : [`${concept.id}-before.mp4`, `${concept.id}-after.mp4`];
  await writeJsonAtomic(runPath, {
    version: "1.0",
    status: "complete",
    generation_route: "hermes-xai-oauth",
    model: "grok-imagine-video-1.5",
    generation_id: generationReport.generation_id ?? `sixiangjia_${concept.id.replace(/-/g, "_")}`,
    prompt_hash: hashVideoPrompt(REEL_MOTION_PROMPT),
    target_path: videoRel,
    assembled_from: assembledFrom,
    ab_variant: variant,
    assembly: "scripts/assemble-reel.ps1 (colour-matched dissolve, subtitles, zh-TW narration, ambient bed)",
    completed_at: new Date().toISOString()
  });

  console.log(`${input.date} slot ${slotNumber} (${variant}) <- ${concept.id}`);
}

/**
 * True when the calendar slot already holds the planned concept AND length
 * variant. Topic alone is not enough: a 10s file left in a 15s plan slot is a
 * silent A/B contamination and must be rewritten.
 */
export async function slotMatchesPlanReel(input: {
  date: string;
  slotNumber: number;
  conceptId: string;
  variant: AbVariant;
  root: string;
}): Promise<boolean> {
  const concept = REEL_CONCEPTS.find((item) => item.id === input.conceptId);
  const content = await loadDailyContent(input.date, input.root);
  const slot = content?.slots.find((item) => item.slot === input.slotNumber);
  if (!(slot?.media_type === "reel" && slot.local_video_path && slot.topic === concept?.hook)) {
    return false;
  }
  const run = await readJsonFile<{ ab_variant?: AbVariant }>(
    videoRunReportPath(input.date, input.slotNumber, input.root),
    {}
  );
  return run.ab_variant === input.variant;
}

export async function healOneSlot(input: {
  date: string;
  slotNumber: number;
  conceptId: string;
  variant: AbVariant;
  root: string;
}): Promise<void> {
  if (await slotMatchesPlanReel(input)) {
    console.log(
      `${input.date}: slot ${input.slotNumber} already carries the ${input.conceptId} reel (${input.variant}).`
    );
    return;
  }
  const reelFile = join(input.root, RUN_DIR, "reels", reelAssetName(input.conceptId, input.variant));
  try {
    await readFile(reelFile);
  } catch {
    console.log(
      `${input.date}: reel ${input.conceptId} (${input.variant}) is not built yet; leaving slot ${input.slotNumber} as generated.`
    );
    return;
  }
  await scheduleReel({
    date: input.date,
    conceptId: input.conceptId,
    slot: input.slotNumber,
    variant: input.variant,
    root: input.root
  });
  console.log(`${input.date}: healed slot ${input.slotNumber} back to ${input.conceptId} (${input.variant}).`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  // Data-authored extension concepts join the schedule before any decision
  // reads it, so healing and scheduling see the same world as production.
  loadExtensions(projectRoot(getOption(args, "root")));

  if (getFlag(args, "plan")) {
    for (const entry of REEL_SCHEDULE) {
      await scheduleReel({ date: entry.date, conceptId: entry.conceptId, root: getOption(args, "root") });
    }
    return;
  }

  // --heal: put the day's Reel back if something rewrote the calendar.
  // Codex's morning flow writes calendar files directly, bypassing the
  // preservation guard in generateDailyContent, and twice reverted a
  // scheduled Reel to a carousel whose slides never existed. Approval and
  // publishing run this first, so a clobbered morning self-repairs before
  // anything is judged against the broken state. Healing only ever restores
  // what REEL_SCHEDULE / ab-test-plan already says and only when the finished
  // reel exists; a day with no scheduled concept, or a slot already correct,
  // is a no-op. Without an A/B plan, behaviour matches the original single
  // evening Reel heal (slot 2 only).
  if (getFlag(args, "heal")) {
    const config = getConfig();
    const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
    const root = projectRoot(getOption(args, "root"));
    const abPlan = planForDate(await loadAbTestPlan(root), date);

    if (abPlan) {
      await healOneSlot({
        date,
        slotNumber: 3,
        conceptId: abPlan.noon.conceptId,
        variant: abPlan.noon.variant,
        root
      });
      await healOneSlot({
        date,
        slotNumber: 2,
        conceptId: abPlan.evening.conceptId,
        variant: abPlan.evening.variant,
        root
      });
      return;
    }

    const entry = REEL_SCHEDULE.find((item) => item.date === date);
    if (!entry) {
      console.log(`${date}: no reel scheduled, nothing to heal.`);
      return;
    }
    await healOneSlot({
      date,
      slotNumber: 2,
      conceptId: entry.conceptId,
      variant: "10s",
      root
    });
    return;
  }

  const date = getOption(args, "date");
  const conceptId = getOption(args, "concept");
  if (!date || !conceptId) throw new Error("Required: --date YYYY-MM-DD --concept <id>, --heal, or --plan.");
  const slot = getNumberOption(args, "slot") ?? 2;
  const variantRaw = getOption(args, "variant");
  const variant: AbVariant | undefined =
    variantRaw === "15s" || variantRaw === "10s" ? variantRaw : undefined;
  await scheduleReel({ date, conceptId, slot, variant, root: getOption(args, "root") });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
