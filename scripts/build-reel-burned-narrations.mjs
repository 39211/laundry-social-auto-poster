// Restore the narration burned into each canonical reel by reading the
// official run directory's same-stem `.ass` files. No git/mtime inference:
// that heuristic was falsified (SXJ-REELQ r8/r9). Concepts without `.ass`
// are printed as `NO_ASS <id>` and omitted from the registry.
//
//   node scripts/build-reel-burned-narrations.mjs [--print-only] [--repo DIR] [--run-dir DIR] [--ass-dir DIR] [--out FILE]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_REL = "output/reels-run/2026-07-29";
const TS_REL = join("src", "reelConcepts.ts");
const JSON_REL = join("data", "reel-concepts-extension.json");
const ASS_OVERRIDE_BLOCK = /\{[^}]*\}/gu;
const EXPECTED_CONCEPTS = 26;
const EXPECTED_ASS = 13;

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function assStartToCs(start) {
  const trimmed = String(start ?? "").trim();
  const dot = trimmed.lastIndexOf(".");
  const hms = dot >= 0 ? trimmed.slice(0, dot) : trimmed;
  const csRaw = dot >= 0 ? trimmed.slice(dot + 1) : "0";
  const parts = hms.split(":").map(Number);
  const cs = Number(csRaw);
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n)) || Number.isNaN(cs)) return 0;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds * 100 + cs;
}

function narrationFromAss(contents) {
  const events = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!/^Dialogue:/i.test(line)) continue;
    const payload = line.replace(/^Dialogue:\s*/i, "");
    const parts = payload.split(",");
    if (parts.length < 10) continue;
    const text = parts.slice(9).join(",").replace(ASS_OVERRIDE_BLOCK, "").replace(/\\N/gi, "").trim();
    if (!text) continue;
    events.push({ start: assStartToCs(parts[1] ?? ""), index: events.length, text });
  }
  events.sort((a, b) => a.start - b.start || a.index - b.index);
  const joined = events.map((event) => event.text).join("");
  return joined.length > 0 ? joined : undefined;
}

function extractFromTs(src) {
  const out = {};
  const start = src.indexOf("export const REEL_CONCEPTS");
  const slice = start >= 0 ? src.slice(start) : src;
  for (const block of slice.split(/\n  \{/)) {
    const id = block.match(/id:\s*"([^"]+)"/);
    const nar = block.match(/narration:\s*(?:\n\s*)?"((?:\\.|[^"\\])*)"/);
    if (id && nar) out[id[1]] = nar[1].replace(/\\n/g, "\n");
  }
  return out;
}

function extractFromJson(src) {
  const out = {};
  try {
    const parsed = JSON.parse(src.replace(/^\uFEFF/u, ""));
    for (const entry of parsed.concepts ?? []) {
      if (entry && typeof entry.id === "string" && typeof entry.narration === "string") {
        out[entry.id] = entry.narration;
      }
    }
    if (Object.keys(out).length > 0) return out;
  } catch {
    // Historical JSON may contain raw control characters; fall through.
  }
  const re = /"id"\s*:\s*"([^"]+)"[\s\S]*?"narration"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match;
  while ((match = re.exec(src))) {
    out[match[1]] = match[2].replace(/\\n/g, "\n");
  }
  return out;
}

function currentConceptIds(repo) {
  const ids = [];
  const seen = new Set();
  const ts = extractFromTs(readFileSync(join(repo, TS_REL), "utf8"));
  for (const id of Object.keys(ts)) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const jsPath = join(repo, JSON_REL);
  if (existsSync(jsPath)) {
    const js = extractFromJson(readFileSync(jsPath, "utf8"));
    for (const id of Object.keys(js)) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

function findRunDir(repo) {
  const fromArg = argValue("--run-dir");
  if (fromArg) return resolve(fromArg);
  const candidates = [
    join(repo, "output", "reels-run", "2026-07-29"),
    resolve(repo, "..", "..", "..", "output", "reels-run", "2026-07-29")
  ];
  return candidates.find((dir) => existsSync(join(dir, "reels")));
}

function assFileFor(reelsDir, id) {
  const stem = join(reelsDir, `${id}.ass`);
  if (existsSync(stem)) return stem;
  const mp4Ass = join(reelsDir, `${id}.mp4.ass`);
  if (existsSync(mp4Ass)) return mp4Ass;
  return undefined;
}

export function sha256File(path) {
  const text = readFileSync(path).toString("utf8").replace(/^\uFEFF/u, "").replace(/\r\n/g, "\n");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function fold(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const argv = resolve(process.argv[1]);
  try {
    return fold(realpathSync(self)) === fold(realpathSync(argv));
  } catch {
    return fold(self) === fold(argv);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(argValue("--repo") ?? join(here, ".."));

function main() {
  const assDirArg = argValue("--ass-dir");
  const assDir = assDirArg ? resolve(assDirArg) : undefined;
  if (assDir && !existsSync(assDir)) {
    console.error(`--ass-dir not found: ${assDir}`);
    process.exit(1);
  }
  const runDir = assDir ? undefined : findRunDir(repo);
  if (!assDir && !runDir) {
    console.error(`official run dir not found (looked under ${repo} and three parents)`);
    process.exit(1);
  }
  const reelsDir = assDir ?? join(runDir, "reels");
  const printOnly = process.argv.includes("--print-only");
  const outPath = resolve(argValue("--out") ?? join(repo, "data", "reel-burned-narrations.json"));

  const ids = currentConceptIds(repo);
  if (ids.length !== EXPECTED_CONCEPTS) {
    console.error(`expected ${EXPECTED_CONCEPTS} concept ids, got ${ids.length}: ${ids.join(",")}`);
    process.exit(1);
  }

  const generatedFrom = {};
  const narrations = {};

  for (const id of ids) {
    const assPath = assFileFor(reelsDir, id);
    if (!assPath) {
      console.error(`NO_ASS ${id}`);
      continue;
    }
    const raw = readFileSync(assPath);
    const assText = narrationFromAss(raw.toString("utf8").replace(/^\uFEFF/u, ""));
    if (!assText) {
      console.error(`empty .ass narration for ${id}`);
      process.exit(1);
    }
    const filename = assPath.endsWith(".mp4.ass") ? `${id}.mp4.ass` : `${id}.ass`;
    generatedFrom[id] = {
      source: "ass",
      path: `${RUN_REL}/reels/${filename}`,
      sha256: sha256File(assPath)
    };
    narrations[id] = assText;
  }

  const assIds = Object.keys(narrations);
  if (assIds.length !== EXPECTED_ASS) {
    console.error(`expected ${EXPECTED_ASS} .ass entries, got ${assIds.length}`);
    process.exit(1);
  }

  const payload = {
    run: RUN_REL,
    generated_from: generatedFrom,
    narrations
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (printOnly) {
    process.stdout.write(json);
  } else {
    writeFileSync(outPath, json, "utf8");
    process.stdout.write(`wrote ${outPath}\n`);
  }
}

if (isDirectRun()) {
  main();
}
