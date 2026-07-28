import { publicAssetPath, publicCarouselAssetPath, publicVideoAssetPath } from "./paths";

export function buildGitHubPagesImageUrl(baseUrl: string, date: string, slot: number): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/${publicAssetPath(date, slot)}`;
}

export function buildGitHubPagesCarouselImageUrl(
  baseUrl: string,
  date: string,
  slot: number,
  slide: number
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/${publicCarouselAssetPath(date, slot, slide)}`;
}

export function buildGitHubPagesVideoUrl(baseUrl: string, date: string, slot: number): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/${publicVideoAssetPath(date, slot)}`;
}

export async function verifyPublicAssetUrl(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const head = await fetchImpl(url, { method: "HEAD" });
  if (head.ok) return;

  const get = await fetchImpl(url, { method: "GET" });
  if (!get.ok) {
    throw new Error(`Public media URL is not reachable: ${url} (${get.status})`);
  }
}

export async function verifyPublicImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  try {
    await verifyPublicAssetUrl(url, fetchImpl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace("Public media URL", "Public image URL"));
  }
}
