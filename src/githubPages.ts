import { publicAssetPath } from "./paths";

export function buildGitHubPagesImageUrl(baseUrl: string, date: string, slot: number): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return `${normalizedBase}/${publicAssetPath(date, slot)}`;
}

export async function verifyPublicImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const head = await fetchImpl(url, { method: "HEAD" });
  if (head.ok) return;

  const get = await fetchImpl(url, { method: "GET" });
  if (!get.ok) {
    throw new Error(`Public image URL is not reachable: ${url} (${get.status})`);
  }
}
