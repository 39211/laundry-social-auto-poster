import { writeApprovalLog } from "../../src/logging";
import type { DailyContent, DailySlot, PostInput, PostResult } from "../../src/types";

export const DATE = "2026-08-20";

export const noNetwork = (async () => {
  throw new Error("network disabled in test");
}) as unknown as typeof fetch;

export function makeSlot(n: number): DailySlot {
  return {
    slot: n,
    time: n === 1 ? "08:00" : "18:00",
    category: n === 1 ? "知識文" : "情境文",
    topic: `unit-test topic ${n}`,
    media_type: "image",
    instagram_caption: `unit-test instagram caption ${n}`,
    facebook_caption: `unit-test facebook caption ${n}`,
    image_prompt: "unit-test prompt",
    visual_route: "macro-detail",
    traffic_route: "dwell-detail",
    local_image_path: `output/images/${DATE}/slot-${n}.png`,
    public_image_url: `https://assets.invalid/laundry/${DATE}/slot-${n}.png`,
    status: "pending"
  };
}

export function makeContent(): DailyContent {
  return {
    date: DATE,
    timezone: "Asia/Taipei",
    generated_at: "2026-08-19T20:00:00.000Z",
    slots: [makeSlot(1), makeSlot(2)]
  };
}

export async function approveAll(root: string): Promise<void> {
  await writeApprovalLog(
    DATE,
    [1, 2].flatMap((slot) =>
      (["facebook", "instagram"] as const).map((platform) => ({
        date: DATE,
        slot,
        platform,
        status: "approved" as const,
        approved_by: "unit-test",
        created_at: "2026-08-19T21:00:00.000Z"
      }))
    ),
    root
  );
}

export function publishedAs(platform: "facebook" | "instagram") {
  return async (input: PostInput): Promise<PostResult> => ({
    platform,
    status: "success",
    dry_run: false,
    attempts: 1,
    post_id: `${platform === "facebook" ? "fb" : "ig"}-${input.slot}`
  });
}
