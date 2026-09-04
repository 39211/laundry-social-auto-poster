// Regenerate docs-internal/public-image-metadata.json from the checked-in
// sitemap HTML, mirroring the "keeps checked-in ... image metadata consistent"
// test loop: every <img src="*.png"> in every sitemap'd page.
//
//   node scripts/regen-public-image-metadata.mjs [repo-root]
//
// Run after any publish that changes docs/ HTML; CI regenerates it and fails on
// drift (git diff --exit-code). The site may be deployed under a base path
// (PUBLIC_SITE_BASE_URL=https://host/sub/), so sitemap URLs are mapped to
// docs/ by stripping that base pathname first; it is taken from
// PUBLIC_SITE_BASE_URL when set, otherwise inferred as the longest common
// directory prefix of every <loc> in the sitemap.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const docsRoot = join(root, "docs");
const sitemap = await readFile(join(docsRoot, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length === 0) throw new Error("sitemap.xml has no <loc> entries");

function dirPrefix(pathname) {
  // "/sub/a/b.html" -> "/sub/a/", "/sub/" -> "/sub/"
  return pathname.endsWith("/") ? pathname : pathname.slice(0, pathname.lastIndexOf("/") + 1);
}
function commonDirPrefix(paths) {
  let prefix = dirPrefix(paths[0]);
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      const cut = prefix.slice(0, -1).lastIndexOf("/");
      prefix = prefix.slice(0, cut + 1);
      if (prefix === "/") return "/";
    }
  }
  return prefix;
}
const origin = new URL(locs[0]).origin;
const basePath = process.env.PUBLIC_SITE_BASE_URL
  ? dirPrefix(new URL(process.env.PUBLIC_SITE_BASE_URL).pathname.replace(/\/?$/u, "/"))
  : commonDirPrefix(locs.map((loc) => new URL(loc).pathname));

/** Site-relative path ("services/x.html", "assets/d/s.png") for an absolute or relative URL. */
function siteRelative(urlOrPath, pageUrl) {
  const pathname = decodeURIComponent(new URL(urlOrPath, pageUrl).pathname);
  if (!pathname.startsWith(basePath)) {
    throw new Error(`${pathname} is outside the site base path ${basePath}`);
  }
  return pathname.slice(basePath.length);
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const images = {};
const missingWebp = [];
for (const loc of locs) {
  const rel = siteRelative(loc, origin);
  const htmlPath = rel === "" ? join(docsRoot, "index.html")
    : rel.endsWith("/") ? join(docsRoot, rel, "index.html") : join(docsRoot, rel);
  const html = await readFile(htmlPath, "utf8");
  for (const match of html.matchAll(/<img\b([^>]*)>/gu)) {
    const attrs = match[1] ?? "";
    const src = attrs.match(/\bsrc="([^"]+)"/u)?.[1];
    if (!src || !/\.png(?:$|\?)/iu.test(src)) continue;
    const assetPath = siteRelative(src, loc).replace(/\?.*$/u, "");
    if (images[assetPath]) continue;
    const pngPath = join(docsRoot, assetPath);
    const webpPath = assetPath.replace(/\.png$/iu, ".webp");
    let size;
    if (existsSync(pngPath)) {
      size = pngSize(await readFile(pngPath));
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
await writeFile(join(root, "docs-internal", "public-image-metadata.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`base path: ${basePath}; images: ${Object.keys(sorted).length}; missing webp: ${missingWebp.length}`);
for (const m of missingWebp) console.log("  MISSING WEBP", m);
