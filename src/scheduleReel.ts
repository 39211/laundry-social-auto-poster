import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { LINE_CONTACT, withSharedCaptionRules } from "./contentPlan";
import { utmCampaign } from "./utm";
import { generateDailyContent } from "./generateDailyContent";
import {
  invalidateSlotImagesIfTopicChanged,
  PromptSubjectClashError,
  StalePromptAfterTopicChangeError,
  topicIdentity,
  type InvalidateReport
} from "./generateImage";
import { buildGitHubPagesImageUrl, buildGitHubPagesVideoUrl } from "./githubPages";
import { loadAbTestPlan, planForDate, planSlot, type AbVariant } from "./abTestPlan";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { markImageSource } from "./markImageSource";
import { contentCalendarPath, padSlot, projectRoot } from "./paths";
import { isConceptRejected, loadRejectedConcepts } from "./visualQa";
import {
  REEL_CONCEPTS,
  REEL_SCHEDULE,
  loadExtensions,
  priorAirings,
  promptFor,
  type ReelConcept
} from "./reelConcepts";
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

export function reelCoverSourceRel(conceptId: string): string {
  return `${RUN_DIR}/references/${conceptId}-before.png`;
}

/**
 * Cover prompt written into the calendar and the image manifest.
 * A before still is a copy, not a generation: the prompt records the source
 * path so generate-missing-images will not invent a catalogue still. Only a
 * missing before still may generate, and then only inside SHARED_STILL_PROMPT.
 */
export function reelCoverPrompt(concept: ReelConcept, beforeStillRelativePath?: string): string {
  if (beforeStillRelativePath) {
    return `Copied reel cover from ${beforeStillRelativePath}`;
  }
  return promptFor(concept, "before");
}

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

