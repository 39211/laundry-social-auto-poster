import { readFileSync } from "node:fs";
import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { withSharedCaptionRules } from "./contentPlan";
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
import {
  hasPublishableApproval,
  loadApprovalLog,
  loadDailyContent,
  loadPostLog,
  readJsonFile,
  writeDailyContent,
  writeJsonAtomic
} from "./logging";
import { markImageSource } from "./markImageSource";
import { padSlot, projectRoot } from "./paths";
import { isConceptRejected, loadRejectedConcepts } from "./visualQa";
import {
  REEL_CONCEPTS,
  REEL_SCHEDULE,
  loadExtensions,
  priorAirings,
  promptFor,
  splitNarrationSentences,
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

// Calendar/freshness stamp written into slot.video_prompt and run.json.
// Duration, aspect and resolution stay on the generation manifest, not in this
// prose: a fixed "Duration: 5 seconds. Aspect ratio: 9:16." tail is banned.
// Bans here are the core three only (do not clean / do not change the object /
// do not add people or text). Per-act bans live in produce-next-reel.ps1.
export const REEL_MOTION_PROMPT =
  "Animate the supplied image while preserving its exact composition, object placement, materials, lighting direction and colour temperature. One restrained continuous action only: an extremely gentle push-in with slight natural handheld shake, as if held by a person. Do not clean, repair, alter or transform the object. Do not add or remove anything. Do not add people, readable text, captions or logos. Audio near-silent with only faint room tone. Natural restrained motion, stable first and final frames.";

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
  // handbag-handle is about a sticky grip, not worn corners. Grouping it with
  // leather-bag under object_type put the corner invite on a handle Reel.
  if (concept.id === "handbag-handle") {
    return "身邊有人的包提把也開始發黏嗎？這篇傳給他。";
  }
  switch (concept.object_type) {
    case "duvet":
      return "家裡那位總說「棉被還可以再放一下」的人，這篇可以轉給他。";
    case "plush-doll":
      return "認識那種娃娃捨不得丟、又不敢洗的人嗎？傳給他。";
    case "leather-bag":
    case "handbag":
      return "身邊有人的包正在磨邊角嗎？這篇傳給他。";
    case "white-shoe":
      return "認識那種白鞋放到發黃還沒處理的人嗎？傳給他。";
    case "leather-shoe":
      return "身邊有人的皮鞋淋過雨還沒處理嗎？這篇傳給他。";
    case "canvas-shoe":
      return "身邊有人的帆布鞋泥乾了還放著嗎？這篇傳給他。";
    case "suede-shoe":
      return "身邊有人的麂皮鞋摸起來變硬了嗎？這篇傳給他。";
    case "high-heel":
      return "身邊有人的高跟鞋跟頭磨白了嗎？這篇傳給他。";
    case "kids-shoe":
      return "身邊有人的童鞋鞋頭已經磨花了嗎？這篇傳給他。";
    case "hiking-boot":
      return "身邊有人的登山鞋底還卡著乾泥嗎？這篇傳給他。";
    case "leather-boot":
      return "身邊有人的靴子放一季就發霉了嗎？這篇傳給他。";
    case "shirt":
      return "家裡那位襯衫領口都黃了還在穿的人，這篇可以轉給他。";
    case "suit":
      return "身邊有人的西裝肩線已經開始塌了嗎？這篇傳給他。";
    case "curtain":
      return "家裡那位窗簾下緣積灰都沒拆過的人，這篇可以轉給他。";
    case "luggage":
      return "身邊有人的行李箱輪子還卡著灰嗎？這篇傳給他。";
    case "backpack":
      return "身邊有人的後背包底部從來沒洗過嗎？這篇傳給他。";
    case "down-jacket":
      return "身邊有人的羽絨外套袖口已經發黑了嗎？這篇傳給他。";
    case "wool-coat":
      return "家裡那位大衣肩線積了一層灰還繼續掛著的人，這篇可以轉給他。";
    case "leather-belt":
      return "身邊有人的皮帶摺痕已經發白裂了嗎？這篇傳給他。";
    case "mattress-pad":
      return "家裡那位保潔墊出現黃圈還繼續用的人，這篇可以轉給他。";
    case "blanket":
      return "身邊有人的毛毯起球摸起來變粗了嗎？這篇傳給他。";
    case "denim":
      return "身邊有人的牛仔褲膝蓋已經鬆掉了嗎？這篇傳給他。";
    case "wallet":
      return "身邊有人的長夾邊角開始起毛了嗎？這篇傳給他。";
    case "sweater":
      return "身邊有人的毛衣腋下出現黃斑了嗎？這篇傳給他。";
    default:
      return "這篇可以轉給他。";
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
    case "white-shoe":
      return "你那雙白鞋放多久沒穿了？";
    case "leather-shoe":
      return "你那雙皮鞋淋雨之後，有沒有再處理過？";
    case "canvas-shoe":
      return "你那雙帆布鞋的泥，是等乾了再清，還是濕的時候就刷？";
    case "suede-shoe":
      return "你那雙麂皮鞋摸起來變硬的時候，你會先怎麼處理？";
    case "high-heel":
      return "高跟鞋跟頭磨白之後，你是繼續穿還是先收起來？";
    case "kids-shoe":
      return "家裡那雙童鞋鞋頭磨花了，你會先洗還是直接換？";
    case "hiking-boot":
      return "登山鞋底卡了乾泥，你回來會先清嗎？";
    case "leather-boot":
      return "靴子在櫃子放一季，拿出來你會先看皮面嗎？";
    case "shirt":
      return "你的襯衫比較常出問題的，是領口還是袖口？";
    case "suit":
      return "你那件西裝，肩線還站得住嗎？";
    case "curtain":
      return "家裡窗簾下緣那一折，你上次是什麼時候清的？";
    case "luggage":
      return "旅行回來的行李箱，你會先清輪子再收嗎？";
    case "backpack":
      return "你最常用的後背包，底部有多久沒看過了？";
    case "down-jacket":
      return "羽絨外套袖口發黑的時候，你會整件送還是只搓袖口？";
    case "wool-coat":
      return "大衣收進櫃子前，你會先拍掉肩線上的灰嗎？";
    case "leather-belt":
      return "皮帶那一格摺痕發白了，你還會繼續扣同一格嗎？";
    case "mattress-pad":
      return "保潔墊出現黃圈之後，你會跟被子一起送嗎？";
    case "blanket":
      return "毛毯起球摸起來變粗的時候，你會先修還是繼續蓋？";
    case "denim":
      return "牛仔褲膝蓋鬆掉以後，你還會繼續穿嗎？";
    case "wallet":
      return "長夾邊角開始起毛的時候，你會先補還是再拖？";
    case "sweater":
      return "毛衣腋下那塊黃，你是當季就洗，還是收到換季？";
    default:
      return "你最近最想先處理哪一件？";
  }
}

