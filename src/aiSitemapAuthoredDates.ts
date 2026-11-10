/** Change only existing lastmod values; missing lastmods, membership, and metadata stay intact. */
export function syncAiSitemapAuthoredDates(
  xml: string,
  siteBaseUrl: string,
  authoredDates: ReadonlyMap<string, string>
): string {
  let base: URL;
  try { base = new URL(siteBaseUrl); } catch { return xml; }
  const rootPath = base.pathname.replace(/\/+$/, "");
  const prefix = rootPath + "/";
  return xml.replace(/<url\b[^>]*>[\s\S]*?<\/url>/g, (entry) => {
    const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) return entry;
    let url: URL;
    try { url = new URL(loc); } catch { return entry; }
    if (url.origin !== base.origin || url.search || url.hash) return entry;
    if (url.pathname !== rootPath && !url.pathname.startsWith(prefix)) return entry;
    const relative = url.pathname.slice(prefix.length);
    const path = !relative ? "index.html" : relative.endsWith("/") ? relative + "index.html" : relative;
    const date = authoredDates.get(path);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return entry;
    return entry.replace(/(<lastmod>)[^<]*(<\/lastmod>)/, `$1${date}$2`);
  });
}
