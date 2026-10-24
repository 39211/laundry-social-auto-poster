import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repo = process.cwd();
const evidence = mkdtempSync(join(tmpdir(), "slot1-object-r2-mutation-evidence-"));
const resultPath = resolve(repo, "..", "MUTATION-RESULTS-R2.json");
const persisted = ["2026-10-23", "2026-10-24"].map((date) =>
  `slot1 extension object calendar and image prompts retain the exact planned object on ${date}`);
const pickupBefore = `  const subject =
    plannedObject
      ? "exactly this one item from OBJECT PASSPORT"
      : headline === "鞋子"
      ? \`exactly one paired set of two \${shoeColour}\`
      : headline === "床組"
        ? "exactly one complete folded warm-white cotton duvet cover with a thin navy piping edge"
        : \`exactly one complete \${headline} item\`;
  const sameSubject =
    plannedObject
      ? "the same item from OBJECT PASSPORT"
      : headline === "鞋子"
      ? \`the same paired set of two \${shoeColour}\`
      : headline === "床組"
        ? "the same folded duvet cover"
        : \`the same complete \${headline} item\`;`;
const pickupAfter = pickupBefore
  .replace('    plannedObject\n      ? "exactly this one item from OBJECT PASSPORT"\n      : headline', '    headline')
  .replace('    plannedObject\n      ? "the same item from OBJECT PASSPORT"\n      : headline', '    headline');
const mutations = [
  {
    id: "R1", file: "src/imageDoctrine.ts", test: "test/slot1ExtObject.test.ts",
    before: "  const identity = input.planned_object ? plannedObjectIdentity(input.planned_object) : undefined;",
    after: "  const identity: ReturnType<typeof plannedObjectIdentity> | undefined = undefined;",
    expected: [
      "slot1 extension object planned object passes subject approval on 2026-11-02",
      ...["2026-10-28", "2026-10-31"].map((date) => `slot1 extension object planned bedding owns tools and negatives on ${date}`)
    ]
  },
  {
    id: "R2", file: "scripts/refresh-stored-image-prompts.ts", test: "test/refreshStoredImagePrompts.test.ts",
    before: "      planned_object: slot.planned_object,\n",
    after: "",
    expected: ["2026-10-31", "2026-11-01"].map((date) =>
      `refresh stored image prompts preserves the stored planned object through the production script on ${date}`)
  },
  {
    id: "R3", file: "src/contentPlan.ts", test: "test/slot1ExtObject.test.ts",
    before: pickupBefore, after: pickupAfter,
    expected: ["2026-10-25", "2026-11-01"].map((date) =>
      `slot1 extension object production pickup briefs use the passport subject on ${date}`)
  },
  {
    id: "O1", file: "src/contentPlan.ts", test: "test/slot1ExtObject.test.ts",
    before: 'if (!gram) return { slot: { ...extendedSlot, planned_object: extendedPlan.object }, source: "slot1-plan-ext" };',
    after: 'if (!gram) return { slot: extendedSlot, source: "slot1-plan-ext" };',
    expected: persisted
  },
  {
    id: "O2", file: "src/contentPlan.ts", test: "test/slot1ExtObject.test.ts",
    before: "    planned_object: slot.planned_object,\n    caption: carouselCaptionSource(slot),",
    after: "    caption: carouselCaptionSource(slot),",
    expected: persisted
  },
  {
    id: "O3", file: "scripts/daily-generate.ps1", test: "test/dailyGeneratePlannedObject.test.ts",
    before: "    if (-not $plannedObject) {", after: "    if ($false) {",
    expected: ["daily generation planned object PowerShell 5.1 resolves the production lookup for 2026-10-23"]
  }
];
const summary = { createdAt: new Date().toISOString(), repo, evidence, results: [] };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assertOwnedPath(path) {
  const rel = relative(tmpdir(), resolve(path));
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel), "cleanup must stay within tmpdir");
  assert.ok(rel.startsWith("slot1-object-r2-mutant-"), "cleanup only task-owned copies");
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
  const root = mkdtempSync(join(tmpdir(), `slot1-object-r2-mutant-${mutation.id}-`));
  const dependencyLink = join(root, "node_modules");
  const result = { id: mutation.id, productionFile: mutation.file, expectedWitnesses: mutation.expected,
    cleanPassedWitnesses: [], actualFailedTests: [], killedIntersection: [], status: "ERROR", copyDeleted: false };
  summary.results.push(result);
  try {
    cpSync(join(repo, "src"), join(root, "src"), { recursive: true,
      filter: (path) => !path.split(/[\\/]/).some((part) => /memory/i.test(part) || part === "OPEN-TASKS.md") });
    for (const file of ["package.json", "vitest.config.ts", mutation.test,
      "scripts/daily-generate.ps1", "scripts/refresh-stored-image-prompts.ts",
      "data/slot1-plan.json", "data/slot1-plan-ext.json"]) {
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
    console.log(JSON.stringify(result));
  }
}
assert.ok(summary.results.every((result) => result.status === "KILLED" && result.copyDeleted), "all six production cuts must be killed and copies deleted");
console.log(`Mutation evidence: ${resultPath}`);
