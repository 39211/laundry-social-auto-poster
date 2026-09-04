import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { regeneratePublicImageMetadataSync } from "../src/publicImageMetadata";

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

function injected(base: string): { env: NodeJS.ProcessEnv } {
  return { env: { PUBLIC_SITE_BASE_URL: base } };
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

  it("uses injected env and ignores process.env PUBLIC_SITE_BASE_URL", async () => {
    const base = "https://sixiangjialaundry.com/";
    const root = await seedSite(base);
    const previous = process.env.PUBLIC_SITE_BASE_URL;
    process.env.PUBLIC_SITE_BASE_URL = "https://example.com/laundry-social-auto-poster/";
    try {
      const result = regeneratePublicImageMetadataSync(root, injected("https://sixiangjialaundry.com"));
      expect(result.basePath).toBe("/");
      expect(result.imageCount).toBe(2);
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_SITE_BASE_URL;
      else process.env.PUBLIC_SITE_BASE_URL = previous;
    }
  });

  it("names the relative path when a png is not a png", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.png"), "not-a-png");
    expect(() => regeneratePublicImageMetadataSync(root, injected(base))).toThrow(
      /assets\/2026-07-02\/slot-01\.png: not png/
    );
  });

  it("names the relative path when a png is truncated", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    const truncated = Buffer.alloc(8);
    truncated.writeUInt32BE(0x89504e47, 0);
    truncated.writeUInt32BE(0x0d0a1a0a, 4);
    await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.png"), truncated);
    expect(() => regeneratePublicImageMetadataSync(root, injected(base))).toThrow(
      /assets\/2026-07-02\/slot-01\.png: truncated/
    );
  });

  it("names the relative path when a png is 0 bytes", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.png"), Buffer.alloc(0));
    expect(() => regeneratePublicImageMetadataSync(root, injected(base))).toThrow(
      /assets\/2026-07-02\/slot-01\.png: 0 bytes/
    );
  });

  it("reads PNG dimensions from the 24-byte header of a file larger than 1 MB", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    const huge = Buffer.concat([pngHeader(320, 240), Buffer.alloc(1_048_576, 0xff)]);
    await writeFile(join(root, "docs", "assets", "2026-07-02", "slot-01.png"), huge);
    const result = regeneratePublicImageMetadataSync(root, injected(base));
    const metadata = JSON.parse(await readFile(result.path, "utf8")) as {
      images: Record<string, { width: number; height: number }>;
    };
    expect(metadata.images["assets/2026-07-02/slot-01.png"]).toMatchObject({ width: 320, height: 240 });
  });

  it("creates docs-internal when the caller did not", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    expect(existsSync(join(root, "docs-internal"))).toBe(false);
    const result = regeneratePublicImageMetadataSync(root, injected(base));
    expect(existsSync(result.path)).toBe(true);
    expect(result.path.replaceAll("\\", "/")).toMatch(/docs-internal\/public-image-metadata\.json$/);
  });

  it("rewrites public-image-metadata.json when invoked without an isMain gate", async () => {
    const base = "https://example.com/laundry-social-auto-poster/";
    const root = await seedSite(base);
    const jsonPath = join(root, "docs-internal", "public-image-metadata.json");
    await mkdir(join(root, "docs-internal"), { recursive: true });
    await writeFile(jsonPath, '{"fake":true}\n');
    run(root);
    const after = JSON.parse(await readFile(jsonPath, "utf8")) as {
      fake?: boolean;
      schema_version: number;
      images: Record<string, unknown>;
    };
    expect(after.fake).toBeUndefined();
    expect(after.schema_version).toBe(1);
    expect(after.images["assets/2026-07-02/slot-01.png"]).toBeTruthy();
  });
});
