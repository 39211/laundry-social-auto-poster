import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { generateDailyContent } from "./generateDailyContent";
import {
  GENERATION_AUTHORIZATION_SOURCE,
  loadGenerationAuthorization
} from "./generationAuthorization";
import { loadDailyContent, writeJsonAtomic } from "./logging";
import { projectRoot, relativeVideoAssetPath, videoCandidateManifestPath } from "./paths";
import { getZonedDateParts } from "./scheduler";
import type { MediaType, VideoCandidatePlan } from "./types";
import { profileForVideoTopic, type VideoItemCategory } from "./videoItemProfiles";

export interface VideoCandidateManifestItem extends VideoCandidatePlan {
  date: string;
  slot: number;
  topic: string;
  generation_route: "grok-imagine-video-1.5";
  preferred_submission_route: "hermes-xai-oauth-subscription";
  runtime_policy_gate_required: true;
  owner_generation_requested: true;
  // Read from data/publishing-policy.json#paid_video_budget, never asserted
  // here: this manifest used to hardcode true while the retired preproduction
  // contract said false, and neither was a decision (BOARD0817-ABSORB).
  generation_authorized: boolean;
  generation_authorization_source: typeof GENERATION_AUTHORIZATION_SOURCE;
  generation_blockers: string[];
  handoff_status: "generation_ready" | "blocked_unauthorized";
  asset_package: "four-images-plus-companion-video";
  image_count: 4;
  raw_generation_seconds: 6;
  final_master_seconds: 12;
  final_master_resolution: "1080x1920";
  instagram_carousel_derivative_resolution: "1080x1350";
  generated_clip_audio_used: false;
  tts_language: "zh-TW";
  tts_script: string;
  hook_variants: [string, string, string];
  selected_hook_index: 0;
  iteration_variable: "hook_only";
  postproduction_layers: string[];
  grok_review_required: true;
  sol_review_required: true;
  publish_authorized: false;
  included_in_kpi: false;
  current_publish_media_type: MediaType;
  formal_video_target_path: string;
  required_gates: [
    "preproduction_contract_locked",
    "screenplay_locked",
    "exact_ratio_first_frame_approved",
    "grok_mp4_returned",
    "ffprobe_passed",
    "full_decode_and_all_frame_review_passed",
    "grok_review_passed",
    "sol_review_passed",
    "separate_zh_tw_tts_reviewed",
    "owner_media_reviewed",
    "publish_approval_recorded"
  ];
  item_category?: VideoItemCategory;
  category_profile_version?: "2026-08-05-v1";
  category_prompt_directive?: string;
  category_guardrails?: string[];
  category_primary_metric?: "saves" | "shares" | "inquiries";
}

export async function writeVideoCandidateManifest(date: string, root = projectRoot()): Promise<string> {
  await generateDailyContent({ date, root });
  const content = await loadDailyContent(date, root);
  if (!content) throw new Error(`No content calendar found for ${date}`);

  const authorization = await loadGenerationAuthorization(date, root);

  const items: VideoCandidateManifestItem[] = content.slots.flatMap((slot) => {
    if (!slot.video_candidate) return [];
    const hookSubject = slot.video_candidate.memory_hook
      .replace(/也可以送洗$/, "")
      .replace(/先別/, "")
      .trim();

    const profile = profileForVideoTopic(slot.topic);

    return [
      {
        date,
        slot: slot.slot,
        topic: slot.topic,
        ...slot.video_candidate,
        generation_route: "grok-imagine-video-1.5",
        preferred_submission_route: "hermes-xai-oauth-subscription",
        runtime_policy_gate_required: true,
        owner_generation_requested: true,
        generation_authorized: authorization.authorized,
        generation_authorization_source: authorization.source,
        generation_blockers: authorization.blockers,
        handoff_status: authorization.authorized ? "generation_ready" : "blocked_unauthorized",
        asset_package: "four-images-plus-companion-video",
        image_count: slot.media_package?.image_count ?? 4,
        raw_generation_seconds: 6,
        final_master_seconds: 12,
        final_master_resolution: "1080x1920",
        instagram_carousel_derivative_resolution: "1080x1350",
        generated_clip_audio_used: false,
        tts_language: "zh-TW",
        tts_script: `${slot.video_candidate.memory_hook}。拍好全貌和細節，LINE 預約台中全區免費收送。`,
        hook_variants: [
          slot.video_candidate.memory_hook,
          `${hookSubject}先別急著收`,
          `${hookSubject}這一處最容易漏看`
        ],
        selected_hook_index: 0,
        iteration_variable: "hook_only",
        postproduction_layers: [
          "0.0-1.5s：大字動態鉤子，直接說明這件物品可以送洗",
          "1.5-6.0s：保留 Grok 單一動作，加入局部放大框與節奏切點",
          "6.0-9.5s：以四張圖中的證據細節做快速蒙太奇，不假造清潔前後",
          "9.5-12.0s：LINE 預約與台中市全區免費收送品牌收尾"
        ],
        grok_review_required: true,
        sol_review_required: true,
        publish_authorized: false,
        included_in_kpi: false,
        current_publish_media_type: slot.media_type ?? "image",
        formal_video_target_path: relativeVideoAssetPath(date, slot.slot),
        required_gates: [
          "preproduction_contract_locked",
          "screenplay_locked",
          "exact_ratio_first_frame_approved",
          "grok_mp4_returned",
          "ffprobe_passed",
          "full_decode_and_all_frame_review_passed",
          "grok_review_passed",
          "sol_review_passed",
          "separate_zh_tw_tts_reviewed",
          "owner_media_reviewed",
          "publish_approval_recorded"
        ],
        item_category: profile.category,
        category_profile_version: profile.version,
        category_prompt_directive: profile.prompt_directive,
        category_guardrails: profile.forbidden_claims,
        category_primary_metric: profile.primary_metric
      }
    ];
  });

  const output = videoCandidateManifestPath(date, root);
  await writeJsonAtomic(output, items);
  return output;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  const output = await writeVideoCandidateManifest(date, root);
  console.log(`Video candidate manifest ready: ${output}`);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
