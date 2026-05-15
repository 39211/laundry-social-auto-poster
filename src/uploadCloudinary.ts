export interface DisabledUploadResult {
  disabled: true;
  reason: string;
}

export async function uploadCloudinary(): Promise<DisabledUploadResult> {
  return {
    disabled: true,
    reason:
      "Cloudinary is intentionally disabled in v1. Public image URLs are served from GitHub Pages /docs assets."
  };
}
