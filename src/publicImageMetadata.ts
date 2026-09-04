import * as fs from "node:fs";
import { join } from "node:path";
import { isMain } from "./cli";

export interface PublicImageMetadataResult {
  path: string;
  imageCount: number;
  missingWebp: string[];
  basePath: string;
}

/** Injected env is the only base-path source besides sitemap inference. Never read process.env here. */
export interface RegeneratePublicImageMetadataOptions {
  env?: NodeJS.ProcessEnv;
}

const PNG_HEADER_BYTES = 24;

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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(pngPath: string, relativePath: string): { width: number; height: number } {
  const fd = fs.openSync(pngPath, "r");
  try {
    const buf = Buffer.alloc(PNG_HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, PNG_HEADER_BYTES, 0);
    if (n === 0) throw new Error(`${relativePath}: 0 bytes`);
    for (let i = 0; i < Math.min(n, PNG_SIGNATURE.length); i++) {
      if (buf[i] !== PNG_SIGNATURE[i]) throw new Error(`${relativePath}: not png`);
    }
    if (n < PNG_HEADER_BYTES) throw new Error(`${relativePath}: truncated`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function resolveBasePath(locs: string[], options?: RegeneratePublicImageMetadataOptions): string {
  const siteUrl = options?.env?.PUBLIC_SITE_BASE_URL;
  if (siteUrl) {
    return dirPrefix(new URL(siteUrl).pathname.replace(/\/?$/u, "/"));
  }
  return commonDirPrefix(locs.map((loc) => new URL(loc).pathname));
}

function regeneratePublicImageMetadataAt(
  root: string,
  options?: RegeneratePublicImageMetadataOptions
): PublicImageMetadataResult {
  const docsRoot = join(root, "docs");
  const sitemap = fs.readFileSync(join(docsRoot, "sitemap.xml"), "utf8");
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
    const html = fs.readFileSync(htmlPath, "utf8");
    for (const match of html.matchAll(/<img\b([^>]*)>/gu)) {
      const attrs = match[1] ?? "";
      const src = attrs.match(/\bsrc="([^"]+)"/u)?.[1];
      if (!src || !/\.png(?:$|\?)/iu.test(src)) continue;
      const assetPath = siteRelative(src, loc).replace(/\?.*$/u, "");
      if (images[assetPath]) continue;
      const pngPath = join(docsRoot, assetPath);
      const webpPath = assetPath.replace(/\.png$/iu, ".webp");
      let size: { width: number; height: number };
      if (fs.existsSync(pngPath)) {
        size = pngSize(pngPath, assetPath);
      } else {
        // Sparse checkouts (CI) may lack the binary; the HTML already declares the size.
        const w = attrs.match(/\bwidth="(\d+)"/u)?.[1];
        const h = attrs.match(/\bheight="(\d+)"/u)?.[1];
        if (!w || !h) throw new Error(`${assetPath}: png missing and no width/height on <img> in ${rel || "index"}`);
        size = { width: Number(w), height: Number(h) };
      }
      if (!fs.existsSync(join(docsRoot, webpPath))) missingWebp.push(webpPath);
      images[assetPath] = { width: size.width, height: size.height, webp_path: webpPath };
    }
  }
  const sorted = Object.fromEntries(Object.keys(images).sort().map((k) => [k, images[k]]));
  const out = { schema_version: 1, source: "sitemap HTML image references", images: sorted };
  const outDir = join(root, "docs-internal");
  fs.mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "public-image-metadata.json");
  fs.writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`base path: ${basePath}; images: ${Object.keys(sorted).length}; missing webp: ${missingWebp.length}`);
  for (const missing of missingWebp) console.log("  MISSING WEBP", missing);
  return { path, imageCount: Object.keys(sorted).length, missingWebp, basePath };
}

export function regeneratePublicImageMetadata(
  root: string,
  options?: RegeneratePublicImageMetadataOptions
): PublicImageMetadataResult {
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
  try {
    regeneratePublicImageMetadata(process.argv[2] ?? process.cwd(), { env: process.env });
  } catch (error: unknown) {
    console.error(error);
    process.exitCode = 1;
  }
}
