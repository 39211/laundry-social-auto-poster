import { isMain } from "./cli";

const ROTATION = [
  { label: "m1-shaonv", voiceId: "female-shaonv" },
  { label: "m4-jingying", voiceId: "male-qn-jingying" },
  { label: "m5-warm-bestie", voiceId: "Chinese (Mandarin)_Warm_Bestie" }
] as const;

const DIRECT_TTS_DISABLED = "Direct TTS execution is disabled by policy; use the approved Hermes/SuperGrok route.";

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Deterministic and side-effect-free: same date+slot yields the same voice. */
export function voiceFor(date: string, slot: number): (typeof ROTATION)[number] {
  const index = (dayIndex(date) * 2 + (slot === 3 ? 0 : 1)) % ROTATION.length;
  return ROTATION[index]!;
}

/**
 * Raw MiniMax and Python fallback execution was intentionally removed. No
 * environment variable, CLI flag, or direct module call can send credentials
 * or spawn a child process from this entry point.
 */
export async function synthesizeNarration(_input: {
  text: string;
  outPath: string;
  date: string;
  slot: number;
  speed?: number;
  root?: string;
}): Promise<never> {
  throw new Error(DIRECT_TTS_DISABLED);
}

async function main(): Promise<void> {
  throw new Error(DIRECT_TTS_DISABLED);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