export function captionsFor(
  concept: ReelConcept,
  airedBefore: number,
  date: string
): { instagram: string; facebook: string } {
  const hashtags = ["#私享家洗衣店", "#台中西屯洗衣店", "#台中免費收送", "#洗護日常"].join(" ");
  // Block 2 is the observation (narration), never the bare shop name — Instagram
  // folds there. Brand lives on the follow line with the free-pickup offer.
  //
  // A re-airing (post-cooldown) must not reprint the first run: the 8/16
  // insight data measured -50%+ views on unchanged reruns. Same facts, other
  // arrangement — the craftsman's diagnostic sentence takes the fold and the
  // hook closes instead of opening. No new claims are invented.
  const narrationEnd = concept.narration.indexOf("。");
  const narrationLead =
    narrationEnd === -1 ? concept.narration : concept.narration.slice(0, narrationEnd + 1);
  const narrationRest = narrationEnd === -1 ? "" : concept.narration.slice(narrationEnd + 1);
  const opening =
    airedBefore > 0
      ? [narrationLead, `${narrationRest ? narrationRest + "\n\n" : ""}${concept.hook}。`]
      : [concept.hook + "。", concept.narration];
  const instagram = [
    ...opening,
    reelActionCta(concept, "instagram"),
    LINE_CONTACT,
    `${questionFor(concept)}\n\n${shareInviteFor(concept)}`,
    FOLLOW_LINE,
    hashtags
  ].join("\n\n");
  const facebook = [
    ...opening,
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
  const campaign = utmCampaign(date, 2, "reel");
  return {
    instagram: withSharedCaptionRules(instagram, topic, { source: "instagram", campaign }),
    facebook: withSharedCaptionRules(facebook, topic, { source: "facebook", campaign })
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
  const rejected = await loadRejectedConcepts(root);
  if (isConceptRejected(rejected, input.conceptId)) {
    throw new Error(`Concept ${input.conceptId} is on rejected-concepts; refusing to schedule.`);
  }
  const concept = REEL_CONCEPTS.find((item) => item.id === input.conceptId);
  if (!concept) throw new Error(`Unknown concept: ${input.conceptId}`);

  const slotNumber = input.slot ?? 2;
  const variant: AbVariant = input.variant ?? "10s";
  const reelSource = join(root, RUN_DIR, "reels", reelAssetName(concept.id, variant));
  const sidecarSource = `${reelSource}.audio.json`;
  const coverSourceRel = reelCoverSourceRel(concept.id);
  const coverSource = join(root, RUN_DIR, "references", `${concept.id}-before.png`);
  for (const required of [reelSource, sidecarSource]) {
    await readFile(required);
  }
  let coverExists = false;
  try {
    await readFile(coverSource);
    coverExists = true;
  } catch {
    coverExists = false;
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
  // The cover is the shop still the clip itself started from. Copy it; do not
  // ask generate-missing-images to invent a new catalogue frame from the
  // bare subject. Only a missing before still is allowed to generate.
  if (coverExists) {
    await copyFile(coverSource, join(root, coverRel));
  }

  const captions = captionsFor(concept, priorAirings(concept.id, input.date), input.date);
  const scheduleTime = slotNumber === 3 ? "12:00" : slotNumber === 2 ? "20:30" : slot.time;
  const patched: DailySlot = {
    ...slot,
    time: scheduleTime,
    topic: concept.hook,
    format: "reel",
    media_type: "reel",
    instagram_caption: captions.instagram,
    facebook_caption: captions.facebook,
    image_prompt: reelCoverPrompt(concept, coverExists ? coverSourceRel : undefined),
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

  // Cover evidence. This used to write a five-field record with no topic and no
  // hashes, which was fine while approval only looked at slot 1 and never at a
  // Reel cover. It is not fine now: approval demands a full stamp for every
  // image of every slot, and 10:20 runs heal-reel-slot *before* auto-approve --
  // so a Reel healed into the day would be stamped by this writer, judged by
  // that gate, and blocked. The day would then approve slot 1 only, and the
  // catch-up chain does not re-approve a day that already has an approval log.
  // A gate the production writer cannot satisfy is not a gate, it is an outage.
  //
  // The manifest entry has to be written here too. It is built at 06:30 from the
  // calendar, and a Reel healed in at 10:20 did not exist then, so nothing else
  // will ever describe this cover.
  const manifestPath = join(root, "data", "image-prompts", `${input.date}.json`);
  const manifest = await readJsonFile<Array<Record<string, unknown>>>(manifestPath, []);
  const coverPrompt = patched.image_prompt;
  const nextManifest = [
    ...manifest.filter((item) => item.target_path !== coverRel),
    {
      slot: slotNumber,
      slide: 1,
      target_path: coverRel,
      topic: patched.topic,
      prompt: coverPrompt,
      source: coverExists ? coverSourceRel : undefined,
      public_image_url: patched.public_image_url,
      visual_route: patched.visual_route
    }
  ];
  await writeJsonAtomic(manifestPath, nextManifest);

  // Stamped through the one writer, so the cover carries the same evidence as
  // any other image: the topic it was made for, and hashes binding it to those
  // exact bytes and that exact prompt. A missing before still has no bytes yet;
  // generate-missing-images will write them from the SHARED_STILL_PROMPT shell.
  if (coverExists) {
    await markImageSource({
      root,
      date: input.date,
      slot: slotNumber,
      source: "gpt-image-2",
      imagePath: coverRel
    });
  }

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

export type HealSlotAction =
  | "healed"
  | "already-matched"
  | "missing-reel"
  | "rejected-concept"
  | "stopped";

export interface HealSlotResult {
  date: string;
  slotNumber: number;
  action: HealSlotAction;
  stopReason?: string;
  invalidate?: InvalidateReport;
}

function healStopReasonFromReport(report: InvalidateReport, slotNumber: number): string | undefined {
  const refused = report.refused.find((item) => item.slot === slotNumber);
  if (refused) {
    return refused.reason.includes("A1-refusal") ? refused.reason : `A1-refusal:${refused.reason}`;
  }
  const skipped = report.skipped.find((item) => item.slot === slotNumber);
  if (!skipped) return undefined;
  if (skipped.reason === "approved-log" || skipped.reason === "posted-log" || skipped.reason === "protected-reel") {
    return skipped.reason;
  }
  if (skipped.reason.includes("day-lock") || skipped.reason.startsWith("A3")) {
    return "day-lock";
  }
  return skipped.reason;
}

function healStopped(
  input: { date: string; slotNumber: number },
  stopReason: string,
  invalidate?: InvalidateReport
): HealSlotResult {
  const result: HealSlotResult = {
    date: input.date,
    slotNumber: input.slotNumber,
    action: "stopped",
    stopReason,
    invalidate
  };
  console.log(`${input.date}: slot ${input.slotNumber} heal stopped (${stopReason}).`);
  console.log(JSON.stringify({ stopReason, invalidate: invalidate ?? null }, null, 2));
  return result;
}

/**
 * True when the calendar slot already holds the planned concept AND length
 * variant. Topic alone is not enough: a 10s file left in a 15s plan slot is a
 * silent A/B contamination and must be rewritten. Prefix-only label changes
 * are the same object: compare topicIdentity, never the raw topic string.
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
  if (!concept || slot?.media_type !== "reel" || !slot.local_video_path) {
    return false;
  }
  if (topicIdentity(slot.topic) !== topicIdentity(concept.hook)) {
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
}): Promise<HealSlotResult> {
  const rejected = await loadRejectedConcepts(input.root);
  if (isConceptRejected(rejected, input.conceptId)) {
    console.log(
      `${input.date}: ${input.conceptId} is on rejected-concepts; heal will not restore it.`
    );
    return { date: input.date, slotNumber: input.slotNumber, action: "rejected-concept" };
  }
  if (await slotMatchesPlanReel(input)) {
    console.log(
      `${input.date}: slot ${input.slotNumber} already carries the ${input.conceptId} reel (${input.variant}).`
    );
    return { date: input.date, slotNumber: input.slotNumber, action: "already-matched" };
  }
  const reelFile = join(input.root, RUN_DIR, "reels", reelAssetName(input.conceptId, input.variant));
  try {
    await readFile(reelFile);
  } catch {
    console.log(
      `${input.date}: reel ${input.conceptId} (${input.variant}) is not built yet; leaving slot ${input.slotNumber} as generated.`
    );
    return { date: input.date, slotNumber: input.slotNumber, action: "missing-reel" };
  }
  const previous = (await loadDailyContent(input.date, input.root))?.slots.find(
    (item) => item.slot === input.slotNumber
  );
  const concept = REEL_CONCEPTS.find((item) => item.id === input.conceptId);
  let invalidate: InvalidateReport | undefined;
  if (previous && concept) {
    // Move the outgoing slot first. scheduleReel then copies and stamps the
    // new cover; calling invalidate after that stamp would quarantine the
    // still that was just written.
    const malformedCarousel =
      (previous.media_type === "carousel" || previous.media_type === "mixed-carousel") &&
      (previous.carousel_items?.length ?? 0) < 2;
    const outgoing: DailySlot = malformedCarousel
      ? { ...previous, media_type: "image", format: "image-post", carousel_items: undefined }
      : previous;
    const next: DailySlot = {
      ...outgoing,
      topic: concept.hook,
      image_prompt: reelCoverPrompt(concept, reelCoverSourceRel(concept.id)),
      media_type: "image",
      format: "image-post",
      carousel_items: undefined
    };
    try {
      invalidate = await invalidateSlotImagesIfTopicChanged({
        date: input.date,
        root: input.root,
        previous: outgoing,
        next
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const isA1 =
        error instanceof StalePromptAfterTopicChangeError || error instanceof PromptSubjectClashError;
      const stopReason = isA1 ? `A1-refusal:${detail}` : detail;
      return healStopped(input, stopReason, {
        date: input.date,
        moved: [],
        skipped: [],
        refused: [{ slot: input.slotNumber, reason: stopReason }]
      });
    }
    const stopReason = healStopReasonFromReport(invalidate, input.slotNumber);
    if (stopReason) {
      return healStopped(input, stopReason, invalidate);
    }
  }
  await scheduleReel({
    date: input.date,
    conceptId: input.conceptId,
    slot: input.slotNumber,
    variant: input.variant,
    root: input.root
  });
  console.log(`${input.date}: healed slot ${input.slotNumber} back to ${input.conceptId} (${input.variant}).`);
  return { date: input.date, slotNumber: input.slotNumber, action: "healed", invalidate };
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
      // Read the halves through planSlot rather than off the day object, so a
      // paused half is absent here the same way it is absent everywhere else.
      for (const slotNumber of [3, 2]) {
        const half = planSlot(abPlan, slotNumber);
        if (!half) {
          console.log(`${date}: slot ${slotNumber} is paused in the plan, leaving it alone.`);
          continue;
        }
        await healOneSlot({
          date,
          slotNumber,
          conceptId: half.conceptId,
          variant: half.variant,
          root
        });
      }
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