// One-photo CTA, matching contentPlan.actionCtaFor: Instagram uses 私訊,
// Facebook uses 傳 LINE. Multi-photo asks ("完整外觀和局部") are banned on IG.
function reelActionCta(concept: ReelConcept, platform: "instagram" | "facebook"): string {
  const channel = platform === "instagram" ? "私訊" : "傳 LINE";
  if (concept.id === "handbag-handle") {
    return `拍一張${channel}給我們，先幫你看提把。`;
  }
  switch (concept.object_type) {
    case "duvet":
      return `換季要整理寢具的話，${channel}說一下數量就可以，我們去收。`;
    case "plush-doll":
      return `拍一張${channel}，我們先看洗法。`;
    case "leather-bag":
    case "handbag":
      return `拍一張${channel}給我們，我們先看邊角。`;
    default:
      return `拍一張${channel}給我們，我們先看方向。`;
  }
}

const FOLLOW_LINE = "私享家洗衣店｜台中市區免費到府收送";

export type ReelNarrationSource = "burned" | "registry" | "concept";

const BURNED_NARRATION_REGISTRY_REL = join("data", "reel-burned-narrations.json");

const ASS_OVERRIDE_BLOCK = /\{[^}]*\}/gu;
const AUDIO_JSON_NARRATION_KEYS = ["narration", "narration_text", "NarrationText", "text"] as const;

function readUtf8IfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function assStartToCs(start: string): number {
  const trimmed = start.trim();
  const dot = trimmed.lastIndexOf(".");
  const hms = dot >= 0 ? trimmed.slice(0, dot) : trimmed;
  const csRaw = dot >= 0 ? trimmed.slice(dot + 1) : "0";
  const parts = hms.split(":").map(Number);
  const cs = Number(csRaw);
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n)) || Number.isNaN(cs)) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds * 100 + cs;
}

