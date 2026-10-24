// Which AI image generators the publish gate accepts as the record of who
// produced a carousel file. Kept in its own tiny module so the gate
// (generateImage.ts) and the dashboard (operationsDashboard.ts) read one list
// instead of each hard-coding a string.
//
// gpt-image-2      -- the Codex path scripts/generate-missing-images.ps1 tries first.
// google-agy-image -- Antigravity CLI `generate_image` (the owner's Google AI Pro
//                     login), used when the Codex quota is exhausted. 2026-09-05:
//                     the fleet burned the shared Codex quota and three days of
//                     slot 1/2 images did not exist; this is the second supplier.
export const PUBLISHABLE_IMAGE_SOURCES = ["gpt-image-2", "google-agy-image"] as const;

export type PublishableImageSource = (typeof PUBLISHABLE_IMAGE_SOURCES)[number];

export function isPublishableImageSource(source: string | undefined): source is PublishableImageSource {
  return (PUBLISHABLE_IMAGE_SOURCES as readonly string[]).includes(source ?? "");
}
