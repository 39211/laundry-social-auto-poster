import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getOption, isMain } from "./cli";
import { getConfig } from "./config";
import {
  writeVideoCandidateManifest,
  type VideoCandidateManifestItem
} from "./generateVideoCandidate";
import { readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot, videoCandidateManifestPath } from "./paths";
import { getZonedDateParts } from "./scheduler";

interface VideoScriptReviewItem {
  date: string;
  slot: number;
  topic: string;
  score: number;
  status: "pass" | "revise";
  blockers: string[];
  improvements: string[];
  selected_hook: string;
  hook_variants: [string, string, string];
  iteration_contract: string;
}

export interface VideoScriptReviewReport {
  version: "2026-07-28-v1";
  date: string;
  generated_at: string;
  pass_threshold: 90;
  research_basis: Array<{
    source: string;
    applied_rule: string;
    evidence_type: "official" | "community-experience";
  }>;
  summary: {
    reviewed: number;
    passed: number;
    revise: number;
    gate_passed: boolean;
  };
  items: VideoScriptReviewItem[];
  publish_authorized: false;
  included_in_kpi: false;
}

function textLength(value: string): number {
  return Array.from(value.replace(/\s/g, "")).length;
}

export function reviewVideoScript(item: VideoCandidateManifestItem): VideoScriptReviewItem {
  let score = 0;
  const blockers: string[] = [];
  const improvements: string[] = [];
  const hookLength = textLength(item.memory_hook);
  const ttsLength = textLength(item.tts_script);
  const prompt = item.grok_motion_prompt.toLowerCase();

  if (hookLength >= 4 && hookLength <= 18) score += 15;
  else {
    blockers.push(`hook_length_${hookLength}_outside_4_18`);
    improvements.push("把第一句縮成物件＋衝突或物件＋可送洗，1.5 秒內能理解。");
  }

  if (ttsLength >= 18 && ttsLength <= 50) score += 15;
  else {
    blockers.push(`tts_length_${ttsLength}_outside_18_50`);
    improvements.push("縮短 TTS，只保留物件、一次判斷與 LINE CTA。");
  }

  if (
    item.conflict.length >= 15 &&
    item.single_action.length >= 20 &&
    item.payoff.length >= 10 &&
    item.cta.includes("LINE")
  ) {
    score += 20;
  } else {
    blockers.push("story_contract_incomplete");
    improvements.push("補齊一個衝突、一個動作、一個 payoff 與一個 LINE CTA。");
  }

  const motionChecks = [
    prompt.includes("one dominant action only"),
    /preserve exactly|preserve the exact/.test(prompt),
    prompt.includes("five fingers"),
    /no extra limbs|no extra hands/.test(prompt),
    /no duplicate object|no duplicated/.test(prompt),
    /no morphing|no geometry changes/.test(prompt)
  ];
  const motionScore = motionChecks.filter(Boolean).length * 5;
  score += motionScore;
  if (motionScore < 30) {
    blockers.push("motion_prompt_physics_gate_failed");
    improvements.push("補足單一動作、物件數量、手指、重複物件與幾何保持條件。");
  }

  if (
    item.first_frame_direction.includes("固定直式") &&
    item.first_frame_direction.includes("前景") &&
    /中景|中後景/.test(item.first_frame_direction)
  ) {
    score += 10;
  } else {
    improvements.push("首幀補上固定直式鏡位與前中後景層次，避免空畫面。");
  }

  if (
    /no (readable )?text/.test(prompt) &&
    prompt.includes("no logo") &&
    prompt.includes("no watermark") &&
    !/保證|完全去除|恢復全新|一定洗白|百分之百/.test(
      `${item.memory_hook}${item.payoff}${item.tts_script}`
    )
  ) {
    score += 10;
  } else {
    blockers.push("claim_or_generated_text_safety_failed");
    improvements.push("移除生成文字、標誌、浮水印要求或不可驗證成效承諾。");
  }

  if (item.single_action.includes("代表「")) {
    blockers.push("abstract_placeholder_in_action");
    improvements.push("把抽象主題改成可拍攝的明確物件與具體動作。");
  }

  return {
    date: item.date,
    slot: item.slot,
    topic: item.topic,
    score,
    status: score >= 90 && blockers.length === 0 ? "pass" : "revise",
    blockers,
    improvements,
    selected_hook: item.hook_variants[item.selected_hook_index],
    hook_variants: item.hook_variants,
    iteration_contract:
      "同一輪保持主體、body、動作、TTS 後半與 CTA 不變，只測 hook；發布滿 72 小時後以 reach、views、saves、shares、LINE clicks、inquiries、bookings 決定保留或淘汰。"
  };
}

export async function writeVideoScriptReview(
  date: string,
  root = projectRoot(),
  now = new Date()
): Promise<string> {
  await writeVideoCandidateManifest(date, root);
  const candidates = await readJsonFile<VideoCandidateManifestItem[]>(
    videoCandidateManifestPath(date, root),
    []
  );
  const items = candidates.map(reviewVideoScript);
  const passed = items.filter((item) => item.status === "pass").length;
  const output: VideoScriptReviewReport = {
    version: "2026-07-28-v1",
    date,
    generated_at: now.toISOString(),
    pass_threshold: 90,
    research_basis: [
      {
        source: "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
        applied_rule: "9:16、音訊與關鍵訊息安全區",
        evidence_type: "official"
      },
      {
        source: "https://ads.tiktok.com/help/article/creative-best-practices",
        applied_rule: "前 3 秒交代內容主張，hook、body、CTA 結構",
        evidence_type: "official"
      },
      {
        source: "https://x.ai/news/grok-imagine-video-1-5",
        applied_rule: "6 秒 Grok 原片、image-to-video、明確描述單一動作",
        evidence_type: "official"
      },
      {
        source: "https://x.com/generatedbyann/status/2081759693563977870",
        applied_rule: "一次只改 hook，避免無法歸因",
        evidence_type: "community-experience"
      }
    ],
    summary: {
      reviewed: items.length,
      passed,
      revise: items.length - passed,
      gate_passed: items.length === 2 && passed === 2
    },
    items,
    publish_authorized: false,
    included_in_kpi: false
  };
  const outputDir = join(root, "data", "video-script-reviews");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${date}.json`);
  await writeJsonAtomic(outputPath, output);
  return outputPath;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") || getZonedDateParts(new Date(), config.timezone).date;
  const root = projectRoot(getOption(args, "root"));
  const output = await writeVideoScriptReview(date, root);
  const report = await readJsonFile<VideoScriptReviewReport | undefined>(output, undefined);
  console.log(`Video script review ready: ${output}`);
  if (!report?.summary.gate_passed) {
    throw new Error(`Video script quality gate failed for ${date}.`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
