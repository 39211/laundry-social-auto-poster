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
  calendarHmacKeyPath,
  calendarKeylessChecksum,
  calendarSlotsChecksum,
  inspectDailyContentIntegrity,
  omitRuntimeCalendarFlags,
  shouldRebuildTamperedCalendar,
  stampDailyContentWrite
} from "../src/contentPlan";
import { autoApprove } from "../src/autoApprove";
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

async function writeRaw(root: string, content: DailyContent & { tampered?: boolean }): Promise<void> {
  await writeFile(
    join(root, "data", "content-calendar", `${content.date}.json`),
    `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

describe("calendar HMAC key is gitignored", () => {
  it("data/.gitignore lists the hmac key file", async () => {
    const ignore = await readFile(join(PROJECT, "data", ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.calendar-hmac-key\s*$/m);
  });
});

describe("writeDailyContent stamps the plan writer", () => {
  it("adds written_by and a slots checksum, and a normal load is not tampered", async () => {
    const root = await tempRoot();
    const config = getConfig({ ...process.env, DRY_RUN: "true" });
    const built = buildDailyContent("2026-05-15", config);
    expect(built.written_by).toBe(CALENDAR_WRITTEN_BY);
    expect(built.content_checksum).toBe(calendarSlotsChecksum(built));
    expect(built.content_checksum).toMatch(/^[0-9a-f]{16}$/);

    await writeDailyContent(built, root);
    const raw = JSON.parse(
      await readFile(join(root, "data", "content-calendar", "2026-05-15.json"), "utf8")
    ) as DailyContent & { written_by?: string; content_checksum?: string; tampered?: boolean };
    expect(raw.written_by).toBe("contentPlan.writeDailyContent");
    expect(raw.content_checksum).toBe(calendarSlotsChecksum(raw, { root }));
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

  it("grandfathers unstamped calendars from before the stamping regime, even for today", async () => {
    // 2026-08-17 and 2026-08-18 existed on disk before stamping shipped. If
    // the grace window disappears, the first 06:30 run after the feature lands
    // force-rebuilds an approved day — this test is that morning in miniature.
    const root = await tempRoot();
    const grace = externalCalendar(TODAY);
    await writeRaw(root, grace);

    const loaded = await loadDailyContent(TODAY, root, { today: TODAY });
    expect(loaded?.tampered).toBeUndefined();

    const inspection = inspectDailyContentIntegrity(grace, { today: TODAY });
    expect(inspection.legacy).toBe(true);
    expect(inspection.tampered).toBe(false);
    expect(inspection.shouldRebuild).toBe(false);
    expect(shouldRebuildTamperedCalendar(grace, { today: TODAY })).toBe(false);
  });

  it("closes the grace window at the adoption date: unstamped 2026-08-19 today stays tampered", () => {
    // Discriminates in both directions: widen the grace past adoption and this
    // goes red; the sibling test above goes red if the grace is removed.
    const forged = externalCalendar("2026-08-19");
    const inspection = inspectDailyContentIntegrity(forged, { today: "2026-08-19" });
    expect(inspection.tampered).toBe(true);
    expect(inspection.legacy).toBe(false);
    expect(inspection.shouldRebuild).toBe(true);
    expect(inspection.reasons).toContain("missing written_by");
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
      reasons: [],
      weak: false
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
    expect(rebuilt?.content_checksum).toBe(calendarSlotsChecksum(rebuilt!, { root }));
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
    const generate = script.indexOf("Invoke-TrustedProductionNpm -Root $root run generate -- --date $date --force");
    const manifest = script.indexOf("Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --date $date");
    const evidence = script.indexOf("calendar-tamper-");
    const toast = script.indexOf("行事曆被外部寫手竄改");
    const approve = script.indexOf("Invoke-TrustedProductionNpm -Root $root run auto-approve");
    expect(inspect).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(inspect);
    expect(manifest).toBeGreaterThan(generate);
    expect(evidence).toBeGreaterThan(-1);
    expect(toast).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(manifest);
    expect(script).toContain("$generateCode");
    expect(script).toContain("$manifestCode");
    const refuse = script.indexOf("refusing auto-approve");
    expect(refuse).toBeGreaterThan(manifest);
    expect(refuse).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(refuse);
    expect(script).toMatch(/\$generateCode -ne 0 -or \$manifestCode -ne 0/);
  });

  it("daily-generate inspects the existing-calendar branch before the images-ready exit", async () => {
    const script = await readFile(join(PROJECT, "scripts", "daily-generate.ps1"), "utf8");
    const inspect = script.indexOf("inspect-calendar");
    const generate = script.indexOf("Invoke-TrustedProductionNpm -Root $root run generate -- --date $date --force");
    const manifest = script.indexOf("Invoke-TrustedProductionNpm -Root $root run generate-image-manifest -- --date $date");
    const evidence = script.indexOf("calendar-tamper-");
    const earlyExit = script.indexOf("$hasCalendar -and $imagesReady");
    expect(inspect).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(inspect);
    expect(manifest).toBeGreaterThan(generate);
    expect(evidence).toBeGreaterThan(-1);
    expect(earlyExit).toBeGreaterThan(inspect);
    expect(script).toContain("Invoke-DayCarouselVisualQa");
    expect(script.indexOf("Invoke-DayCarouselVisualQa")).toBeLessThan(earlyExit);
    expect(script).toContain("generate-missing-images.ps1");
    expect(script).toContain("-QaOnly");
    const finished = script.indexOf("Generation finished; calendar and images are both ready.");
    expect(finished).toBeGreaterThan(earlyExit);
    expect(script.indexOf("Invoke-DayCarouselVisualQa", finished)).toBeGreaterThan(finished);
  });
});

describe("checksum covers envelope and HMAC", () => {
  it("marks a date, timezone, or generated_at change as tampered", async () => {
    const root = await tempRoot();
    const stamped = stampDailyContentWrite(externalCalendar(FUTURE), { root });
    const dateChanged = { ...stamped, date: "2026-08-21" };
    const tzChanged = { ...stamped, timezone: "UTC" };
    const generatedChanged = { ...stamped, generated_at: "2099-01-01T00:00:00.000Z" };

    for (const forged of [dateChanged, tzChanged, generatedChanged]) {
      const inspection = inspectDailyContentIntegrity(forged, { today: TODAY, root });
      expect(inspection.tampered).toBe(true);
      expect(inspection.reasons).toContain("content_checksum mismatch");
    }
  });

  it("rejects a forged written_by plus recomputed keyless checksum", async () => {
    const root = await tempRoot();
    const stamped = stampDailyContentWrite(externalCalendar(FUTURE), { root });
    const rewritten: DailyContent = {
      ...stamped,
      slots: stamped.slots.map((item, index) =>
        index === 0 ? { ...item, topic: "forged topic" } : item
      )
    };
    const forged = {
      ...rewritten,
      written_by: CALENDAR_WRITTEN_BY,
      content_checksum: calendarKeylessChecksum(rewritten)
    };
    const inspection = inspectDailyContentIntegrity(forged, { today: TODAY, root });
    expect(inspection.tampered).toBe(true);
    expect(inspection.reasons).toContain("content_checksum mismatch");
    expect(inspection.weak).toBe(false);
  });

  it("mutation: keyless recompute only passes when HMAC is not applied", async () => {
    const root = await tempRoot();
    const stamped = stampDailyContentWrite(externalCalendar(FUTURE), { root });
    expect(stamped.content_checksum).not.toBe(calendarKeylessChecksum(stamped));
    const forged = {
      ...stamped,
      written_by: CALENDAR_WRITTEN_BY,
      content_checksum: calendarKeylessChecksum(stamped)
    };
    expect(inspectDailyContentIntegrity(forged, { today: TODAY, root }).tampered).toBe(true);
    expect(calendarHmacKeyPath(root)).toContain(".calendar-hmac-key");
  });

  it("marks integrity weak when the HMAC key is missing and the keyless digest matches", async () => {
    const root = await tempRoot();
    const content = externalCalendar(FUTURE);
    const keyless = {
      ...content,
      written_by: CALENDAR_WRITTEN_BY,
      content_checksum: calendarKeylessChecksum(content)
    };
    const inspection = inspectDailyContentIntegrity(keyless, { today: TODAY, root });
    expect(inspection.tampered).toBe(false);
    expect(inspection.weak).toBe(true);
    expect(inspection.shouldRebuild).toBe(false);
  });
});

describe("persisted tampered flag is runtime-only", () => {
  it("strips a disk tampered flag on load when inspection is clean", async () => {
    // 2026-08-18 outage: inspect-calendar said tampered:false (grace/legacy)
    // while autoApprove refused because loadDailyContent returned the leaked
    // disk field as-is. Mutation: drop omitRuntimeCalendarFlags in load and
    // this goes red.
    const root = await tempRoot();
    const leaked = { ...externalCalendar(TODAY), tampered: true };
    await writeRaw(root, leaked);

    const loaded = await loadDailyContent(TODAY, root, { today: TODAY });
    expect(loaded).toBeTruthy();
    expect(loaded?.tampered).toBeUndefined();
    expect(loaded && "tampered" in loaded).toBe(false);
    expect(inspectDailyContentIntegrity(leaked, { today: TODAY }).tampered).toBe(false);
  });

  it("still marks a genuinely tampered calendar after stripping the disk flag", async () => {
    const root = await tempRoot();
    const forged = { ...externalCalendar(FUTURE), tampered: true };
    await writeRaw(root, forged);

    const loaded = await loadDailyContent(FUTURE, root, { today: TODAY });
    expect(loaded?.tampered).toBe(true);
    expect(inspectDailyContentIntegrity(omitRuntimeCalendarFlags(forged), { today: TODAY }).tampered).toBe(
      true
    );
  });

  it("writeDailyContent and stampDailyContentWrite never serialize tampered", async () => {
    const root = await tempRoot();
    const config = getConfig({ ...process.env, DRY_RUN: "true" });
    const built = {
      ...buildDailyContent("2026-05-15", config),
      tampered: true
    };

    const stamped = stampDailyContentWrite(built, { root });
    expect(stamped.tampered).toBeUndefined();
    expect("tampered" in stamped).toBe(false);

    await writeDailyContent(built, root);
    const json = await readFile(join(root, "data", "content-calendar", "2026-05-15.json"), "utf8");
    expect(json).not.toMatch(/"tampered"\s*:/);
    const raw = JSON.parse(json) as { tampered?: boolean };
    expect(raw.tampered).toBeUndefined();
    expect("tampered" in raw).toBe(false);
  });

  it("autoApprove ignores a leaked disk flag when inspection is clean", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "publishing-policy.json"),
      JSON.stringify({
        status: "active",
        start_date: "2026-08-01",
        end_date: "2026-12-31",
        platforms: ["facebook", "instagram"],
        slots: [{ slot: 1 }, { slot: 2 }]
      }),
      "utf8"
    );
    await writeRaw(root, { ...externalCalendar(TODAY), tampered: true });

    const result = await autoApprove({ date: TODAY, root });
    expect(result.blockers.some((text) => text.includes("calendar_integrity"))).toBe(false);
    expect(result.checks.find((item) => item.name === "calendar_integrity")?.ok).not.toBe(false);
  });
});

describe("tampered consumers fail closed", () => {
  it("autoApprove refuses a tampered calendar and writes no approval", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(
      join(root, "data", "publishing-policy.json"),
      JSON.stringify({
        status: "active",
        start_date: "2026-08-01",
        end_date: "2026-12-31",
        platforms: ["facebook", "instagram"],
        slots: [{ slot: 1 }, { slot: 2 }]
      }),
      "utf8"
    );
    const stamped = stampDailyContentWrite(externalCalendar(FUTURE), { root });
    await writeRaw(root, { ...stamped, generated_at: "2099-01-01T00:00:00.000Z" });

    const result = await autoApprove({ date: FUTURE, root });
    expect(result.approved).toBe(false);
    expect(result.already_approved).toBe(false);
    expect(result.approved_slots).toEqual([]);
    expect(result.blockers.some((text) => text.includes("calendar_integrity"))).toBe(true);
    await expect(readFile(join(root, "data", "approved-log", `${FUTURE}.json`), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});
