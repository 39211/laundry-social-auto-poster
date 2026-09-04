import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "regen-public-image-metadata.mjs");

/** Minimal PNG: signature + IHDR with the given size (the script only reads the header). */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

async function seedSite(base: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "regen-image-metadata-"));
  await mkdir(join(root, "docs", "services"), { recursive: true });
  await mkdir(join(root, "docs", "assets", "2026-07-02"), { recursive: true });
  await mkdir(join(root, "docs-internal"), { recursive: true });
  await writeFile(
    join(root, "docs", "sitemap.xml"),
    `<?xml version="1.0"?><urlset><url><loc>${base}</loc></url><url><loc>${base}services/price.html</loc></url></urlset>`
  );
  await writeFile(
    join(root, "docs", "index.html"),
    `<html><body><img src="${base}assets/2026-07-02/slot-01.png" width="1254" height="1254"></body></html>`
  );
  await writeFile(
    join(root, "docs", "services", "price.html"),
    // relative reference, plus a png the checkout does not carry (size comes from the attributes)
    `<html><body><img src="../assets/2026-07-02/slot-01.png" width="1254" height="1254"><img src="${base}assets/2026-07-02/slot-02.png" width="720" height="1280"></body></html>`
  );
  await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.png"), pngHeader(1254, 1254));
  await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.webp"), "webp");
  await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-02.webp"), "webp");
  return root;
}

function run(root: string, env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ["--import", "tsx", SCRIPT, root], {
    encoding: "utf8",
    env: { ...process.env, PUBLIC_SITE_BASE_URL: "", ...env }
  });
}

describe("regen-public-image-metadata", () => {
  it("maps sitemap URLs under a base path (GitHub project site) back onto docs/", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    const stdout = run(root);
    expect(stdout).toContain("base path: /laundry-social-auto-poster/");

    const metadata = JSON.parse(await readFile(join(root, "docs-internal", "public-image-metadata.json"), "utf8"));
    expect(Object.keys(metadata.images).sort()).toEqual(["assets/2026-07-02/slot-01.png", "assets/2026-07-02/slot-02.png"]);
    // slot-01 measured from the PNG header; slot-02 falls back to the <img> attributes.
    expect(metadata.images["assets/2026-07-02/slot-01.png"]).toEqual({
      width: 1254,
      height: 1254,
      webp_path: "assets/2026-07-02/slot-01.webp"
    });
    expect(metadata.images["assets/2026-07-02/slot-02.png"]).toEqual({
      width: 720,
      height: 1280,
      webp_path: "assets/2026-07-02/slot-02.webp"
    });
  });

  it("honours PUBLIC_SITE_BASE_URL over the inferred prefix and works at the domain root", async () => {
    const base = "https://sixiangjialaundry.com/";
    const root = await seedSite(base);
    const stdout = run(root, { PUBLIC_SITE_BASE_URL: "https://sixiangjialaundry.com" });
    expect(stdout).toContain("base path: /;");
    const metadata = JSON.parse(await readFile(join(root, "docs-internal", "public-image-metadata.json"), "utf8"));
    expect(Object.keys(metadata.images)).toHaveLength(2);
    expect(metadata.images["assets/2026-07-02/slot-01.png"].webp_path).toBe("assets/2026-07-02/slot-01.webp");
  });

  it("fails instead of guessing when a page URL is outside the base path", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    await writeFile(
      join(root, "docs", "sitemap.xml"),
      `<urlset><url><loc>${base}</loc></url><url><loc>https://example.com/other/page.html</loc></url></urlset>`
    );
    expect(() => run(root, { PUBLIC_SITE_BASE_URL: base })).toThrow(/outside the site base path/u);
  });
});
