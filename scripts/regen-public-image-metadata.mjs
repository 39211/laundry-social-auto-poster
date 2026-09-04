// Regenerate docs-internal/public-image-metadata.json from the checked-in
// sitemap HTML, mirroring the "keeps checked-in ... image metadata consistent"
// test loop exactly: every <img src="*.png"> in every sitemap'd page.
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
// Run from the repo root after any publish that changes docs/ HTML:  node scripts/regen-public-image-metadata.mjs
const docsRoot = join(root, "docs");
const sitemap = await readFile(join(docsRoot, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not png");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const images = {};
let missingWebp = [];
for (const loc of locs) {
  const pathname = new URL(loc).pathname.replace(/^\//u, "");
  const htmlPath = pathname === "" ? join(docsRoot, "index.html")
    : pathname.endsWith("/") ? join(docsRoot, pathname, "index.html") : join(docsRoot, pathname);
  const html = await readFile(htmlPath, "utf8");
  for (const match of html.matchAll(/<img\b([^>]*)>/gu)) {
    const src = (match[1] ?? "").match(/\bsrc="([^"]+)"/u)?.[1];
    if (!src || !/\.png(?:$|\?)/iu.test(src)) continue;
    const assetPath = decodeURIComponent(new URL(src, "https://sixiangjialaundry.com/").pathname).replace(/^\//u, "");
    if (images[assetPath]) continue;
    const pngPath = join(docsRoot, assetPath);
    const webpPath = assetPath.replace(/\.png$/iu, ".webp");
    let size;
    if (existsSync(pngPath)) size = pngSize(await readFile(pngPath));
    else {
      // fall back to the width/height the HTML already declares
      const w = (match[1] ?? "").match(/\bwidth="(\d+)"/u)?.[1];
      const h = (match[1] ?? "").match(/\bheight="(\d+)"/u)?.[1];
      size = { width: Number(w), height: Number(h) };
    }
    if (!existsSync(join(docsRoot, webpPath))) missingWebp.push(webpPath);
    images[assetPath] = { width: size.width, height: size.height, webp_path: webpPath };
  }
}
const sorted = Object.fromEntries(Object.keys(images).sort().map((k) => [k, images[k]]));
const out = { schema_version: 1, source: "sitemap HTML image references", images: sorted };
await writeFile(join(root, "docs-internal", "public-image-metadata.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`images: ${Object.keys(sorted).length}; missing webp: ${missingWebp.length}`);
for (const m of missingWebp) console.log("  MISSING WEBP", m);
