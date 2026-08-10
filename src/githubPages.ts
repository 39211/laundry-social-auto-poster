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
  // Reachability alone let any 200 pass -- an HTML error page or a stale
  // asset would be handed to Meta as the post image (luna, high). The
  // content-type must actually be media.
  const assertMediaType = (response: Response) => {
    const type = (response.headers?.get?.("content-type") ?? "").toLowerCase();
    if (type && !type.startsWith("image/") && !type.startsWith("video/")) {
      throw new Error(`Public media URL is not media (content-type ${type}): ${url}`);
    }
  };
  const head = await fetchImpl(url, { method: "HEAD" });
  if (head.ok) {
    assertMediaType(head);
    return;
  }

  const get = await fetchImpl(url, { method: "GET" });
  if (!get.ok) {
    throw new Error(`Public media URL is not reachable: ${url} (${get.status})`);
  }
  assertMediaType(get);
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
