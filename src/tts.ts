import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { getNumberOption, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

// Narration voice. On 2026-09-25/26 the owner heard the MiniMax rotation (m1 少女 /
// m4 精英男 / m5 溫暖閨蜜) as a mainland accent with mainland heteronym readings and
// ruled: 「要台灣的說法、語氣、口音」「每天產線要整個換成台灣聲音」, voice 曉臻.
// Every publish now speaks with Microsoft's Taiwanese-Mandarin voice through edge-tts
// (no key, no spend). voiceFor() is kept so callers do not change; it is one voice now.

const VOICE = { label: "tw-hsiaochen", voiceId: "zh-TW-HsiaoChenNeural" } as const;
const DEFAULT_SPEED = 1.1;

/** Deterministic and, since 2026-09-26, constant: every date and slot speaks 曉臻. */
export function voiceFor(_date: string, _slot: number): typeof VOICE {
  return VOICE;
}

// Heteronyms this voice reads the mainland way. The narration text is fed to the
// synthesiser with an unambiguous homophone; subtitles and captions keep the real
// characters because they are built from the original string elsewhere. Each entry was
// measured on 2026-09-26 (homophone DTW + faster-whisper on the 9/29 LV reel): 帆布 came
// out fān, 薄薄 came out báo; 凡布 / 博博 come out fán / bó.
const TTS_HOMOPHONES: ReadonlyArray<readonly [string, string]> = [
  ["帆布", "凡布"],
  ["薄薄", "博博"]
];

/** The string actually sent to the synthesiser (never shown to a viewer). */
export function ttsInputText(text: string): string {
  return TTS_HOMOPHONES.reduce((s, [shown, spoken]) => s.split(shown).join(spoken), text);
}

/** edge-tts wants "+10%" / "-5%"; the pipeline has always spoken in a speed multiplier. */
export function rateForSpeed(speed: number): string {
  const pct = Math.round((speed - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function edgeTts(text: string, outPath: string, speed: number): void {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync(
      "python",
      ["-m", "edge_tts", "--voice", VOICE.voiceId, `--rate=${rateForSpeed(speed)}`, "--text", ttsInputText(text),
        "--write-media", outPath],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 }
    );
    if (result.status === 0) return;
    lastError = result.stderr?.toString("utf8").trim().split("\n").pop() ?? `exit ${result.status}`;
    console.warn(`edge-tts attempt ${attempt} failed: ${lastError}`);
  }
  // No mainland-accent fallback: a missing narration is caught by the sentinel, a wrong
  // voice would be published.
  throw new Error(`edge-tts failed three times: ${lastError}`);
}

export async function synthesizeNarration(input: {
  text: string;
  outPath: string;
  date: string;
  slot: number;
  speed?: number;
  root?: string;
}): Promise<{ voice: string; engine: "edge-tts" }> {
  const root = projectRoot(input.root);
  const absolute = join(root, ...input.outPath.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  const voice = voiceFor(input.date, input.slot);
  edgeTts(input.text, absolute, input.speed ?? DEFAULT_SPEED);
  return { voice: voice.label, engine: "edge-tts" };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const text = getOption(args, "text");
  const out = getOption(args, "out");
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot") ?? 2;
  if (!text || !out || !date) throw new Error("Required: --text <zh> --out <path> --date YYYY-MM-DD [--slot N]");
  const speed = getNumberOption(args, "speed") ?? undefined;
  const result = await synthesizeNarration({ text, outPath: out, date, slot, speed, root: getOption(args, "root") });
  console.log(JSON.stringify(result));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
