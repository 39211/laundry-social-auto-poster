import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repo = process.cwd();
const evidence = mkdtempSync(join(tmpdir(), "slot1-object-mutation-evidence-"));
const resultPath = resolve(repo, "..", "MUTATION-RESULTS.json");
const witnesses = ["2026-10-23", "2026-10-24"].map((date) =>
  `slot1 extension object calendar and image prompts retain the exact planned object on ${date}`);
const psWitness = "daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-23";
const mutations = [
  {
    id: "O1", file: "src/contentPlan.ts", test: "test/slot1ExtObject.test.ts",
    before: 'if (!gram) return { slot: { ...extendedSlot, planned_object: extendedPlan.object }, source: "slot1-plan-ext" };',
    after: 'if (!gram) return { slot: extendedSlot, source: "slot1-plan-ext" };',
    expected: witnesses
  },
  {
    id: "O2", file: "src/contentPlan.ts", test: "test/slot1ExtObject.test.ts",
    before: "    planned_object: slot.planned_object,\n    caption: carouselCaptionSource(slot),",
    after: "    caption: carouselCaptionSource(slot),",
    expected: witnesses
  },
  {
    id: "O3", file: "scripts/daily-generate.ps1", test: "test/dailyGeneratePlannedObject.test.ts",
    before: "    if (-not $plannedObject) {",
    after: "    if ($false) {",
    expected: [psWitness]
  }
];
const summary = { createdAt: new Date().toISOString(), repo, evidence, results: [] };

function assertOwnedPath(path) {
  const rel = relative(tmpdir(), resolve(path));
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), "cleanup must stay within tmpdir");
  assert.ok(relative(tmpdir(), resolve(path)).startsWith("slot1-object-mutant-"), "cleanup only task-owned copies");
}

function runWitness(root, mutation, phase) {
  const reportPath = join(evidence, `${mutation.id}-${phase}.json`);
  const logPath = join(evidence, `${mutation.id}-${phase}.log`);
  const pattern = mutation.expected.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const run = spawnSync(process.execPath, [join(repo, "node_modules", "vitest", "vitest.mjs"),
    "run", mutation.test, "--testTimeout=60000", "-t", pattern,
    "--reporter=json", `--outputFile=${reportPath}`
  ], { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(logPath, `${run.stdout ?? ""}\n${run.stderr ?? ""}${run.error ? `\n${run.error}` : ""}`);
  assert.ok(existsSync(reportPath), `missing witness report: ${logPath}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const tests = report.testResults.flatMap((file) => file.assertionResults ?? []);
  return { exit: run.status, tests, reportPath, logPath };
}

for (const mutation of mutations) {
  const root = mkdtempSync(join(tmpdir(), `slot1-object-mutant-${mutation.id}-`));
  const dependencyLink = join(root, "node_modules");
  const result = { id: mutation.id, productionFile: mutation.file, expectedWitnesses: mutation.expected,
    cleanPassedWitnesses: [], actualFailedTests: [], killedIntersection: [], status: "ERROR", copyDeleted: false };
  summary.results.push(result);
  try {
    cpSync(join(repo, "src"), join(root, "src"), { recursive: true,
      filter: (path) => !path.split(/[\\/]/).some((part) => /memory/i.test(part) || part === "OPEN-TASKS.md") });
    for (const file of ["package.json", "vitest.config.ts", mutation.test,
      "scripts/daily-generate.ps1", "data/slot1-plan.json", "data/slot1-plan-ext.json"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(repo, file), join(root, file));
    }
    symlinkSync(join(repo, "node_modules"), dependencyLink, "junction");
    const path = join(root, mutation.file);
    const cleanBytes = readFileSync(path);
    result.cleanProductionSha256 = createHash("sha256").update(cleanBytes).digest("hex");
    const source = cleanBytes.toString("utf8");
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const anchor = mutation.before.replace(/\n/g, newline);
    const replacement = mutation.after.replace(/\n/g, newline);
    result.anchorCount = source.split(anchor).length - 1;
    assert.equal(result.anchorCount, 1, `${mutation.id}: production anchor must be unique`);
    const clean = runWitness(root, mutation, "clean");
    result.cleanReport = clean.reportPath;
    result.cleanPassedWitnesses = clean.tests.filter((test) => test.status === "passed").map((test) => test.fullName);
    assert.equal(clean.exit, 0, `${mutation.id}: clean witness run failed`);
    for (const expected of mutation.expected) assert.ok(result.cleanPassedWitnesses.includes(expected), `${mutation.id}: missing/pending clean witness ${expected}`);
    const mutated = Buffer.from(source.replace(anchor, replacement), "utf8");
    writeFileSync(path, mutated);
    result.mutatedProductionSha256 = createHash("sha256").update(mutated).digest("hex");
    result.bomPreserved = cleanBytes.subarray(0, 3).equals(mutated.subarray(0, 3));
    const dirty = runWitness(root, mutation, "mutant");
    result.mutantReport = dirty.reportPath;
    result.actualFailedTests = dirty.tests.filter((test) => test.status === "failed").map((test) => test.fullName);
    result.killedIntersection = result.actualFailedTests.filter((name) => mutation.expected.includes(name));
    assert.notEqual(dirty.exit, 0, `${mutation.id}: mutant unexpectedly passed`);
    assert.ok(result.killedIntersection.length > 0, `${mutation.id}: no expected witness actually failed`);
    result.status = "KILLED";
  } catch (error) {
    result.error = String(error);
  } finally {
    try {
      assertOwnedPath(root);
      if (existsSync(dependencyLink)) {
        assert.ok(lstatSync(dependencyLink).isSymbolicLink(), "remove only the dependency junction");
        // Owner policy: unlink Windows junctions with cmd rmdir, never recursive deletion.
        execFileSync("cmd.exe", ["/d", "/s", "/c", `rmdir "${dependencyLink}"`], { windowsVerbatimArguments: true });
      }
      assert.ok(!existsSync(dependencyLink), "dependency junction must be removed before copy cleanup");
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      result.copyDeleted = !existsSync(root);
    } catch (error) {
      result.status = "ERROR";
      result.cleanupError = String(error);
    }
    writeFileSync(resultPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(result));
  }
}
assert.ok(summary.results.every((result) => result.status === "KILLED" && result.copyDeleted), "all three production mutations must be killed and copies deleted");
console.log(`Mutation evidence: ${resultPath}`);
