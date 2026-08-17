import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  CALENDAR_WRITTEN_BY,
  buildDailyContent,
  calendarSlotsChecksum,
  inspectDailyContentIntegrity,
  shouldRebuildTamperedCalendar,
  stampDailyContentWrite
} from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import {
  calendarTamperEvidencePath,
  detectAndRecordCalendarTamper,
  loadDailyContent,
  writeDailyContent
} from "../src/logging";
import type { DailyContent, DailySlot } from "../src/types";

const execFileAsync = promisify(execFile);
const PROJECT = process.cwd();
const TODAY = "2026-08-17";
const FUTURE = "2026-08-20";
const PAST = "2026-08-10";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "calendar-tamper-"));
  roots.push(root);
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  return root;
}

function slot(date: string, n: number): DailySlot {
  return {
    slot: n,
    time: n === 1 ? "11:30" : n === 3 ? "12:00" : "20:30",
    category: n === 1 ? "知識文" : "情境文",
    topic: `external topic ${n}`,
    format: "image-post",
    media_type: "image",
    instagram_caption: `ig ${n}`,
    facebook_caption: `fb ${n}`,
    image_prompt: "old slides prompt",
    visual_route: "macro-detail",
    traffic_route: "object-proof",
    local_image_path: `docs/assets/${date}/slot-0${n}.png`,
    public_image_url: `https://example.com/assets/${date}/slot-0${n}.png`,
    status: "pending"
  };
}

function externalCalendar(date: string, slots = [slot(date, 1), slot(date, 2)]): DailyContent {
  return {
    date,
    timezone: "Asia/Taipei",
    generated_at: `${date}T06:45:30.000+08:00`,
    slots
  };
}

