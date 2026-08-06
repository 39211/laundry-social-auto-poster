import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { getNumberOption, getOption, isMain } from "./cli";
import { projectRoot } from "./paths";

// Narration voices. The owner picked three MiniMax voices on 2026-08-07 —
// m1 少女, m4 精英男, m5 溫暖閨蜜 — rotating deterministically by publish date
// and slot, so both A/B length cohorts hear every voice about equally and the
// voice never confounds the length test. MiniMax failing must never cost a
// publish: the fallback is the edge-tts voice the account launched with.

const ROTATION = [
  { label: "m1-shaonv", voiceId: "female-shaonv" },
  { label: "m4-jingying", voiceId: "male-qn-jingying" },
  { label: "m5-warm-bestie", voiceId: "Chinese (Mandarin)_Warm_Bestie" }
] as const;

const FALLBACK_EDGE_VOICE = "zh-TW-HsiaoChenNeural";

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Deterministic: same date+slot always yields the same voice. */
export function voiceFor(date: string, slot: number): (typeof ROTATION)[number] {
  const index = (dayIndex(date) * 2 + (slot === 3 ? 0 : 1)) % ROTATION.length;
  return ROTATION[index]!;
}

async function minimaxTts(text: string, voiceId: string, speed: number): Promise<Buffer> {
  const key = process.env.MINIMAX_API_KEY;
  const base = (process.env.MINIMAX_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
  if (!key) throw new Error("MINIMAX_API_KEY not configured");

  const response = await fetch(`${base}/t2a_v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "speech-02-hd",
      text,
      stream: false,
      voice_setting: { voice_id: voiceId, speed, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3" }
    })
  });
  const payload = (await response.json()) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  const hex = payload.data?.audio;
  if (!response.ok || !hex) {
    throw new Error(`MiniMax T2A failed: ${payload.base_resp?.status_msg ?? response.status}`);
  }
  return Buffer.from(hex, "hex");
}

function edgeTts(text: string, outPath: string): void {
  const result = spawnSync(
    "python",
    ["-m", "edge_tts", "--voice", FALLBACK_EDGE_VOICE, "--text", text, "--write-media", outPath],
    { stdio: "ignore", timeout: 120_000 }
  );
  if (result.status !== 0) throw new Error("edge-tts fallback failed too");
}

export async function synthesizeNarration(input: {
  text: string;
  outPath: string;
  date: string;
  slot: number;
  speed?: number;
  root?: string;
}): Promise<{ voice: string; engine: "minimax" | "edge-tts" }> {
  const root = projectRoot(input.root);
  const absolute = join(root, ...input.outPath.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  const rotation = voiceFor(input.date, input.slot);

  try {
    const audio = await minimaxTts(input.text, rotation.voiceId, input.speed ?? 1.0);
    await writeFile(absolute, audio);
    return { voice: rotation.label, engine: "minimax" };
  } catch (error) {
    // A narration exists either way: TTS trouble may never block a publish.
    console.warn(
      `MiniMax unavailable (${error instanceof Error ? error.message : String(error)}); falling back to edge-tts.`
    );
    edgeTts(input.text, absolute);
    return { voice: FALLBACK_EDGE_VOICE, engine: "edge-tts" };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const text = getOption(args, "text");
  const out = getOption(args, "out");
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot") ?? 2;
  if (!text || !out || !date) throw new Error("Required: --text <zh> --out <path> --date YYYY-MM-DD [--slot N]");
  const result = await synthesizeNarration({ text, outPath: out, date, slot, root: getOption(args, "root") });
  console.log(JSON.stringify(result));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
