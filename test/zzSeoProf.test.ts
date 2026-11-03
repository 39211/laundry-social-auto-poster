import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { it } from "vitest";
import { generatePublicSite } from "../src/generatePublicSite";

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

it("profile seo override stages", { timeout: 120000 }, async () => {
  const out: string[] = [];
  let t = performance.now();
  const lap = (name: string) => {
    const x = performance.now();
    out.push(`PROFLAP ${name} ${Math.round(x - t)}ms`);
    t = x;
  };
  const src = join(__dirname, "..", "seo-overrides");
  const files = walk(src).filter((f) => !f.endsWith("README.md"));
  out.push(`PROFLAP files=${files.length}`);
  const root = mkdtempSync(join(tmpdir(), "prof-"));
  lap("start");
  await cp(src, join(root, "seo-overrides"), { recursive: true });
  lap("fs.cp recursive");
  const seqDir = join(root, "seq");
  for (const f of files) {
    const to = join(seqDir, relative(src, f));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(f, to);
  }
  lap("sequential copyFile");
  const parDir = join(root, "par");
  await Promise.all([...new Set(files.map((f) => dirname(join(parDir, relative(src, f)))))].map((d) => mkdir(d, { recursive: true })));
  await Promise.all(files.map((f) => copyFile(f, join(parDir, relative(src, f)))));
  lap("parallel copyFile");
  await Promise.all(files.map((f) => readFile(f)));
  lap("parallel readFile x1");
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "docs", "content-calendar"), { recursive: true });
  await writeFile(join(root, "data", "business-profile.json"), await readFile(join(process.cwd(), "data", "business-profile.json"), "utf8"));
  lap("setup");
  const log = console.log;
  console.log = () => {};
  await generatePublicSite({ root, siteBaseUrl: "https://sixiangjialaundry.com/", imageBaseUrl: "https://sixiangjialaundry.com/" });
  console.log = log;
  lap("generatePublicSite (incl. its own override copy)");
  await Promise.all(files.map((f) => readFile(join(root, "docs", relative(src, f)))));
  lap("parallel read generated");
  process.stdout.write(out.join("\n") + "\n");
});
