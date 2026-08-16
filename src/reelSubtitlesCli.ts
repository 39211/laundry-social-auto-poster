// CLI wrapper for reelSubtitles, called by scripts/burn-narration-subs.ps1.
// Kept separate from the module so importing the module in tests never runs
// the CLI. Narration text arrives via file, not argv — PowerShell quoting of
// Chinese punctuation across process boundaries is exactly the kind of place
// characters get eaten silently.
//
// Usage:
//   tsx src/reelSubtitlesCli.ts --narration-file f.txt --audio-seconds 9.312 \
//     --delay-ms 500 --video-seconds 14.0 --out out.ass

import { readFileSync, writeFileSync } from "node:fs";
import { narrationAss } from "./reelSubtitles";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return undefined;
  return process.argv[index + 1];
}

function requireArg(name: string): string {
  const value = argValue(name);
  if (value === undefined) {
    console.error(`Missing required argument: ${name}`);
    process.exit(2);
  }
  return value;
}

const narrationFile = requireArg("--narration-file");
const outPath = requireArg("--out");
const audioSeconds = Number(requireArg("--audio-seconds"));
const delayMs = Number(requireArg("--delay-ms"));
const videoSecondsRaw = argValue("--video-seconds");
const videoSeconds = videoSecondsRaw === undefined ? undefined : Number(videoSecondsRaw);

if (!Number.isFinite(audioSeconds) || audioSeconds <= 0) {
  console.error(`--audio-seconds must be a positive number, got ${audioSeconds}`);
  process.exit(2);
}
if (!Number.isFinite(delayMs) || delayMs < 0) {
  console.error(`--delay-ms must be a non-negative number, got ${delayMs}`);
  process.exit(2);
}
if (videoSeconds !== undefined && (!Number.isFinite(videoSeconds) || videoSeconds <= 0)) {
  console.error(`--video-seconds must be a positive number, got ${videoSecondsRaw}`);
  process.exit(2);
}

const narration = readFileSync(narrationFile, "utf8").replace(/^﻿/, "");
const { ass, cues } = narrationAss({
  narration,
  delaySeconds: delayMs / 1000,
  audioSeconds,
  videoSeconds,
});

const firstCue = cues.at(0);
const lastCue = cues.at(-1);
if (firstCue === undefined || lastCue === undefined) {
  console.error("Narration produced no subtitle cues; refusing to write an empty ASS file.");
  process.exit(3);
}

writeFileSync(outPath, ass, "utf8");
console.log(`cues=${cues.length} first=${firstCue.start.toFixed(2)}s last=${lastCue.end.toFixed(2)}s`);
