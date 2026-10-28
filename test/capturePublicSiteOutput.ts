import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { generatePublicSite } from "../src/generatePublicSite";
import { FIXTURE_NOW, writePublicSiteFixture } from "./helpers/publicSiteWriteFixture";

// Invoke with: node --import tsx test/capturePublicSiteOutput.ts <new-temp-root>
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("A new temporary output root is required");
await mkdir(root); // Refuse to reuse or overwrite a previous snapshot.
await writePublicSiteFixture(root);
await generatePublicSite({ root, now: FIXTURE_NOW, baseUrl: "https://example.invalid", statPublicAsset: () => ({ isFile: () => true }) });
const manifest: Record<string, string> = {};
async function walk(relative = ""): Promise<void> {
  const entries = await readdir(join(root, "docs", relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(path);
    else manifest[path] = createHash("sha256").update(await readFile(join(root, "docs", path))).digest("hex");
  }
}
await walk();
await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ root, files: Object.keys(manifest).length, now: FIXTURE_NOW }));
