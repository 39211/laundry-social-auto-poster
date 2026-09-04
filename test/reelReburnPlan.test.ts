import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REEL_CONCEPTS, REEL_SCHEDULE, loadExtensions } from "../src/reelConcepts";
import {
  UNKNOWN_CONCEPT_EXIT,
  buildReburnPlans,
  listVariantAssets,
  parseConceptIds
} from "../src/reelReburnPlan";
import { voiceFor } from "../src/tts";

const ROOT = process.cwd();
const CONCEPTS_BASELINE = REEL_CONCEPTS.length;
const SCHEDULE_BASELINE = REEL_SCHEDULE.length;

afterEach(() => {
  REEL_CONCEPTS.length = CONCEPTS_BASELINE;
  REEL_SCHEDULE.length = SCHEDULE_BASELINE;
});

function runPlan(args: string[]) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(npx, ["--no-install", "tsx", "src/reelReburnPlan.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    env: {
      ...process.env,
      PUBLIC_SITE_BASE_URL: process.env.PUBLIC_SITE_BASE_URL || "https://sixiangjialaundry.com",
      PUBLIC_IMAGE_BASE_URL: process.env.PUBLIC_IMAGE_BASE_URL || "https://sixiangjialaundry.com",
      META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || "x",
      FB_PAGE_ID: process.env.FB_PAGE_ID || "x",
      IG_USER_ID: process.env.IG_USER_ID || "x"
    },
    timeout: 30_000
  });
}

function spawnDump(result: ReturnType<typeof spawnSync>): string {
  return `status=${result.status} error=${result.error ? String(result.error) : ""} stderr=${result.stderr ?? ""} stdout=${result.stdout ?? ""}`;
}

function lastJson(text: string): unknown {
  const start = text.indexOf("{") >= 0 && (text.indexOf("[") < 0 || text.indexOf("{") < text.indexOf("["))
    ? text.indexOf("{")
    : text.indexOf("[");
  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (start < 0 || end < start) throw new Error(`no JSON in:\n${text}`);
  return JSON.parse(text.slice(start, end + 1));
}

describe("parseConceptIds", () => {
  it("accepts comma lists, repeated args, and skips --date/--run values", () => {
    expect(parseConceptIds(["down-jacket-cuff,wool-coat-shoulder", "--date", "2026-09-08"])).toEqual([
      "down-jacket-cuff",
      "wool-coat-shoulder"
    ]);
    expect(
      parseConceptIds(["white-shoe-yellowing", "--run", "output/reels-run/2026-07-29", "handbag-handle"])
    ).toEqual(["white-shoe-yellowing", "handbag-handle"]);
    expect(parseConceptIds(["--date=2026-09-08", "shirt-collar"])).toEqual(["shirt-collar"]);
  });
});