async function writeRaw(root: string, content: DailyContent): Promise<void> {
  await writeFile(
    join(root, "data", "content-calendar", `${content.date}.json`),
    `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

describe("writeDailyContent stamps the plan writer", () => {
  it("adds written_by and a slots checksum, and a normal load is not tampered", async () => {
    const root = await tempRoot();
    const config = getConfig({ ...process.env, DRY_RUN: "true" });
    const built = buildDailyContent("2026-05-15", config);
    expect(built.written_by).toBe(CALENDAR_WRITTEN_BY);
    expect(built.content_checksum).toBe(calendarSlotsChecksum(built.slots));
    expect(built.content_checksum).toMatch(/^[0-9a-f]{16}$/);

    await writeDailyContent(built, root);
    const raw = JSON.parse(
      await readFile(join(root, "data", "content-calendar", "2026-05-15.json"), "utf8")
    ) as DailyContent & { written_by?: string; content_checksum?: string; tampered?: boolean };
    expect(raw.written_by).toBe("contentPlan.writeDailyContent");
    expect(raw.content_checksum).toBe(calendarSlotsChecksum(raw.slots));
    expect(raw.tampered).toBeUndefined();

    const loaded = await loadDailyContent("2026-05-15", root, { today: TODAY });
    expect(loaded?.tampered).toBeUndefined();
    expect(loaded?.written_by).toBe(CALENDAR_WRITTEN_BY);
    expect(shouldRebuildTamperedCalendar(loaded!, { today: TODAY })).toBe(false);
  });
});

describe("loadDailyContent tamper detection", () => {
  it("marks a today/future external calendar (no checksum) as tampered", async () => {
    const root = await tempRoot();
    const forged = externalCalendar(FUTURE);
    await writeRaw(root, forged);

    const loaded = await loadDailyContent(FUTURE, root, { today: TODAY });
    expect(loaded?.tampered).toBe(true);
    expect(loaded?.slots).toHaveLength(2);

    const inspection = inspectDailyContentIntegrity(forged, { today: TODAY });
    expect(inspection.tampered).toBe(true);
    expect(inspection.legacy).toBe(false);
    expect(inspection.shouldRebuild).toBe(true);
    expect(inspection.reasons).toContain("missing written_by");
    expect(inspection.reasons).toContain("missing content_checksum");
  });

  it("treats a historical file without checksum as legacy, not tampered", async () => {
    const root = await tempRoot();
    const legacy = externalCalendar(PAST);
    await writeRaw(root, legacy);

    const loaded = await loadDailyContent(PAST, root, { today: TODAY });
    expect(loaded?.tampered).toBeUndefined();
    expect(inspectDailyContentIntegrity(legacy, { today: TODAY })).toEqual({
      tampered: false,
      legacy: true,
      shouldRebuild: false,
      reasons: []
    });
    expect(shouldRebuildTamperedCalendar(legacy, { today: TODAY })).toBe(false);
  });

  it("marks a present-but-wrong checksum as tampered even when written_by is set", async () => {
    const root = await tempRoot();
    const stamped = stampDailyContentWrite(externalCalendar(FUTURE));
    const forged = { ...stamped, content_checksum: "ffffffffffffffff" };
    await writeRaw(root, forged);

    const loaded = await loadDailyContent(FUTURE, root, { today: TODAY });
    expect(loaded?.tampered).toBe(true);
    const inspection = inspectDailyContentIntegrity(forged, { today: TODAY });
    expect(inspection.tampered).toBe(true);
    expect(inspection.shouldRebuild).toBe(true);
    expect(inspection.reasons).toContain("content_checksum mismatch");
  });
});

describe("tamper rebuild path", () => {
  it("records evidence and rebuilds from the plan with a clean stamp", async () => {
    const root = await tempRoot();
    const forged = externalCalendar(FUTURE);
    await writeRaw(root, forged);

    const detection = await detectAndRecordCalendarTamper(FUTURE, root, { today: TODAY });
    expect(detection.present).toBe(true);
    expect(detection.tampered).toBe(true);
    expect(detection.shouldRebuild).toBe(true);
    expect(detection.evidencePath).toBe(calendarTamperEvidencePath(FUTURE, root));

    const evidence = JSON.parse(await readFile(detection.evidencePath!, "utf8")) as {
      date: string;
      action: string;
      reasons: string[];
      tampered_copy: DailyContent;
    };
    expect(evidence.date).toBe(FUTURE);
    expect(evidence.action).toBe("rebuild_from_plan");
    expect(evidence.tampered_copy.generated_at).toBe(`${FUTURE}T06:45:30.000+08:00`);
    expect(evidence.tampered_copy.slots[0]?.topic).toBe("external topic 1");
    expect("written_by" in evidence.tampered_copy).toBe(false);

    const rebuiltPath = await generateDailyContent({ date: FUTURE, root, force: true });
    expect(rebuiltPath).toContain(`${FUTURE}.json`);

    const rebuilt = await loadDailyContent(FUTURE, root, { today: TODAY });
    expect(rebuilt?.tampered).toBeUndefined();
    expect(rebuilt?.written_by).toBe(CALENDAR_WRITTEN_BY);
    expect(rebuilt?.content_checksum).toBe(calendarSlotsChecksum(rebuilt!.slots));
    expect(rebuilt?.generated_at.endsWith("Z")).toBe(true);
    expect(rebuilt?.slots[0]?.topic).not.toBe("external topic 1");

    const after = await detectAndRecordCalendarTamper(FUTURE, root, { today: TODAY });
    expect(after.shouldRebuild).toBe(false);
    expect(after.tampered).toBe(false);
  });

  it("does not write evidence for a clean writeDailyContent calendar", async () => {
    const root = await tempRoot();
    const config = getConfig({ ...process.env, DRY_RUN: "true" });
    await writeDailyContent(buildDailyContent(FUTURE, config), root);

    const detection = await detectAndRecordCalendarTamper(FUTURE, root, { today: TODAY });
    expect(detection.shouldRebuild).toBe(false);
    expect(detection.tampered).toBe(false);
    await expect(readFile(calendarTamperEvidencePath(FUTURE, root), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("CLI --inspect-calendar exits 2 and prints shouldRebuild for a forged calendar", async () => {
    const root = await tempRoot();
    await writeRaw(root, externalCalendar(FUTURE));

    const command = [
      "call node_modules\\.bin\\tsx.cmd src/logging.ts --inspect-calendar",
      `--date ${FUTURE}`,
      `--root=${root}`,
      `--today ${TODAY}`
    ].join(" ");
    let code = 0;
    let stdout = "";
    try {
      const result = await execFileAsync("cmd.exe", ["/d", "/c", command], {
        cwd: PROJECT,
        windowsHide: true
      });
      stdout = result.stdout;
    } catch (error) {
      const failure = error as { code?: unknown; status?: unknown; stdout?: string };
      const raw = failure.code ?? failure.status ?? 0;
      code = Number(raw);
      stdout = failure.stdout ?? "";
    }

    const jsonLine = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{") && line.includes("shouldRebuild"))
      .at(-1);
    expect(jsonLine).toBeTruthy();
    const payload = JSON.parse(jsonLine!) as { shouldRebuild: boolean; tampered: boolean };
    expect(payload.tampered).toBe(true);
    expect(payload.shouldRebuild).toBe(true);
    expect(code).toBe(2);
  });
});

describe("daily scripts rebuild on tamper", () => {
  it("daily-approve inspects before auto-approve and force-rebuilds", async () => {
    const script = await readFile(join(PROJECT, "scripts", "daily-approve.ps1"), "utf8");
    const inspect = script.indexOf("inspect-calendar");
    const generate = script.indexOf("npm.cmd run generate -- --date $date --force");
    const manifest = script.indexOf("npm.cmd run generate-image-manifest -- --date $date");
    const evidence = script.indexOf("calendar-tamper-");
    const toast = script.indexOf("行事曆被外部寫手竄改");
    const approve = script.indexOf("npm.cmd run auto-approve");
    expect(inspect).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(inspect);
    expect(manifest).toBeGreaterThan(generate);
    expect(evidence).toBeGreaterThan(-1);
    expect(toast).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(manifest);
  });

  it("daily-generate inspects the existing-calendar branch before the images-ready exit", async () => {
    const script = await readFile(join(PROJECT, "scripts", "daily-generate.ps1"), "utf8");
    const inspect = script.indexOf("inspect-calendar");
    const generate = script.indexOf("npm.cmd run generate -- --date $date --force");
    const manifest = script.indexOf("npm.cmd run generate-image-manifest -- --date $date");
    const evidence = script.indexOf("calendar-tamper-");
    const earlyExit = script.indexOf("$hasCalendar -and $imagesReady");
    expect(inspect).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(inspect);
    expect(manifest).toBeGreaterThan(generate);
    expect(evidence).toBeGreaterThan(-1);
    expect(earlyExit).toBeGreaterThan(inspect);
  });
});
