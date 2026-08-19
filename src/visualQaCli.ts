import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import {
  buildCarouselJudgePrompt,
  buildIsolationPlan,
  buildJudgePrompt,
  burnCarouselCanaries,
  carouselQaRecordPath,
  detectTreatment,
  evaluateCarouselFromDisk,
  evaluateCarouselJudgeStdout,
  evaluateFromDisk,
  evaluateJudgeStdout,
  hashText,
  isConceptRejected,
  loadRejectedConcepts,
  parseCarouselSpec,
  randomCanary,
  referenceStillPaths,
  resolveCarouselSlides,
  sampleTimes,
  sha256File,
  type CarouselQaSidecar,
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

function parseFilesOption(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readTopic(args: string[]): Promise<string> {
  const topicFile = getOption(args, "topic-file");
  if (topicFile) {
    return (await readFile(topicFile, "utf8")).replace(/^\uFEFF/u, "").trim();
  }
  return (getOption(args, "topic") ?? "").trim();
}

function carouselQaDir(args: string[], root: string, dir: string | undefined, slot: number | undefined): string {
  const explicit = getOption(args, "qa-dir");
  if (explicit) return isAbsolute(explicit) ? explicit : join(root, explicit);
  if (dir && slot) return join(root, "output", "visual-qa", "carousel", basename(dir), `slot-${String(slot).padStart(2, "0")}`);
  return join(root, "output", "visual-qa", "carousel", `run-${Date.now()}`);
}

function carouselSpecArg(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith("--carousel="));
  if (inline) return inline.slice("--carousel=".length);
  const index = args.indexOf("--carousel");
  if (index < 0) return undefined;
  const next = args[index + 1];
  if (next && !next.startsWith("--")) return next;
  return undefined;
}

async function handleCarousel(args: string[], root: string): Promise<void> {
  const spec = parseCarouselSpec(carouselSpecArg(args));
  const dir = getOption(args, "dir") ?? spec.dir;
  const slotRaw = getOption(args, "slot") ?? (spec.slot !== undefined ? String(spec.slot) : undefined);
  const slot = slotRaw ? Number(slotRaw) : spec.slot;
  const files = parseFilesOption(getOption(args, "files"));
  const topic = await readTopic(args);
  const date = getOption(args, "date") ?? (dir ? basename(dir) : undefined);

  if (getFlag(args, "emit-prompt")) {
    const names = files.length > 0
      ? files
      : (await resolveCarouselSlides({ dir, slot, root })).map((file) => basename(file));
    const slides = names.map((name, index) => ({
      imageIndex: index + 1,
      name: basename(name),
      slide: index + 1
    }));
    const prompt = buildCarouselJudgePrompt({ slides, topic });
    process.stdout.write(prompt);
    process.stdout.write("\n");
    process.stdout.write(`PROMPT_HASH=${hashText(prompt)}\n`);
    return;
  }

  if (getFlag(args, "evaluate-inline")) {
    const record = evaluateCarouselJudgeStdout({
      stdout: getOption(args, "stdout") ?? "",
      topic,
      expectedCanaries: JSON.parse(getOption(args, "canaries") ?? "{}") as Record<string, string>,
      slideSha256s: JSON.parse(getOption(args, "slide-hashes") ?? "{}") as Record<string, string>,
      promptHash: getOption(args, "prompt-hash") ?? "",
      runId: getOption(args, "run-id") ?? "inline",
      slides: [],
      date,
      slot
    });
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }

  if (getFlag(args, "evaluate")) {
    const stdoutFile = getOption(args, "stdout-file");
    const sidecarFile = getOption(args, "sidecar");
    const qaDir = getOption(args, "qa-dir");
    if (!stdoutFile || !sidecarFile || !qaDir) {
      throw new Error("--stdout-file, --sidecar, and --qa-dir required for carousel evaluate");
    }
    if (getOption(args, "out")) {
      throw new Error("carousel evaluate is stdout-only; the trusted wrapper owns the durable record write");
    }
    const stdout = await readFile(stdoutFile, "utf8");
    const sidecar = JSON.parse((await readFile(sidecarFile, "utf8")).replace(/^\uFEFF/u, "")) as CarouselQaSidecar;
    const record = await evaluateCarouselFromDisk({
      qaDir,
      stdout,
      sidecar,
      promptHash: getOption(args, "prompt-hash") ?? "",
      runId: getOption(args, "run-id") ?? `carousel-qa-${Date.now()}`
    });
    // Evaluation is deliberately stdout-only.  The scheduled wrapper owns the
    // durable evidence write, after it has re-checked that this child did not
    // alter any protected production input while it ran.
    process.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }

  const sources = await resolveCarouselSlides({ dir, slot, files: files.length > 0 ? files : undefined, root });
  if (getFlag(args, "resolve")) {
    process.stdout.write(`${JSON.stringify({ topic, date, slot, slides: sources })}\n`);
    return;
  }

  if (!topic) throw new Error("--topic or --topic-file is required for carousel visual QA.");
  const qaDir = carouselQaDir(args, root, dir, slot);
  const slides = await burnCarouselCanaries({ sources, qaDir });
  const sidecar: CarouselQaSidecar = { topic, date, slot, slides };
  const sidecarPath = join(qaDir, "sidecar.json");
  await writeJsonAtomic(sidecarPath, sidecar);
  const prompt = buildCarouselJudgePrompt({
    slides: slides.map((slide) => ({ imageIndex: slide.slide, name: slide.name, slide: slide.slide })),
    topic
  });
  const promptHash = hashText(prompt);
  const promptPath = join(qaDir, "judge-prompt.txt");
  await writeFile(promptPath, prompt, "utf8");
  const stdoutPath = getOption(args, "stdout-file") ?? join(qaDir, "judge-stdout.txt");
  const defaultOut = dir && slot
    ? carouselQaRecordPath(isAbsolute(dir) ? dir : join(root, dir), slot)
    : join(qaDir, "carousel.visual-qa.json");
  const outPath = getOption(args, "out") ?? defaultOut;

  // This TypeScript CLI never selects an ambient executable or invokes Codex.
  // The scheduled PowerShell wrapper owns the only judge execution boundary so
  // it can use Invoke-TrustedProductionCodex and re-check the production
  // contract immediately after the untrusted-length child returns.
  if (!getFlag(args, "prepare")) {
    throw new Error("Carousel visual QA requires --prepare; the trusted PowerShell wrapper must run the judge and then call --evaluate.");
  }
  process.stdout.write(`${JSON.stringify({
    date,
    slot,
    qa_dir: qaDir,
    sidecar_path: sidecarPath,
    prompt_path: promptPath,
    stdout_path: stdoutPath,
    out_path: outPath,
    prompt_hash: promptHash,
    images: slides.map((slide) => join(qaDir, slide.name))
  })}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));

  if (getFlag(args, "carousel") || args.some((arg) => arg.startsWith("--carousel="))) {
    await handleCarousel(args, root);
    return;
  }

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
