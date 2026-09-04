// Restore the narration burned into each canonical reel by reading the
// official run directory (sidecars + mp4 mtime) and the git history of
// src/reelConcepts.ts + data/reel-concepts-extension.json.
//
//   node scripts/build-reel-burned-narrations.mjs [--print-only] [--repo DIR] [--run-dir DIR] [--out FILE]
//
// Lookup for the stored text: same-stem .ass (exact Dialogue join) when
// present, else git show of the commit chosen below. Commit selection:
//   1. mp4 mtime (fallback: .audio.json mtime)
//   2. git log --before=<mtime> -1 -- the two source files
//   3. if that commit has no concept id, walk forward to the first later
//      commit that does (concepts landed after the file mtime, e.g. 09-04 WIP)
//
// Validated: git text at that commit matches the 13 official .ass files
// after stripping punctuation. Refuse to write if that check fails.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_REL = join("output", "reels-run", "2026-07-29");
const TS_REL = join("src", "reelConcepts.ts");
const JSON_REL = join("data", "reel-concepts-extension.json");
const SOURCE_PATHS = [TS_REL, JSON_REL];
const ASS_OVERRIDE_BLOCK = /\{[^}]*\}/gu;

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function gitAllowFail(repo, args) {
  try {
    return git(repo, args);
  } catch {
    return "";
  }
}

function formatIso(date) {
  return date.toISOString();
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

function narrationsAt(repo, sha) {
  const out = {};
  const ts = gitAllowFail(repo, ["show", `${sha}:${TS_REL.replace(/\\/g, "/")}`]);
  if (ts) Object.assign(out, extractFromTs(ts));
  const js = gitAllowFail(repo, ["show", `${sha}:${JSON_REL.replace(/\\/g, "/")}`]);
  if (js) Object.assign(out, extractFromJson(js));
  return out;
}

function stripPunct(text) {
  return String(text ?? "").replace(/[^\w\u4e00-\u9fff]/gu, "");
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
    join(repo, RUN_REL),
    resolve(repo, "..", "..", "..", RUN_REL)
  ];
  return candidates.find((dir) => existsSync(join(dir, "reels")));
}

function sidecarFlags(reelsDir, id) {
  const stemAss = existsSync(join(reelsDir, `${id}.ass`));
  const mp4Ass = existsSync(join(reelsDir, `${id}.mp4.ass`));
  const subsPath = join(reelsDir, `${id}.mp4.subs.json`);
  const audioPath = join(reelsDir, `${id}.mp4.audio.json`);
  const subs = existsSync(subsPath);
  const audio = existsSync(audioPath);
  let subsText = false;
  if (subs) {
    try {
      const parsed = JSON.parse(readFileSync(subsPath, "utf8").replace(/^\uFEFF/u, ""));
      if (Array.isArray(parsed)) subsText = parsed.length > 0;
      else if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (
            typeof value === "string" &&
            value.trim() &&
            key !== "cli" &&
            key !== "burned_at" &&
            key !== "narration_sha256" &&
            !value.startsWith("cues=")
          ) {
            subsText = true;
          }
        }
      }
    } catch {
      subsText = false;
    }
  }
  return { stemAss, mp4Ass, subs, subsText, audio };
}

function productionMtime(reelsDir, id) {
  const mp4 = join(reelsDir, `${id}.mp4`);
  if (existsSync(mp4)) return statSync(mp4).mtime;
  const audio = join(reelsDir, `${id}.mp4.audio.json`);
  if (existsSync(audio)) return statSync(audio).mtime;
  return undefined;
}