describe("buildReburnPlans", () => {
  it("prints hook/close/narration matching live REEL_CONCEPTS for a known id", () => {
    loadExtensions(ROOT);
    const builtin = REEL_CONCEPTS.find((concept) => concept.id === "white-shoe-yellowing");
    expect(builtin).toBeDefined();
    const { plans, unknown } = buildReburnPlans({
      ids: ["white-shoe-yellowing"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(unknown).toEqual([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe("white-shoe-yellowing");
    expect(plans[0]!.hook).toBe(builtin!.hook);
    expect(plans[0]!.close).toBe(builtin!.close);
    expect(plans[0]!.narration).toBe(builtin!.narration);
    expect(plans[0]!.voice).toEqual({
      label: voiceFor("2026-09-08", 3).label,
      voiceId: voiceFor("2026-09-08", 3).voiceId
    });
  });

  it("loads extension ids such as down-jacket-cuff from live REEL_CONCEPTS", () => {
    loadExtensions(ROOT);
    const concept = REEL_CONCEPTS.find((entry) => entry.id === "down-jacket-cuff");
    expect(concept, "down-jacket-cuff should be admitted by loadExtensions").toBeDefined();
    const { plans } = buildReburnPlans({
      ids: ["down-jacket-cuff"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(plans[0]!.narration).toBe(concept!.narration);
    expect(plans[0]!.hook).toBe(concept!.hook);
    expect(plans[0]!.close).toBe(concept!.close);
  });

  it("lists variant mp4 filenames from the run reels/ directory", () => {
    const run = mkdtempSync(join(tmpdir(), "reburn-run-"));
    mkdirSync(join(run, "reels"));
    writeFileSync(join(run, "reels", "white-shoe-yellowing.mp4"), "x");
    writeFileSync(join(run, "reels", "white-shoe-yellowing-15s.mp4"), "x");
    writeFileSync(join(run, "reels", "white-shoe-yellowing-15s-tA.mp4"), "x");
    writeFileSync(join(run, "reels", "handbag-handle.mp4"), "x");
    const { plans } = buildReburnPlans({
      ids: ["white-shoe-yellowing"],
      date: "2026-09-08",
      runDir: run,
      root: ROOT
    });
    expect(plans[0]!.variant_assets).toEqual([
      "white-shoe-yellowing-15s-tA.mp4",
      "white-shoe-yellowing-15s.mp4",
      "white-shoe-yellowing.mp4"
    ]);
    expect(listVariantAssets(join(run, "reels"), "handbag-handle")).toEqual(["handbag-handle.mp4"]);
  });

  it("returns unknown ids without inventing a plan", () => {
    const { plans, unknown, available } = buildReburnPlans({
      ids: ["not-a-real-concept"],
      date: "2026-09-08",
      root: ROOT
    });
    expect(plans).toEqual([]);
    expect(unknown).toEqual(["not-a-real-concept"]);
    expect(available).toContain("white-shoe-yellowing");
  });
});

describe("reel-reburn-plan CLI", () => {
  it("emits hook/close/narration for a known id", () => {
    const result = runPlan(["white-shoe-yellowing", "--date", "2026-09-08"]);
    expect(result.status, spawnDump(result)).toBe(0);
    const payload = lastJson(`${result.stdout ?? ""}`) as {
      id: string;
      hook: string;
      close: string;
      narration: string;
      voice: { label: string };
    };
    loadExtensions(ROOT);
    const concept = REEL_CONCEPTS.find((entry) => entry.id === "white-shoe-yellowing")!;
    expect(payload.id).toBe("white-shoe-yellowing");
    expect(payload.hook).toBe(concept.hook);
    expect(payload.close).toBe(concept.close);
    expect(payload.narration).toBe(concept.narration);
    expect(payload.voice.label).toBe(voiceFor("2026-09-08", 3).label);
  });

  it("exits 2 for an unknown id and lists available ids", () => {
    const result = runPlan(["definitely-not-a-concept"]);
    expect(result.status, spawnDump(result)).toBe(UNKNOWN_CONCEPT_EXIT);
    expect(result.status).toBe(2);
    const err = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
    expect(err).toMatch(/Unknown concept: definitely-not-a-concept/);
    expect(err).toMatch(/Known:/);
    expect(err).toContain("white-shoe-yellowing");
  });

  it("changes voice when --date changes", () => {
    const a = runPlan(["white-shoe-yellowing", "--date", "2026-09-08"]);
    const b = runPlan(["white-shoe-yellowing", "--date", "2026-09-09"]);
    expect(a.status, spawnDump(a)).toBe(0);
    expect(b.status, spawnDump(b)).toBe(0);
    const voiceA = (lastJson(a.stdout ?? "") as { voice: { label: string; voiceId: string } }).voice;
    const voiceB = (lastJson(b.stdout ?? "") as { voice: { label: string; voiceId: string } }).voice;
    expect(voiceA).toEqual({
      label: voiceFor("2026-09-08", 3).label,
      voiceId: voiceFor("2026-09-08", 3).voiceId
    });
    expect(voiceB).toEqual({
      label: voiceFor("2026-09-09", 3).label,
      voiceId: voiceFor("2026-09-09", 3).voiceId
    });
    expect(voiceA.label).not.toBe(voiceB.label);
  });
});

describe("reburn-reel-narration.ps1 wiring", () => {
  const scriptPath = join(ROOT, "scripts", "reburn-reel-narration.ps1");
  const raw = readFileSync(scriptPath);

  it("is UTF-8 with BOM so PS 5.1 can parse Chinese", () => {
    expect(raw[0]).toBe(0xef);
    expect(raw[1]).toBe(0xbb);
    expect(raw[2]).toBe(0xbf);
    const text = raw.subarray(3).toString("utf8");
    expect(text).toMatch(/旁白|重燒|字幕/);
  });

  it("calls B1, assemble-reel, npm tts, and supports -WhatIf without writing docs or data", () => {
    const text = raw.subarray(3).toString("utf8");
    expect(text).toContain("reel-reburn-plan");
    expect(text).toContain("assemble-reel.ps1");
    expect(text).toContain("npm.cmd run --silent");
    expect(text).toMatch(/Invoke-NpmSilent "tts"/);
    expect(text).toMatch(/Invoke-NpmSilent "reel-reburn-plan"/);
    expect(text).toMatch(/--slot", "3"/);
    expect(text).toContain("[switch]$WhatIf");
    expect(text).toMatch(/if \(\$WhatIf\)/);
    expect(text).not.toMatch(/docs\\content-calendar/);
    expect(text).not.toMatch(/data\\video-reviews/);
    expect(text).not.toMatch(/record-video-review/);
  });
});
