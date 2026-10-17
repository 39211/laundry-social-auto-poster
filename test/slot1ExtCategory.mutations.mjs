import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repo = process.cwd();
const plan = JSON.parse(readFileSync(join(repo, "data/slot1-plan-ext.json"), "utf8"));
const rows = Object.entries(plan);
const evidence = mkdtempSync(join(tmpdir(), "slot1-category-mutation-evidence-"));
const resultPath = resolve(repo, "..", "MUTATION-RESULTS-R3.json");
const progressPath = resolve(repo, "..", "PROGRESS.md");
const categoryTest = "test/slot1ExtCategory.test.ts";
const dailyWitness = (date) => `slot1 explicit category persists category and validates every production prompt on ${date}`;
const mutations = [
  {
    id: "M1", file: "src/contentPlan.ts", test: categoryTest,
    before: "planned_object: extendedPlan.object, planned_category: extendedPlan.category",
    after: "planned_object: extendedPlan.object",
    expected: rows.map(([date]) => dailyWitness(date))
  },
  {
    id: "M2", file: "scripts/refresh-stored-image-prompts.ts", test: "test/refreshStoredImagePrompts.test.ts",
    before: "      planned_category: slot.planned_category,\n", after: "",
    expected: rows.filter(([, entry]) => entry.family === "pickup-delivery").map(([date]) =>
      `refresh stored image prompts preserves the stored planned object and category through the production script on ${date}`)
  },
  {
    id: "M3", file: "src/imageDoctrine.ts", test: categoryTest,
    before: 'jacket: { family: "garment", label: "jacket",',
    after: 'jacket: { family: "garment", label: "garment",',
    expected: ["slot1 explicit category vocabulary labels match exactly their production approval family"]
  },
  {
    id: "M4", file: "src/imageDoctrine.ts", test: categoryTest,
    before: 'negatives: "Avoid: readable care-label or hang-tag text, a mannequin, a waxy plastic-coated surface, a second hand."',
    after: 'negatives: "Avoid: readable care-label or hang-tag text, a second garment, a mannequin, a waxy plastic-coated surface, a second hand."',
    expected: rows.filter(([, entry]) => entry.category === "garments-in-bag").map(([date]) => dailyWitness(date))
  },
  {
    id: "M5", file: "src/contentPlan.ts", test: categoryTest,
    before: "        if (!isPlannedObjectCategory(entry.category)) {\n",
    after: '        if (!isPlannedObjectCategory(entry.category)) {\n          throw new Error("mutant discards the entire extension");\n',
    expected: ["missing", "unknown"].map((value) =>
      `slot1 explicit category keeps the entire extension with neutral prompts for a ${value} category`)
  }
];
const summary = { createdAt: new Date().toISOString(), repo, evidence, results: [] };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertOwnedPath(path) {
  const rel = relative(tmpdir(), resolve(path));
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), "cleanup must stay within tmpdir");
  assert.ok(rel.startsWith("slot1-category-mutant-"), "cleanup only this task's copies");
}

function runWitness(root, mutation, phase) {
  const reportPath = join(evidence, `${mutation.id}-${phase}.json`);
  const logPath = join(evidence, `${mutation.id}-${phase}.log`);
  const pattern = mutation.expected.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const run = spawnSync(process.execPath, [join(repo, "node_modules/vitest/vitest.mjs"),
    "run", mutation.test, "--testTimeout=60000", "--no-cache", "-t", pattern,
    "--reporter=json", `--outputFile=${reportPath}`
  ], { cwd: root, env: process.env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(logPath, `${run.stdout ?? ""}\n${run.stderr ?? ""}${run.error ? `\n${run.error}` : ""}`);
  assert.ok(existsSync(reportPath), `missing witness report: ${logPath}`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  return { exit: run.status, tests: report.testResults.flatMap((file) => file.assertionResults ?? []), reportPath, logPath };
}

for (const mutation of mutations) {
  assert.ok(mutation.expected.length > 0, `${mutation.id}: expected witnesses required`);
  const root = mkdtempSync(join(tmpdir(), `slot1-category-mutant-${mutation.id}-`));
  const dependencyLink = join(root, "node_modules");
  const result = { id: mutation.id, productionFile: mutation.file, expectedWitnesses: mutation.expected,
    cleanPassedWitnesses: [], actualFailedTests: [], killedIntersection: [], status: "ERROR", copyDeleted: false };
  summary.results.push(result);
  try {
    cpSync(join(repo, "src"), join(root, "src"), { recursive: true,
      filter: (path) => !path.split(/[\\/]/).some((part) => /memory/i.test(part) || part === "OPEN-TASKS.md") });
    for (const file of ["package.json", "vitest.config.ts", mutation.test,
      "scripts/refresh-stored-image-prompts.ts", "data/slot1-plan.json", "data/slot1-plan-ext.json"]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(repo, file), join(root, file));
    }
    symlinkSync(join(repo, "node_modules"), dependencyLink, "junction");
    const path = join(root, mutation.file);
    const cleanBytes = readFileSync(path);
    result.cleanProductionSha256 = digest(cleanBytes);
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
    for (const expected of mutation.expected) assert.ok(result.cleanPassedWitnesses.includes(expected), `${mutation.id}: missing clean witness ${expected}`);
    const mutated = Buffer.from(source.replace(anchor, replacement), "utf8");
    writeFileSync(path, mutated);
    result.mutatedProductionSha256 = digest(mutated);
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
        execFileSync("cmd.exe", ["/d", "/s", "/c", `rmdir "${dependencyLink}"`], { windowsVerbatimArguments: true });
      }
      assert.ok(!existsSync(dependencyLink), "remove the junction before recursive cleanup");
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      result.copyDeleted = !existsSync(root);
    } catch (error) {
      result.status = "ERROR";
      result.cleanupError = String(error);
    }
    writeFileSync(resultPath, JSON.stringify(summary, null, 2));
    appendFileSync(progressPath, `${new Date().toISOString()} R3 C5 ${mutation.id} ${result.status}; clean=${result.cleanPassedWitnesses.length}; killed=${result.killedIntersection.length}; copyDeleted=${result.copyDeleted}\n`);
    console.log(JSON.stringify(result));
  }
}
assert.ok(summary.results.every((result) => result.status === "KILLED" && result.copyDeleted), "all five production cuts must be killed and copies deleted");
console.log(`Mutation evidence: ${resultPath}`);