function resolveCommit(repo, commitsNewest, cache, conceptId, mtimeIso) {
  const sha = git(repo, [
    "log",
    `--before=${mtimeIso}`,
    "-1",
    "--format=%H",
    "--",
    ...SOURCE_PATHS.map((p) => p.replace(/\\/g, "/"))
  ]);
  if (!sha) throw new Error(`no commit before ${mtimeIso} for ${conceptId}`);
  if (!cache[sha]) cache[sha] = narrationsAt(repo, sha);
  if (cache[sha][conceptId]) return sha;
  const idx = commitsNewest.indexOf(sha);
  if (idx < 0) throw new Error(`commit ${sha} not in log for ${conceptId}`);
  const newer = commitsNewest.slice(0, idx);
  for (const candidate of [...newer].reverse()) {
    if (!cache[candidate]) cache[candidate] = narrationsAt(repo, candidate);
    if (cache[candidate][conceptId]) {
      console.log(`WALK_FORWARD ${conceptId} ${sha.slice(0, 8)} -> ${candidate.slice(0, 8)}`);
      return candidate;
    }
  }
  throw new Error(`${conceptId} missing at ${sha.slice(0, 8)} and no later commit has it`);
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(argValue("--repo") ?? join(here, ".."));
const runDir = findRunDir(repo);
if (!runDir) {
  console.error(`official run dir not found (looked under ${repo} and three parents)`);
  process.exit(1);
}
const reelsDir = join(runDir, "reels");
const printOnly = process.argv.includes("--print-only");
const outPath = resolve(argValue("--out") ?? join(repo, "data", "reel-burned-narrations.json"));

const ids = currentConceptIds(repo);
if (ids.length !== 26) {
  console.error(`expected 26 concept ids, got ${ids.length}: ${ids.join(",")}`);
  process.exit(1);
}

console.log("Q0 sidecars");
for (const id of ids) {
  const flags = sidecarFlags(reelsDir, id);
  console.log(
    `${id}\tstem.ass=${flags.stemAss}\tmp4.ass=${flags.mp4Ass}\tsubs.json=${flags.subs}\tsubs_text=${flags.subsText}\taudio.json=${flags.audio}`
  );
}

const commitsNewest = git(repo, [
  "log",
  "--format=%H",
  "--",
  ...SOURCE_PATHS.map((p) => p.replace(/\\/g, "/"))
])
  .split(/\r?\n/)
  .filter(Boolean);
const cache = {};
const generatedFrom = {};
const narrations = {};
let assCount = 0;
let assMatch = 0;

console.log("Q1 git vs .ass");
for (const id of ids) {
  const mtime = productionMtime(reelsDir, id);
  if (!mtime) throw new Error(`no mp4 or audio.json for ${id}`);
  const mtimeIso = formatIso(mtime);
  const sha = resolveCommit(repo, commitsNewest, cache, id, mtimeIso);
  const gitText = cache[sha][id];
  if (!gitText) throw new Error(`empty git narration for ${id} at ${sha}`);
  const assPath = existsSync(join(reelsDir, `${id}.ass`))
    ? join(reelsDir, `${id}.ass`)
    : existsSync(join(reelsDir, `${id}.mp4.ass`))
      ? join(reelsDir, `${id}.mp4.ass`)
      : undefined;
  const assText = assPath
    ? narrationFromAss(readFileSync(assPath, "utf8").replace(/^\uFEFF/u, ""))
    : undefined;
  const source = assText ? "ass" : "git";
  const stored = assText ?? gitText;
  generatedFrom[id] = { commit: sha, source };
  narrations[id] = stored;
  let match = "n/a";
  if (assText) {
    assCount += 1;
    const ok = stripPunct(gitText) === stripPunct(assText);
    match = ok ? "yes" : "NO";
    if (ok) assMatch += 1;
    else {
      console.error(`MISMATCH ${id}`);
      console.error(`  GIT ${gitText}`);
      console.error(`  ASS ${assText}`);
    }
  }
  const first = stored.split(/(?<=[。！？.!?])/u).filter(Boolean)[0] ?? stored;
  console.log(`${id}\t${source}\t${sha}\t${match}\t${first}`);
}

console.log(`Q1 ${assMatch}/${assCount}`);
if (assCount !== 13 || assMatch !== 13) {
  console.error("refusing to write: git restore does not match 13/13 .ass files");
  process.exit(1);
}

const payload = {
  run: "output/reels-run/2026-07-29",
  generated_from: generatedFrom,
  narrations
};

const json = `${JSON.stringify(payload, null, 2)}\n`;
if (printOnly) {
  process.stdout.write(json);
} else {
  writeFileSync(outPath, json, "utf8");
  console.log(`wrote ${outPath}`);
}
