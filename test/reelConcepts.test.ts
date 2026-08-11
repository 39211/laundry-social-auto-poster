import { describe, expect, it } from "vitest";
import {
  REEL_CONCEPTS,
  REEL_SCHEDULE,
  conceptStatuses,
  promptFor,
  publishDateFor,
  stillPathsFor
} from "../src/reelConcepts";

describe("reel concepts", () => {
  it("covers six distinct object types so no two Reels look alike", () => {
    const types = REEL_CONCEPTS.map((concept) => concept.object_type);
    expect(new Set(types).size).toBe(REEL_CONCEPTS.length);
  });

  it("rules out the vocabulary of a business this is not", () => {
    // The first batch produced laundry baskets and a domestic sofa. This shop
    // collects and delivers; a customer never handles a basket here.
    for (const concept of REEL_CONCEPTS) {
      for (const state of ["before", "after"] as const) {
        const prompt = promptFor(concept, state);
        expect(prompt).toMatch(/No laundry basket/);
        expect(prompt).toMatch(/no washing machine/);
        expect(prompt).toMatch(/no domestic living room/);
        expect(prompt).toMatch(/inspection counter/);
      }
    }
  });

  it("keeps every still on the same look so a regenerated one still cuts in", () => {
    // The subject differs per still; everything after it must not, or a single
    // regenerated image will not match the pair it drops back into.
    const looks = REEL_CONCEPTS.flatMap((concept) =>
      (["before", "after"] as const).map((state) => {
        const prompt = promptFor(concept, state);
        return prompt.slice(prompt.indexOf("Shot on a phone"));
      })
    );
    expect(looks).toHaveLength(REEL_CONCEPTS.length * 2);
    expect(new Set(looks).size).toBe(1);
  });

  it("gives each concept its own still paths so one can be regenerated alone", () => {
    const paths = REEL_CONCEPTS.flatMap((concept) => Object.values(stillPathsFor(concept)));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("carries a hook, a close and narration for every concept", () => {
    for (const concept of REEL_CONCEPTS) {
      expect(concept.hook.length).toBeGreaterThan(6);
      expect(concept.close.length).toBeGreaterThan(6);
      expect(concept.narration.length).toBeGreaterThan(20);
    }
  });

  it("never has the narration restate the hook", () => {
    // The hook is burned in as a subtitle for the first 2.6 seconds and the
    // narration starts at 0.5s, so a narration that opens with the hook makes
    // the viewer read and hear one sentence at once. Eight of the twelve did.
    for (const concept of REEL_CONCEPTS) {
      const hookBody = concept.hook.replace(/[，。？、]/g, "");
      const narrationBody = concept.narration.replace(/[，。？、]/g, "");
      for (let length = 5; length <= hookBody.length; length += 1) {
        const piece = hookBody.slice(0, length);
        expect(
          narrationBody.includes(piece),
          `${concept.id}: narration repeats the hook's "${piece}"`
        ).toBe(false);
      }
    }
  });

  it("fills the reel with narration without overrunning it", () => {
    // Two failures to avoid, and the old cap only guarded one of them.
    //
    // Overrun: the line is still being spoken when the video ends. The voice
    // runs near 0.25s a character and the TTS call now asks for +10%, so the
    // budget is (reel - start) / (0.25 / 1.10).
    //
    // Underrun: measured silence detection on the shipped reels found every one
    // of them going quiet from around 7s to the end, and a句-gap at 3.4-4.4s --
    // which is exactly where median watch time (4.2s) sits. A 36-character cap
    // on a 14.2s reel guaranteed that hole. The floor is what closes it.
    const REEL_SECONDS = 14.2;
    const NARRATION_STARTS_AT = 0.5;
    const SECONDS_PER_CHAR = 0.25 / 1.1;
    const ceiling = Math.floor((REEL_SECONDS - NARRATION_STARTS_AT) / SECONDS_PER_CHAR);
    const floor = Math.floor(ceiling * 0.75);
    for (const concept of REEL_CONCEPTS) {
      expect(concept.narration.length, `${concept.id} narration overruns the reel`).toBeLessThanOrEqual(ceiling);
      expect(concept.narration.length, `${concept.id} narration leaves the reel silent`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("schedules every concept exactly once, with no gap in the days still ahead", () => {
    expect(REEL_SCHEDULE).toHaveLength(REEL_CONCEPTS.length);
    expect(new Set(REEL_SCHEDULE.map((entry) => entry.conceptId)).size).toBe(REEL_CONCEPTS.length);
    for (const concept of REEL_CONCEPTS) {
      expect(publishDateFor(concept.id)).toBeDefined();
    }

    // History is allowed to contain losses — 07-30/31 and 08-04/05 were lost
    // to calendar clobbers and a disabled publish task, and their Reels moved
    // to the end — but the stretch still ahead must stay one Reel a day with
    // no repeats and no gaps. Advance this boundary when history grows.
    const dates = REEL_SCHEDULE.map((entry) => Date.parse(entry.date)).filter(
      (time) => time >= Date.parse("2026-08-06")
    );
    for (let index = 1; index < dates.length; index += 1) {
      expect(dates[index]! - dates[index - 1]!).toBe(86_400_000);
    }
  });

  it("orders production by deadline, not by the order concepts were written", async () => {
    // Publishing deliberately alternates object types, so the schedule order is
    // not the list order. Producing in list order would build the concept that
    // is needed last, and one failed day would then land on a publishing date.
    const statuses = await conceptStatuses();
    const produced = statuses.map((status) => status.publish_date);
    expect(produced).toEqual([...produced].sort());
    expect(statuses[0]?.id).toBe(REEL_SCHEDULE[0]?.conceptId);
  });

  it("gives no two consecutive publishing days the same object type", () => {
    const types = REEL_SCHEDULE.map(
      (entry) => REEL_CONCEPTS.find((concept) => concept.id === entry.conceptId)?.object_type
    );
    for (let index = 1; index < types.length; index += 1) {
      expect(types[index]).not.toBe(types[index - 1]);
    }
  });
});
