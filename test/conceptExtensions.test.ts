import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions } from "../src/reelConcepts";

// Extension concepts are authored as data by the morning agent, which means
// the validator here is the only thing between an unreviewed draft and the
// production schedule. It must admit a well-formed batch and refuse anything
// that breaks the rules the built-in concepts are tested against — rejects
// are logged, never repaired.

let root: string;
let conceptsBaseline: number;
let scheduleBaseline: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "concept-ext-"));
  await mkdir(join(root, "data"), { recursive: true });
  conceptsBaseline = REEL_CONCEPTS.length;
  scheduleBaseline = REEL_SCHEDULE.length;
});

afterEach(async () => {
  // loadExtensions mutates the shared arrays; restore them so tests stay
  // independent of ordering.
  REEL_CONCEPTS.length = conceptsBaseline;
  REEL_SCHEDULE.length = scheduleBaseline;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
});

function nextDate(offset = 1): string {
  const last = REEL_SCHEDULE[REEL_SCHEDULE.length - 1]!.date;
  return new Date(Date.parse(`${last}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

const goodConcept = {
  id: "pillow-yellowing",
  object_type: "pillow",
  hook: "枕頭發黃，曬太陽是不夠的",
  close: "換季想一起處理？私訊我們",
  narration:
    "那是汗和皮脂滲進纖維的顏色，日曬只能除味，黃漬要用對方式才退。枕頭套一件三十，整組拍給我們看先報價。",
  before_subject: "one pillow with visible yellowed patches, laid on the counter",
  after_subject: "the same pillow, same position, evenly clean, fabric still used"
};

describe("concept extensions", () => {
  it("admits a valid batch and extends the schedule by one day", async () => {
    await writeFile(
      join(root, "data", "reel-concepts-extension.json"),
      JSON.stringify({
        concepts: [goodConcept],
        schedule: [{ date: nextDate(), conceptId: "pillow-yellowing" }]
      }),
      "utf8"
    );

    const report = loadExtensions(root);

    expect(report.accepted_concepts).toEqual(["pillow-yellowing"]);
    expect(report.accepted_dates).toHaveLength(1);
    expect(report.rejected).toHaveLength(0);
    expect(REEL_SCHEDULE[REEL_SCHEDULE.length - 1]!.conceptId).toBe("pillow-yellowing");
  });

  it("rejects a narration that restates the hook", async () => {
    await writeFile(
      join(root, "data", "reel-concepts-extension.json"),
      JSON.stringify({
        concepts: [{ ...goodConcept, narration:
          "枕頭發黃，曬太陽是不夠的，要用別的方法處理它。枕頭套一件三十，整組拍給我們看先報價。" }]
      }),
      "utf8"
    );

    const report = loadExtensions(root);

    expect(report.accepted_concepts).toHaveLength(0);
    expect(report.rejected).toHaveLength(1);
    expect(REEL_CONCEPTS).toHaveLength(conceptsBaseline);
  });

  it("rejects a schedule gap and an id collision", async () => {
    await writeFile(
      join(root, "data", "reel-concepts-extension.json"),
      JSON.stringify({
        concepts: [{ ...goodConcept, id: REEL_CONCEPTS[0]!.id }],
        schedule: [{ date: nextDate(3), conceptId: "pillow-yellowing" }]
      }),
      "utf8"
    );

    const report = loadExtensions(root);

    expect(report.accepted_concepts).toHaveLength(0);
    expect(report.accepted_dates).toHaveLength(0);
    expect(report.rejected).toHaveLength(2);
    expect(REEL_SCHEDULE).toHaveLength(scheduleBaseline);
  });

  it("treats a missing or corrupt file as no extensions at all", async () => {
    expect(loadExtensions(root).accepted_concepts).toHaveLength(0);
    await writeFile(join(root, "data", "reel-concepts-extension.json"), "{not json", "utf8");
    expect(loadExtensions(root).accepted_concepts).toHaveLength(0);
    expect(REEL_CONCEPTS).toHaveLength(conceptsBaseline);
    expect(REEL_SCHEDULE).toHaveLength(scheduleBaseline);
  });
});
