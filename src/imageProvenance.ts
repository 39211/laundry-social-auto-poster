import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDailyContent } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { projectRoot } from "./paths";

// Whether a day's images still carry the C2PA manifest the image model writes.
// Meta reads that manifest, not the pixels, to decide whether to show its "AI
// info" label, so a realistic-looking prompt changes nothing here and a resize
// that re-encodes the file silently drops it. Reporting the real state keeps
// that from being something discovered by accident after publishing.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const C2PA_CHUNK = "caBX";

export interface ImageProvenance {
  image_path: string;
  ai_manifest: boolean;
  manifest_bytes?: number;
}

export interface DailyImageProvenance {
  date: string;
  images: ImageProvenance[];
  with_manifest: number;
  without_manifest: number;
  consistent: boolean;
}

export function findC2paManifestSize(png: Buffer): number | undefined {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;

  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("latin1");
    if (type === C2PA_CHUNK) return length;
    if (type === "IEND") return undefined;
    // length + 4 length bytes + 4 type bytes + 4 CRC bytes
    offset += length + 12;
  }
  return undefined;
}

export async function inspectDailyImageProvenance(
  date: string,
  root = projectRoot()
): Promise<DailyImageProvenance> {
  const content = await loadDailyContent(date, root);
  const images: ImageProvenance[] = [];

  for (const slot of content?.slots ?? []) {
    for (const asset of imageAssetsForSlot(slot)) {
      const path = asset.local_image_path;
      try {
        const size = findC2paManifestSize(await readFile(join(root, ...path.split("/"))));
        images.push(
          size === undefined
            ? { image_path: path, ai_manifest: false }
            : { image_path: path, ai_manifest: true, manifest_bytes: size }
        );
      } catch {
        // A missing file is the publishable-image gate's job to report, not this one.
      }
    }
  }

  const withManifest = images.filter((item) => item.ai_manifest).length;
  return {
    date,
    images,
    with_manifest: withManifest,
    without_manifest: images.length - withManifest,
    // A day that is part manifest and part none means something re-encoded only
    // some files, which is worth seeing rather than averaging away.
    consistent: images.length === 0 || withManifest === 0 || withManifest === images.length
  };
}
