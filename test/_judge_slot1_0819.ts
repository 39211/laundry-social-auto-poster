import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeJsonAtomic } from "../src/logging";
import {
  burnCarouselCanaries,
  carouselQaRecordPath,
  evaluateCarouselFromDisk,
  hashText,
  buildCarouselJudgePrompt,
  type CarouselQaSidecar
} from "../src/visualQa";

const DATE = "2026-08-19";
const TOPIC = "診所制服每週收送";
const DIR = join(process.cwd(), "docs", "assets", DATE);
const QA_DIR = join(process.cwd(), "output", "visual-qa", "carousel", DATE, "slot-01");

async function main(): Promise<void> {
  const sources = [
    join(DIR, "slot-01.png"),
    join(DIR, "slot-01-slide-02.png"),
    join(DIR, "slot-01-slide-03.png"),
    join(DIR, "slot-01-slide-04.png")
  ];
  await mkdir(QA_DIR, { recursive: true });
  const slides = await burnCarouselCanaries({ sources, qaDir: QA_DIR });
  const sidecar: CarouselQaSidecar = { topic: TOPIC, date: DATE, slot: 1, slides };
  await writeJsonAtomic(join(QA_DIR, "sidecar.json"), sidecar);
  const prompt = buildCarouselJudgePrompt({
    slides: slides.map((slide) => ({ imageIndex: slide.slide, name: slide.name, slide: slide.slide })),
    topic: TOPIC
  });
  const promptHash = hashText(prompt);
  await writeFile(join(QA_DIR, "judge-prompt.txt"), prompt, "utf8");
  process.stdout.write(
    `${JSON.stringify({ qaDir: QA_DIR, promptHash, slides: slides.map((s) => ({ name: s.name, canary: s.canary })) }, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
