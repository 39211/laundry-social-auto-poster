import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "./cli";

export interface PublicImageMetadataResult {
  path: string;
  imageCount: number;
  missingWebp: string[];
  basePath: string;
}

export interface RegeneratePublicImageMetadataOptions {
  basePath?: string;
}

function dirPrefix(pathname: string): string {
  // "/sub/a/b.html" -> "/sub/a/", "/sub/" -> "/sub/"
  return pathname.endsWith("/") ? pathname : pathname.slice(0, pathname.lastIndexOf("/") + 1);
}

function commonDirPrefix(paths: string[]): string {
  const first = paths[0];
  if (first === undefined) return "/";
  let prefix = dirPrefix(first);
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      const cut = prefix.slice(0, -1).lastIndexOf("/");
      prefix = prefix.slice(0, cut + 1);
      if (prefix === "/") return "/";
    }
  }
  return prefix;
}

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function resolveBasePath(locs: string[], options?: RegeneratePublicImageMetadataOptions): string {
  if (options?.basePath !== undefined) return options.basePath;
  return process.env.PUBLIC_SITE_BASE_URL
    ? dirPrefix(new URL(process.env.PUBLIC_SITE_BASE_URL).pathname.replace(/\/?$/u, "/"))
    : commonDirPrefix(locs.map((loc) => new URL(loc).pathname));
}

function regeneratePublicImageMetadataAt(
  root: string,
  options?: RegeneratePublicImageMetadataOptions
): PublicImageMetadataResult {
  const docsRoot = join(root, "docs");
  const sitemap = readFileSync(join(docsRoot, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((loc): loc is string => Boolean(loc));
  if (locs.length === 0) throw new Error("sitemap.xml has no <loc> entries");
  const firstLoc = locs[0];
  if (!firstLoc) throw new Error("sitemap.xml has no <loc> entries");

  const origin = new URL(firstLoc).origin;
  const basePath = resolveBasePath(locs, options);

  /** Site-relative path ("services/x.html", "assets/d/s.png") for an absolute or relative URL. */
  function siteRelative(urlOrPath: string, pageUrl: string): string {
    const pathname = decodeURIComponent(new URL(urlOrPath, pageUrl).pathname);
    if (!pathname.startsWith(basePath)) {
      throw new Error(`${pathname} is outside the site base path ${basePath}`);
    }
    return pathname.slice(basePath.length);
  }

  const images: Record<string, { width: number; height: number; webp_path: string }> = {};
  const missingWebp: string[] = [];
  for (const loc of locs) {
    const rel = siteRelative(loc, origin);
    const htmlPath =
      rel === "" ? join(docsRoot, "index.html") : rel.endsWith("/") ? join(docsRoot, rel, "index.html") : join(docsRoot, rel);
    const html = readFileSync(htmlPath, "utf8");
    for (const match of html.matchAll(/<img\b([^>]*)>/gu)) {
      const attrs = match[1] ?? "";
      const src = attrs.match(/\bsrc="([^"]+)"/u)?.[1];
      if (!src || !/\.png(?:$|\?)/iu.test(src)) continue;
      const assetPath = siteRelative(src, loc).replace(/\?.*$/u, "");
      if (images[assetPath]) continue;
      const pngPath = join(docsRoot, assetPath);
      const webpPath = assetPath.replace(/\.png$/iu, ".webp");
      let size: { width: number; height: number };
      if (existsSync(pngPath)) {
        size = pngSize(readFileSync(pngPath));
      } else {
        // Sparse checkouts (CI) may lack the binary; the HTML already declares the size.
        const w = attrs.match(/\bwidth="(\d+)"/u)?.[1];
        const h = attrs.match(/\bheight="(\d+)"/u)?.[1];
        if (!w || !h) throw new Error(`${assetPath}: png missing and no width/height on <img> in ${rel || "index"}`);
        size = { width: Number(w), height: Number(h) };
      }
      if (!existsSync(join(docsRoot, webpPath))) missingWebp.push(webpPath);
      images[assetPath] = { width: size.width, height: size.height, webp_path: webpPath };
    }
  }
  const sorted = Object.fromEntries(Object.keys(images).sort().map((k) => [k, images[k]]));
  const out = { schema_version: 1, source: "sitemap HTML image references", images: sorted };
  const path = join(root, "docs-internal", "public-image-metadata.json");
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`base path: ${basePath}; images: ${Object.keys(sorted).length}; missing webp: ${missingWebp.length}`);
  for (const missing of missingWebp) console.log("  MISSING WEBP", missing);
  return { path, imageCount: Object.keys(sorted).length, missingWebp, basePath };
}

export async function regeneratePublicImageMetadata(
  root: string,
  options?: RegeneratePublicImageMetadataOptions
): Promise<PublicImageMetadataResult> {
  return regeneratePublicImageMetadataAt(root, options);
}

/** Sync entry used by publishPagesAssets so a throw fails the publish on this tick. */
export function regeneratePublicImageMetadataSync(
  root: string,
  options?: RegeneratePublicImageMetadataOptions
): PublicImageMetadataResult {
  return regeneratePublicImageMetadataAt(root, options);
}

if (isMain(import.meta.url)) {
  regeneratePublicImageMetadata(process.argv[2] ?? process.cwd()).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