function stripAssDialogueText(raw: string): string {
  return raw.replace(ASS_OVERRIDE_BLOCK, "").replace(/\\N/gi, "").trim();
}

function narrationFromAss(contents: string): string | undefined {
  const events: Array<{ start: number; index: number; text: string }> = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(line)) continue;
    const payload = line.replace(/^Dialogue:\s*/i, "");
    const parts = payload.split(",");
    if (parts.length < 10) continue;
    const text = stripAssDialogueText(parts.slice(9).join(","));
    if (!text) continue;
    events.push({ start: assStartToCs(parts[1] ?? ""), index: events.length, text });
  }
  events.sort((a, b) => a.start - b.start || a.index - b.index);
  const joined = events.map((event) => event.text).join("");
  return joined.length > 0 ? joined : undefined;
}

function narrationFromAudioJson(contents: string): string | undefined {
  try {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    for (const key of AUDIO_JSON_NARRATION_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function assCandidatesFor(reelSourcePath: string): string[] {
  // burn-narration-subs.ps1 writes <basename>.ass next to the mp4
  // (`plush-doll.ass` beside `plush-doll.mp4`). The contract's
  // `<reelSource>.ass` literal is `plush-doll.mp4.ass`. Try both.
  const paths = [/\.mp4$/i.test(reelSourcePath) ? reelSourcePath.replace(/\.mp4$/i, ".ass") : "", `${reelSourcePath}.ass`];
  return [...new Set(paths.filter((path) => path.length > 0))];
}

function conceptIdFromReelPath(reelSourcePath: string): string | undefined {
  const base = basename(reelSourcePath).replace(/\.mp4$/i, "");
  if (!base) return undefined;
  return base.replace(/-15s(?:-t[ABC])?$/i, "").replace(/-t[ABC]$/i, "");
}

function narrationFromRegistry(conceptId: string): string | undefined {
  const raw = readUtf8IfPresent(join(projectRoot(), BURNED_NARRATION_REGISTRY_REL));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as { narrations?: Record<string, unknown> };
    const value = parsed.narrations?.[conceptId];
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    return undefined;
  }
  return undefined;
}

function burnedNarrationEvidence(
  reelSourcePath: string
): { text: string; source: Exclude<ReelNarrationSource, "concept"> } | undefined {
  for (const assPath of assCandidatesFor(reelSourcePath)) {
    const raw = readUtf8IfPresent(assPath);
    if (raw === undefined) continue;
    const fromAss = narrationFromAss(raw);
    if (fromAss) return { text: fromAss, source: "burned" };
  }
  const sidecar = readUtf8IfPresent(`${reelSourcePath}.audio.json`);
  if (sidecar !== undefined) {
    const fromAudio = narrationFromAudioJson(sidecar);
    if (fromAudio) return { text: fromAudio, source: "burned" };
  }
  const conceptId = conceptIdFromReelPath(reelSourcePath);
  if (!conceptId) return undefined;
  const fromRegistry = narrationFromRegistry(conceptId);
  if (fromRegistry) return { text: fromRegistry, source: "registry" };
  return undefined;
}

/**
 * Read the narration actually burned onto a reel: same-stem `.ass` Dialogue
 * text in time order, else a string narration field on `.audio.json`, else
 * the production-time registry. Missing evidence returns undefined so callers
 * keep the live concept.
 */
export function burnedNarrationFor(reelSourcePath: string): string | undefined {
  return burnedNarrationEvidence(reelSourcePath)?.text;
}

export function captionsFor(
  concept: ReelConcept,
  airedBefore: number,
  date: string,
  narrationOverride?: string
): { instagram: string; facebook: string } {
  const hashtags = ["#私享家洗衣店", "#台中西屯洗衣店", "#台中免費收送", "#洗護日常"].join(" ");
  // Block 2 is the observation (narration), never the bare shop name — Instagram
  // folds there. Brand lives on the follow line with the free-pickup offer.
  //
  // A re-airing (post-cooldown) must not reprint the first run: the 8/16
  // insight data measured -50%+ views on unchanged reruns. Same facts, other
  // arrangement — the craftsman's diagnostic sentence takes the fold and the
  // hook closes instead of opening. No new claims are invented.
  //
  // When a reel already has burned subtitles, the schedule path passes that
  // text as narrationOverride so the caption follows the video, not a later
  // rewrite of concept.narration. hook/close stay on the concept.
  const narration = narrationOverride ?? concept.narration;
  const narrationParts = splitNarrationSentences(narration);
  const narrationLead = narrationParts[0] ?? narration;
  const narrationRest = narrationParts.slice(1).join("");
  const opening =
    airedBefore > 0
      ? [narrationLead, `${narrationRest ? narrationRest + "\n\n" : ""}${concept.hook}。`]
      : [concept.hook + "。", narration];
  // Skip questionFor when any opening sentence already contains ？.
  // Intentional: if a future concept opens with a statement and a later
  // opening sentence asks, questionFor is still skipped.
  const skipQuestionFor = /[？?]/.test(opening.join(""));
  const igQuestionShare = skipQuestionFor
    ? shareInviteFor(concept)
    : `${questionFor(concept)}\n\n${shareInviteFor(concept)}`;
  const instagram = [
    ...opening,
    reelActionCta(concept, "instagram"),
    igQuestionShare,
    FOLLOW_LINE,
    hashtags
  ].join("\n\n");
  const facebook = skipQuestionFor
    ? [
        ...opening,
        reelActionCta(concept, "facebook"),
        shareInviteFor(concept),
        FOLLOW_LINE,
        hashtags
      ].join("\n\n")
    : [
        ...opening,
        reelActionCta(concept, "facebook"),
        questionFor(concept),
        FOLLOW_LINE,
        hashtags
      ].join("\n\n");
  // Reels were assembled here and never passed through the shared rules, so
  // every one of them published without a tappable link, without a price and
  // with four generic tags. The topic is the concept's object, which is what
  // the price and intent-tag rules match on.
  const topic = `${concept.hook}${narration}`;
  const campaign = utmCampaign(date, 2, "reel");
  const siteBaseUrl = getConfig().publicSiteBaseUrl;
  return {
    instagram: withSharedCaptionRules(instagram, topic, { source: "instagram", campaign, siteBaseUrl }),
    facebook: withSharedCaptionRules(facebook, topic, { source: "facebook", campaign, siteBaseUrl })
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
  /** Replace an approved or already-published non-Reel slot anyway. */
  force?: boolean;
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

  // 2026-09-04: `schedule-reel --date ... --concept plush-doll` without --slot
  // landed in the default slot 2 and replaced an approved evening carousel's
  // cover and calendar entry with the noon Reel; the calendar was rebuilt by
  // hand but the overwritten cover and the copied clip stayed, and the digest
  // gate refused the 20:30 publish. A slot that is approved or already live as
  // a non-Reel post is not a free target: refuse unless the caller says
  // --force, and always keep a copy of what is about to be overwritten so
  // `--restore` can put it back byte for byte.
  if (slot.media_type !== "reel" && !input.force) {
    const approvals = await loadApprovalLog(input.date, root);
    const posted = await loadPostLog(input.date, root);
    const approved =
      hasPublishableApproval(approvals, slotNumber, "facebook") ||
      hasPublishableApproval(approvals, slotNumber, "instagram");
    const live = posted.some(
      (entry) => entry.slot === slotNumber && !entry.dry_run && (entry.status === "success" || entry.status === "posted")
    );
    if (approved || live) {
      throw new Error(
        `Refusing to schedule ${concept.id} into ${input.date} slot ${slotNumber}: that slot is an ` +
          `${live ? "already published" : "approved"} ${slot.media_type ?? "image"} post (${slot.topic}). ` +
          `Pass --slot for the Reel slot you meant, or --force to replace it and then re-run auto-approve.`
      );
    }
  }
  await backupSlotBeforeReel({ root, date: input.date, slotNumber, slot, coverRel, videoRel });

  await copyFile(reelSource, join(root, videoRel));
  await copyFile(sidecarSource, `${join(root, videoRel)}.audio.json`);
  // The cover is the shop still the clip itself started from. Copy it; do not
  // ask generate-missing-images to invent a new catalogue frame from the
  // bare subject. Only a missing before still is allowed to generate.
  if (coverExists) {
    await copyFile(coverSource, join(root, coverRel));
  }

  const evidence = burnedNarrationEvidence(reelSource);
  const narrationSource: ReelNarrationSource = evidence?.source ?? "concept";
  const burnedNarration = evidence?.text;
  const usedNarration = burnedNarration ?? concept.narration;
  const captions = captionsFor(
    concept,
    priorAirings(concept.id, input.date),
    input.date,
    burnedNarration
  );
  const narrationFirstSentence = splitNarrationSentences(usedNarration)[0] ?? usedNarration;
  const scheduleTime = slotNumber === 3 ? "12:00" : slotNumber === 2 ? "20:30" : slot.time;
  const patched: DailySlot & {
    narration_source: ReelNarrationSource;
    narration_first_sentence: string;
  } = {
    ...slot,
    time: scheduleTime,
    topic: concept.hook,
    format: "reel",
    media_type: "reel",
    instagram_caption: captions.instagram,
    facebook_caption: captions.facebook,
    narration_source: narrationSource,
    narration_first_sentence: narrationFirstSentence,
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
    date: input.date,
    timezone: working.timezone || "Asia/Taipei",
    generated_at: working.generated_at || new Date().toISOString(),
    slots: working.slots.map((item) => (item.slot === slotNumber ? patched : item))
  };
  await writeDailyContent(nextContent, root);

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
  console.log(`narration_source: ${narrationSource}`);
  console.log(`narration_first_sentence: ${narrationFirstSentence}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** output/ is gitignored, so the copies never reach the public site. */
export function reelBackupDir(date: string, root = projectRoot()): string {
  return join(root, "output", "reel-backups", date);
}

interface ReelSlotSnapshot {
  date: string;
  slot: DailySlot;
  manifest_entries: Array<Record<string, unknown>>;
  image_sources: Array<Record<string, unknown>>;
  saved_at: string;
}

/**
 * Keep the earliest original of everything scheduleReel is about to replace:
 * the calendar slot, its manifest and image-source records, and the cover /
 * clip / sidecar bytes. A second schedule into the same slot (heal re-runs)
 * must not overwrite the snapshot with the Reel it is replacing.
 */
async function backupSlotBeforeReel(input: {
  root: string;
  date: string;
  slotNumber: number;
  slot: DailySlot;
  coverRel: string;
  videoRel: string;
}): Promise<void> {
  const dir = reelBackupDir(input.date, input.root);
  await mkdir(dir, { recursive: true });
  const tag = `slot-${padSlot(input.slotNumber)}`;
  const snapshotPath = join(dir, `${tag}.slot.json`);
  if (await fileExists(snapshotPath)) return;
  const manifest = await readJsonFile<Array<Record<string, unknown>>>(
    join(input.root, "data", "image-prompts", `${input.date}.json`),
    []
  );
  const imageSources = await readJsonFile<Array<Record<string, unknown>>>(
    join(input.root, "data", "image-sources", `${input.date}.json`),
    []
  );
  const snapshot: ReelSlotSnapshot = {
    date: input.date,
    slot: input.slot,
    manifest_entries: manifest.filter((item) => item.slot === input.slotNumber),
    image_sources: imageSources.filter((item) => item.slot === input.slotNumber),
    saved_at: new Date().toISOString()
  };
  await writeJsonAtomic(snapshotPath, snapshot);
  for (const rel of [input.coverRel, input.videoRel, `${input.videoRel}.audio.json`]) {
    const abs = join(input.root, ...rel.split("/"));
    if (await fileExists(abs)) {
      await copyFile(abs, join(dir, rel.split("/").pop()!));
    }
  }
}

/**
 * Undo a scheduleReel on one slot from the snapshot it took: calendar slot,
 * manifest and image-source records, cover / clip / sidecar bytes (restored
 * when a backup exists, removed when the Reel brought them). Provenance the
 * Reel wrote for the slot (video-sources row, run report) is dropped. Approval
 * digests are the approver's business: if the day already carries an approval
 * log, re-run auto-approve afterwards.
 */
export async function restoreReelSlot(input: {
  date: string;
  slotNumber: number;
  root?: string;
}): Promise<{ restored: string[] }> {
  const root = projectRoot(input.root);
  const dir = reelBackupDir(input.date, root);
  const tag = `slot-${padSlot(input.slotNumber)}`;
  const snapshotPath = join(dir, `${tag}.slot.json`);
  const snapshot = await readJsonFile<ReelSlotSnapshot | null>(snapshotPath, null);
  if (!snapshot?.slot) {
    throw new Error(`No reel backup for ${input.date} slot ${input.slotNumber} at ${snapshotPath}; nothing safe to restore.`);
  }
  const content = await loadDailyContent(input.date, root);
  if (!content) throw new Error(`No content calendar for ${input.date}`);
  const restored: string[] = [];

  await writeDailyContent(
    { ...content, slots: content.slots.map((item) => (item.slot === input.slotNumber ? snapshot.slot : item)) },
    root
  );
  restored.push("calendar slot");

  const coverRel = `docs/assets/${input.date}/${tag}.png`;
  const videoRel = `docs/assets/${input.date}/${tag}.mp4`;
  for (const rel of [coverRel, videoRel, `${videoRel}.audio.json`]) {
    const abs = join(root, ...rel.split("/"));
    const backup = join(dir, rel.split("/").pop()!);
    if (await fileExists(backup)) {
      await copyFile(backup, abs);
      restored.push(rel);
    } else if (await fileExists(abs)) {
      await rm(abs);
      restored.push(`removed ${rel}`);
    }
  }

  const manifestPath = join(root, "data", "image-prompts", `${input.date}.json`);
  const manifest = await readJsonFile<Array<Record<string, unknown>>>(manifestPath, []);
  await writeJsonAtomic(manifestPath, [
    ...manifest.filter((item) => item.slot !== input.slotNumber),
    ...snapshot.manifest_entries
  ]);
  const imageSourcesPath = join(root, "data", "image-sources", `${input.date}.json`);
  const imageSources = await readJsonFile<Array<Record<string, unknown>>>(imageSourcesPath, []);
  await writeJsonAtomic(imageSourcesPath, [
    ...imageSources.filter((item) => item.slot !== input.slotNumber),
    ...snapshot.image_sources
  ]);
  const videoSourcesPath = join(root, "data", "video-sources", `${input.date}.json`);
  const videoSources = await readJsonFile<Array<Record<string, unknown>>>(videoSourcesPath, []);
  await writeJsonAtomic(videoSourcesPath, videoSources.filter((item) => item.slot !== input.slotNumber));
  const runPath = videoRunReportPath(input.date, input.slotNumber, root);
  if (await fileExists(runPath)) {
    await rm(runPath);
    restored.push("video run report");
  }

  console.log(
    `${input.date} slot ${input.slotNumber} restored: ${restored.join(", ")}. ` +
      `If the day already has an approval log, re-run auto-approve so image digests match again.`
  );
  return { restored };
}

/** CLI arguments for a one-off schedule. --slot is mandatory: the old default of 2 is what overwrote 2026-09-04's evening post. */
export function parseScheduleCliArgs(args: string[]): {
  date: string;
  conceptId: string;
  slot: number;
  variant?: AbVariant;
  force: boolean;
} {
  const date = getOption(args, "date");
  const conceptId = getOption(args, "concept");
  if (!date || !conceptId) {
    throw new Error("Required: --date YYYY-MM-DD --concept <id> --slot 2|3, or --restore --date --slot, --heal, or --plan.");
  }
  const slot = getNumberOption(args, "slot");
  if (slot === undefined) {
    throw new Error(
      "Required: --slot 2|3 (noon Reel = 3, evening Reel = 2). schedule-reel no longer defaults to slot 2: " +
        "on 2026-09-04 that default overwrote an approved evening carousel with the noon Reel."
    );
  }
  const variantRaw = getOption(args, "variant");
  const variant: AbVariant | undefined = variantRaw === "15s" || variantRaw === "10s" ? variantRaw : undefined;
  return { date, conceptId, slot, variant, force: getFlag(args, "force") };
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
      // The legacy plan is the single evening Reel; say so instead of relying on a default.
      await scheduleReel({ date: entry.date, conceptId: entry.conceptId, slot: 2, root: getOption(args, "root") });
    }
    return;
  }

  if (getFlag(args, "restore")) {
    const date = getOption(args, "date");
    const slot = getNumberOption(args, "slot");
    if (!date || slot === undefined) throw new Error("Required: --restore --date YYYY-MM-DD --slot N");
    await restoreReelSlot({ date, slotNumber: slot, root: getOption(args, "root") });
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

  const { date, conceptId, slot, variant, force } = parseScheduleCliArgs(args);
  await scheduleReel({ date, conceptId, slot, variant, force, root: getOption(args, "root") });
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
