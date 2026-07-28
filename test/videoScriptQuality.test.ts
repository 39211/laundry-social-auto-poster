import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent } from "../src/contentPlan";
import { reviewVideoScript } from "../src/videoScriptQuality";
import type { VideoCandidateManifestItem } from "../src/generateVideoCandidate";

describe("video script quality", () => {
  it("passes both 2026-07-29 scripts with concrete objects and one-action prompts", () => {
    const content = buildDailyContent(
      "2026-07-29",
      getConfig({
        ...process.env,
        PUBLIC_IMAGE_BASE_URL: "https://39211.github.io"
      })
    );

    const reviews = content.slots.map((slot) => {
      const candidate = slot.video_candidate!;
      const subject = candidate.memory_hook.replace(/也可以送洗$/, "");
      return reviewVideoScript({
        date: content.date,
        slot: slot.slot,
        topic: slot.topic,
        ...candidate,
        generation_route: "grok-imagine-video-1.5",
        preferred_submission_route: "hermes-xai-oauth-subscription",
        runtime_policy_gate_required: true,
        owner_generation_requested: true,
        generation_authorized: true,
        handoff_status: "generation_ready",
        asset_package: "four-images-plus-companion-video",
        image_count: 4,
        raw_generation_seconds: 6,
        final_master_seconds: 12,
        final_master_resolution: "1080x1920",
        instagram_carousel_derivative_resolution: "1080x1350",
        generated_clip_audio_used: false,
        tts_language: "zh-TW",
        tts_script: `${candidate.memory_hook}。拍好全貌和細節，LINE 預約台中全區免費收送。`,
        hook_variants: [
          candidate.memory_hook,
          `${subject}先別急著收`,
          `${subject}這一處最容易漏看`
        ],
        selected_hook_index: 0,
        iteration_variable: "hook_only",
        postproduction_layers: [],
        grok_review_required: true,
        sol_review_required: true,
        publish_authorized: false,
        included_in_kpi: false,
        current_publish_media_type: "mixed-carousel",
        formal_video_target_path: `docs/assets/${content.date}/slot-0${slot.slot}.mp4`,
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
        ]
      } satisfies VideoCandidateManifestItem);
    });

    expect(reviews.map((item) => item.status)).toEqual(["pass", "pass"]);
    expect(reviews.every((item) => item.score >= 90)).toBe(true);
    expect(reviews.every((item) => item.blockers.length === 0)).toBe(true);
  });
});
