import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const script = join(repoRoot, "scripts/service-intake-guides.mjs");

async function snapshotDocs(root: string): Promise<Record<string, string>> {
  const docs = join(root, "docs");
  const result: Record<string, string> = {};
  for (const path of await readdir(docs, { recursive: true })) {
    const absolute = join(docs, path);
    if (statSync(absolute).isFile()) result[path.replaceAll("\\", "/")] = (await readFile(absolute)).toString("base64");
  }
  return result;
}

function enrich(root: string, check = false): void {
  execFileSync(process.execPath, [script, ...(check ? ["--check"] : [])], {
    cwd: root, encoding: "utf8", timeout: 60000, stdio: "pipe"
  });
}

describe("two-page service intake build contract", () => {
  it("passes isolated tests and checked-in artifact integration without network or writes to docs", () => {
    execFileSync(process.execPath, ["--test", "scripts/service-intake-guides.test.mjs"], {
      cwd: repoRoot, encoding: "utf8", timeout: 60000, stdio: "pipe"
    });
  }, 65000);

  it("integrates with the real source generator and changes only five allowed output files", async () => {
    const root = await mkdtemp(join(tmpdir(), "laundry-real-intake-build-"));
    try {
      await mkdir(join(root, "data"), { recursive: true });
      await writeFile(join(root, "data/business-profile.json"), await readFile(join(repoRoot, "data/business-profile.json")));
      // URLs are output strings only. No calendar, approvals or production
      // files are written; the actual source generator runs in this temp root.
      const options = {
        root,
        baseUrl: "https://sixiangjialaundry.com",
        siteBaseUrl: "https://sixiangjialaundry.com",
        imageBaseUrl: "https://sixiangjialaundry.com",
        now: "2026-09-12T00:00:00.000Z"
      };
      await generatePublicSite(options);
      const before = await snapshotDocs(root);
      expect(() => enrich(root, true)).toThrow();
      enrich(root);
      const after = await snapshotDocs(root);
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      const changed = [...keys].filter(path => before[path] !== after[path]).sort();
      expect(changed).toEqual([
        "ai-sitemap.xml", "guides/luxury-dry-cleaning.html", "guides/plush-doll-cleaning.html",
        "scripts/service-intake.js", "sitemap.xml"
      ]);
      for (const slug of ["plush-doll-cleaning", "luxury-dry-cleaning"]) {
        const html = await readFile(join(root, `docs/guides/${slug}.html`), "utf8");
        expect(html).toContain(`data-service-intake="${slug}"`);
        expect(html).toContain(`go/line.html?source=guide-${slug}-inline`);
      }
      enrich(root, true);
      // Regenerating the real website followed by the posthook must not lose
      // the panel or cumulatively change unrelated outputs.
      await generatePublicSite(options);
      enrich(root);
      expect(await snapshotDocs(root)).toEqual(after);
      enrich(root, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 65000);
});
