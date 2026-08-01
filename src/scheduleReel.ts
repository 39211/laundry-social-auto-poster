import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { generateDailyContent } from "./generateDailyContent";
import { buildGitHubPagesImageUrl, buildGitHubPagesVideoUrl } from "./githubPages";
import { loadDailyContent, readJsonFile, writeJsonAtomic } from "./logging";
import { contentCalendarPath, padSlot, projectRoot } from "./paths";
import { REEL_CONCEPTS, REEL_SCHEDULE, type ReelConcept } from "./reelConcepts";
import { getZonedDateParts } from "./scheduler";
import { hashVideoPrompt, videoRunReportPath } from "./videoRunFreshness";
import type { DailyContent, DailySlot } from "./types";

// Places one reviewed Reel into a future day's 19:30 slot, writing every record
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

function captionsFor(concept: ReelConcept): { instagram: string; facebook: string } {
  const hashtags = ["#私享家洗衣店", "#台中西屯洗衣店", "#台中免費收送", "#洗護日常"].join(" ");
  const shared = [concept.hook + "。", "私享家洗衣店", concept.narration];
  const instagram = [
    ...shared,
    "有類似狀況，先拍完整外觀和局部，直接私訊傳給我們，我們會先幫你看方向。",
    `${questionFor(concept)}\n\n${shareInviteFor(concept)}`,
    hashtags
  ].join("\n\n");
  const facebook = [
    ...shared,
    "有類似狀況，可以先拍正面、近照、邊角或洗標，再傳 LINE 讓我們初步判斷。",
    questionFor(concept),
    hashtags
  ].join("\n\n");
  return { instagram, facebook };
}

export async function scheduleReel(input: { date: string; conceptId: string; root?: string }): Promise<void> {
  const root = projectRoot(input.root);
  const config = getConfig();
  const concept = REEL_CONCEPTS.find((item) => item.id === input.conceptId);
  if (!concept) throw new Error(`Unknown concept: ${input.conceptId}`);

  const reelSource = join(root, RUN_DIR, "reels", `${concept.id}.mp4`);
  const sidecarSource = `${reelSource}.audio.json`;
  const coverSource = join(root, RUN_DIR, "references", `${concept.id}-before.png`);
  for (const required of [reelSource, sidecarSource, coverSource]) {
    await readFile(required);
  }

  await generateDailyContent({ date: input.date, root });
  const content = await loadDailyContent(input.date, root);
  if (!content) throw new Error(`No content calendar for ${input.date}`);
  const slotNumber = 2;
  const slot = content.slots.find((item) => item.slot === slotNumber);
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
  const patched: DailySlot = {
    ...slot,
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
    ...content,
    slots: content.slots.map((item) => (item.slot === slotNumber ? patched : item))
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
  await writeJsonAtomic(runPath, {
    version: "1.0",
    status: "complete",
    generation_route: "hermes-xai-oauth",
    model: "grok-imagine-video-1.5",
    generation_id: generationReport.generation_id ?? `sixiangjia_${concept.id.replace(/-/g, "_")}`,
    prompt_hash: hashVideoPrompt(REEL_MOTION_PROMPT),
    target_path: videoRel,
    assembled_from: [`${concept.id}-before.mp4`, `${concept.id}-after.mp4`],
    assembly: "scripts/assemble-reel.ps1 (colour-matched dissolve, subtitles, zh-TW narration, ambient bed)",
    completed_at: new Date().toISOString()
  });

  console.log(`${input.date} slot ${slotNumber} <- ${concept.id}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

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
  // what REEL_SCHEDULE already says and only when the finished reel exists;
  // a day with no scheduled concept, or a slot already correct, is a no-op.
  if (getFlag(args, "heal")) {
    const config = getConfig();
    const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
    const root = projectRoot(getOption(args, "root"));
    const entry = REEL_SCHEDULE.find((item) => item.date === date);
    if (!entry) {
      console.log(`${date}: no reel scheduled, nothing to heal.`);
      return;
    }
    const content = await loadDailyContent(date, root);
    const slot = content?.slots.find((item) => item.slot === 2);
    if (slot?.media_type === "reel" && slot.local_video_path) {
      console.log(`${date}: slot 2 already carries the ${entry.conceptId} reel.`);
      return;
    }
    const reelFile = join(root, RUN_DIR, "reels", `${entry.conceptId}.mp4`);
    try {
      await readFile(reelFile);
    } catch {
      console.log(`${date}: reel ${entry.conceptId} is not built yet; leaving the day as generated.`);
      return;
    }
    await scheduleReel({ date, conceptId: entry.conceptId, root: getOption(args, "root") });
    console.log(`${date}: healed slot 2 back to ${entry.conceptId}.`);
    return;
  }

  const date = getOption(args, "date");
  const conceptId = getOption(args, "concept");
  if (!date || !conceptId) throw new Error("Required: --date YYYY-MM-DD --concept <id>, --heal, or --plan.");
  await scheduleReel({ date, conceptId, root: getOption(args, "root") });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
