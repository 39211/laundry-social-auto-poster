import { isMain } from "./cli";
import type { VideoPromptManifestItem } from "./generateVideo";

const DIRECT_GROK_VIDEO_DISABLED =
  "Direct Grok video generation is disabled by policy; use the Hermes/SuperGrok OAuth workflow.";

export interface GrokVideoRequest {
  model: "grok-imagine-video";
  prompt: string;
  duration: 10;
  aspect_ratio: "9:16";
  resolution: "720p";
}

/** Pure request construction remains available for offline review and tests. */
export function buildGrokVideoRequest(item: VideoPromptManifestItem): GrokVideoRequest {
  return {
    model: "grok-imagine-video",
    prompt: item.prompt,
    duration: 10,
    aspect_ratio: "9:16",
    resolution: "720p"
  };
}

/**
 * The raw xAI API-key implementation was intentionally removed. No argument,
 * environment variable, or test-like flag can restore a paid direct route.
 */
export async function generateGrokVideos(_options: {
  date: string;
  slot?: number;
  root?: string;
  force?: boolean;
}): Promise<never> {
  throw new Error(DIRECT_GROK_VIDEO_DISABLED);
}

async function main(): Promise<void> {
  throw new Error(DIRECT_GROK_VIDEO_DISABLED);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
