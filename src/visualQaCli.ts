import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import {
  buildIsolationPlan,
  buildJudgePrompt,
  detectTreatment,
  evaluateFromDisk,
  evaluateJudgeStdout,
  hashText,
  isConceptRejected,
  loadRejectedConcepts,
  randomCanary,
  referenceStillPaths,
  sampleTimes,
  sha256File,
  type QaFrameRecord,
  type ReelTreatment,
  type VisualQaSidecar,
  warnVisualQaForPublish
} from "./visualQa";

function parseTreatment(value: string | undefined, reel: string, duration: number): ReelTreatment {
  if (value === "A" || value === "B" || value === "C" || value === "untreated-15s" || value === "10s") {
    return value;
  }
  return detectTreatment(reel, duration);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "plan-frames")) {
    const reel = getOption(args, "reel") ?? "";
    const duration = Number(getOption(args, "duration") ?? "0");
    const treatment = parseTreatment(getOption(args, "treatment"), reel, duration);
    const samples = sampleTimes(treatment, duration);
    process.stdout.write(`${JSON.stringify({ treatment, duration, samples })}\n`);
    return;
  }

  if (getFlag(args, "emit-prompt")) {
    const names = (getOption(args, "frames") ?? "").split(",").filter(Boolean);
    const acts = (getOption(args, "acts") ?? "").split(",");
    const stillsMissing = (getOption(args, "stills-missing") ?? "").split(",").filter(Boolean);
    const hasMiddle = getFlag(args, "has-middle") || acts.some((act) => act.includes("middle"));
    const frames = names.map((name, index) => ({
      imageIndex: index + 1,
      name,
      act: acts[index] ?? "unknown"
    }));
    const prompt = buildJudgePrompt({ frames, stillsMissing, hasMiddle });
    process.stdout.write(prompt);
    process.stdout.write("\n");
    process.stdout.write(`PROMPT_HASH=${hashText(prompt)}\n`);
    return;
  }

  if (getFlag(args, "new-canary")) {
    process.stdout.write(`${randomCanary()}\n`);
    return;
  }

  if (getFlag(args, "hash-file")) {
    const filePath = getOption(args, "file");
    if (!filePath) throw new Error("--file is required");
    process.stdout.write(`${await sha256File(filePath)}\n`);
    return;
  }

  if (getFlag(args, "build-sidecar")) {
    const qaDir = getOption(args, "qa-dir");
    const reel = getOption(args, "reel");
    const canariesJson = getOption(args, "canaries-json");
    const canariesFile = getOption(args, "canaries-file");
    const duration = Number(getOption(args, "duration") ?? "0");
    if (!qaDir || !reel || (!canariesJson && !canariesFile)) {
      throw new Error("--qa-dir, --reel, and --canaries-json or --canaries-file required");
    }
    const rawCanaries = canariesFile
      ? await import("node:fs/promises").then((fs) => fs.readFile(canariesFile, "utf8"))
      : canariesJson;
    const parsedCanaries = JSON.parse((rawCanaries ?? "[]").replace(/^\uFEFF/u, ""));
    const planned = (Array.isArray(parsedCanaries) ? parsedCanaries : [parsedCanaries]) as Array<{
      name: string;
      act: string;
      t: number;
      canary: string;
    }>;
    const treatment = parseTreatment(getOption(args, "treatment"), reel, duration);
    const frames: QaFrameRecord[] = [];
    for (const item of planned) {
      const filePath = join(qaDir, `${item.name}.png`);
      frames.push({
        name: `${item.name}.png`,
        act: item.act,
        t: item.t,
        canary: item.canary,
        sha256: await sha256File(filePath)
      });
    }
    const sidecar: VisualQaSidecar = {
      reel,
      reel_sha256: await sha256File(reel),
      treatment,
      duration,
      frames
    };
    await writeJsonAtomic(join(qaDir, "sidecar.json"), sidecar);
    process.stdout.write(`${JSON.stringify(sidecar)}\n`);
    return;
  }

  if (getFlag(args, "evaluate")) {
    const stdoutFile = getOption(args, "stdout-file");
    const sidecarFile = getOption(args, "sidecar");
    const reel = getOption(args, "reel");
    const qaDir = getOption(args, "qa-dir");
    const outPath = getOption(args, "out");
    const promptHash = getOption(args, "prompt-hash") ?? "";
    const runId = getOption(args, "run-id") ?? `visual-qa-${Date.now()}`;
    const stillsMissing = (getOption(args, "stills-missing") ?? "").split(",").filter(Boolean);
    if (!stdoutFile || !sidecarFile || !reel || !qaDir || !outPath) {
      throw new Error("--stdout-file, --sidecar, --reel, --qa-dir, --out required");
    }
    const stdout = await import("node:fs/promises").then((fs) => fs.readFile(stdoutFile, "utf8"));
    const sidecar = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(sidecarFile, "utf8"))) as VisualQaSidecar;
    const record = await evaluateFromDisk({
      qaDir,
      stdout,
      reelPath: reel,
      sidecar,
      promptHash,
      runId,
      stillsMissing
    });
    await writeJsonAtomic(outPath, record);
    process.stdout.write(`${JSON.stringify({ verdict: record.verdict, fail_class: record.fail_class, axes: record.axes })}\n`);
    return;
  }

  if (getFlag(args, "evaluate-inline")) {
    const stdout = getOption(args, "stdout") ?? "";
    const record = evaluateJudgeStdout({
      stdout,
      expectedCanaries: JSON.parse(getOption(args, "canaries") ?? "{}") as Record<string, string>,
      frameSha256s: JSON.parse(getOption(args, "frame-hashes") ?? "{}") as Record<string, string>,
      reelSha256: getOption(args, "reel-sha") ?? "",
      promptHash: getOption(args, "prompt-hash") ?? "",
      runId: getOption(args, "run-id") ?? "inline",
      reel: getOption(args, "reel") ?? "",
      frames: []
    });
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }

  if (getFlag(args, "assess-warning")) {
    const videoPath = getOption(args, "video");
    const date = getOption(args, "date") ?? "1970-01-01";
    const slot = Number(getOption(args, "slot") ?? "1");
    if (!videoPath) throw new Error("--video is required");
    const warning = await warnVisualQaForPublish({ date, slot, videoPath, root });
    process.stdout.write(`${JSON.stringify(warning)}\n`);
    return;
  }

  if (getFlag(args, "is-rejected")) {
    const concept = getOption(args, "concept");
    if (!concept) throw new Error("--concept is required");
    const file = await loadRejectedConcepts(root);
    process.stdout.write(`${isConceptRejected(file, concept) ? "1" : "0"}\n`);
    return;
  }

  if (getFlag(args, "list-rejected")) {
    const file = await loadRejectedConcepts(root);
    process.stdout.write(`${file.concepts.map((entry) => entry.id).join("\n")}\n`);
    return;
  }

  if (getFlag(args, "isolation-plan")) {
    const concept = getOption(args, "concept");
    const objectType = getOption(args, "object-type") ?? "unknown";
    if (!concept) throw new Error("--concept is required");
    const plan = buildIsolationPlan({
      conceptId: concept,
      objectType,
      date: getOption(args, "date"),
      slot: getOption(args, "slot") ? Number(getOption(args, "slot")) : undefined
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  if (getFlag(args, "reference-stills")) {
    const concept = getOption(args, "concept");
    const objectType = getOption(args, "object-type");
    if (!concept || !objectType) throw new Error("--concept and --object-type required");
    process.stdout.write(`${JSON.stringify(referenceStillPaths({ root, objectType, conceptId: concept }))}\n`);
    return;
  }

  if (getFlag(args, "write-empty-sidecar-dir")) {
    const dir = getOption(args, "dir");
    if (!dir) throw new Error("--dir is required");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".keep"), "", "utf8");
    process.stdout.write(`${basename(dir)}\n`);
    return;
  }

  throw new Error("No visualQaCli action flag given.");
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
