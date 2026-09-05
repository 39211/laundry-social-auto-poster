// Prove the burned-narration registry is a live generator output, not an
// untouched committed file. Empty stdout (generator never ran) is a failure.
//
//   node scripts/check-reel-registry-drift.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const scriptRepo = resolve(join(here, ".."));
const root = resolve(process.env.PROJECT_ROOT || scriptRepo);

function countAssFiles(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => {
    if (!name.toLowerCase().endsWith(".ass")) return false;
    try {
      return statSync(join(dir, name)).isFile();
    } catch {
      return false;
    }
  }).length;
}

function preview(buf, offset) {
  return buf.subarray(offset).toString("utf8").slice(0, 120);
}

function firstDiff(actual, expected) {
  const n = Math.min(actual.length, expected.length);
  let i = 0;
  for (; i < n; i++) {
    if (actual[i] !== expected[i]) break;
  }
  if (i === n && actual.length === expected.length) return null;
  return i;
}

function main() {
  const generator = join(root, "scripts", "build-reel-burned-narrations.mjs");
  const assDir = join(root, "test", "fixtures", "reel-ass");
  const registryPath = join(root, "data", "reel-burned-narrations.json");

  const result = spawnSync(
    process.execPath,
    [generator, "--print-only", "--ass-dir", assDir, "--repo", root],
    { encoding: null, cwd: root, windowsHide: true }
  );

  const stdout = result.stdout && result.stdout.length > 0 ? result.stdout : Buffer.alloc(0);
  if (result.error || stdout.length === 0 || stdout.toString("utf8").trim() === "") {
    console.error("generator produced no output");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout.toString("utf8"));
  } catch {
    console.error("generator produced no output");
    process.exit(1);
  }

  const narrations =
    parsed && typeof parsed === "object" && parsed.narrations && typeof parsed.narrations === "object"
      ? parsed.narrations
      : undefined;
  if (!narrations) {
    console.error("generator produced no output");
    process.exit(1);
  }

  const narrationCount = Object.keys(narrations).length;
  const fixtureCount = countAssFiles(assDir);
  if (narrationCount !== fixtureCount) {
    console.error(`narrations count ${narrationCount} != fixture .ass count ${fixtureCount}`);
    process.exit(1);
  }

  if (!existsSync(registryPath)) {
    console.error(`committed registry missing: ${registryPath}`);
    process.exit(1);
  }
  const committed = readFileSync(registryPath);
  const diffAt = firstDiff(stdout, committed);
  if (diffAt !== null) {
    console.error(`registry drift at byte ${diffAt}`);
    console.error(`generated: ${preview(stdout, diffAt)}`);
    console.error(`committed: ${preview(committed, diffAt)}`);
    process.exit(1);
  }

  process.stdout.write(`registry drift gate OK (${narrationCount} entries)\n`);
}

main();
