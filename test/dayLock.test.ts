import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { healDay, lockDay } from "../src/dayLock";
import { loadDailyContent, writeDailyContent } from "../src/logging";
import type { DailySlot } from "../src/types";

const DATE = "2099-01-01";
const roots: string[] = [];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function slot(slotNumber: number): DailySlot {
  return {
    slot: slotNumber,
    time: slotNumber === 1 ? "11:30" : "20:30",
    category: "知識文",
    topic: `鎖定測試 ${slotNumber}`,
    media_type: "image",
    instagram_caption: "caption",
    facebook_caption: "caption",
    image_prompt: "image",
    local_image_path: `docs/assets/${DATE}/slot-${String(slotNumber).padStart(2, "0")}.png`,
    public_image_url: `https://example.test/${DATE}/slot-${slotNumber}.png`,
    visual_route: "shop-inspection",
    traffic_route: "object-proof",
    status: "pending"
  };
}

async function seedCleanDay(): Promise<{ root: string; slot1: DailySlot }> {
  const root = await mkdtemp(join(tmpdir(), "day-lock-tamper-"));
  roots.push(root);
  const slot1 = slot(1);
  await writeDailyContent(
    {
      date: DATE,
      timezone: "Asia/Taipei",
      generated_at: "2099-01-01T03:00:00.000Z",
      slots: [slot1, slot(2)]
    },
    root
  );
  const imagePath = join(root, ...slot1.local_image_path.split("/"));
  await mkdir(join(imagePath, ".."), { recursive: true });
  await writeFile(imagePath, "non-empty image bytes", "utf8");
  return { root, slot1 };
}

async function tamperCalendar(root: string): Promise<string> {
  const path = join(root, "data", "content-calendar", `${DATE}.json`);
  const raw = JSON.parse(await readFile(path, "utf8")) as { slots: Array<{ topic: string }> };
  raw.slots[0]!.topic = "外部竄改後的 slot 1";
  const tampered = `${JSON.stringify(raw, null, 2)}\n`;
  await writeFile(path, tampered, "utf8");
  return tampered;
}

async function createVerifiedLock(root: string): Promise<{ path: string; raw: Record<string, unknown> }> {
  expect(await lockDay(DATE, root)).toBe("locked");
  const path = join(root, "data", "day-locks", `${DATE}.json`);
  return { path, raw: JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("day lock tampered-calendar containment", () => {
  it("accepts a signed existing lock only when it still binds this exact canonical slot", async () => {
    const { root } = await seedCleanDay();
    const { path, raw } = await createVerifiedLock(root);

    expect(raw).toMatchObject({
      schema_version: 1,
      date: DATE,
      calendar_checksum: expect.stringMatching(/^[a-f0-9]{16}$/),
      slot1_checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      lock_checksum: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await expect(lockDay(DATE, root)).resolves.toBe("already locked");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(raw);
  });

  it.each([
    ["tampered slot payload", (lock: Record<string, unknown>) => ({
      ...lock,
      slot1: { ...(lock.slot1 as Record<string, unknown>), topic: "遭竄改的鎖內容" }
    })],
    ["malformed JSON", () => "{ not-json"],
    ["wrong embedded date", (lock: Record<string, unknown>) => ({ ...lock, date: "2099-01-02" })],
    ["wrong slot tuple", (lock: Record<string, unknown>) => ({
      ...lock,
      slot1: { ...(lock.slot1 as Record<string, unknown>), slot: 2 }
    })]
  ])("refuses an existing lock with %s instead of reporting already locked", async (_label, mutate) => {
    const { root } = await seedCleanDay();
    const { path, raw } = await createVerifiedLock(root);
    const mutated = mutate(raw);
    const serialized = typeof mutated === "string" ? mutated : `${JSON.stringify(mutated, null, 2)}\n`;
    await writeFile(path, serialized, "utf8");

    await expect(lockDay(DATE, root)).rejects.toThrow(
      "Existing day lock for 2099-01-01 is malformed, tampered, or does not bind the canonical calendar"
    );
    expect(await readFile(path, "utf8")).toBe(serialized);
  });

  it("refuses a signed old lock when the current canonical calendar binding changed", async () => {
    const { root, slot1 } = await seedCleanDay();
    const { path, raw } = await createVerifiedLock(root);
    const rewrittenSlot1 = { ...slot1, topic: "重新排程後的 slot 1" };
    await writeDailyContent(
      {
        date: DATE,
        timezone: "Asia/Taipei",
        generated_at: "2099-01-01T03:00:00.000Z",
        slots: [rewrittenSlot1, slot(2)]
      },
      root
    );

    await expect(lockDay(DATE, root)).rejects.toThrow(
      "Existing day lock for 2099-01-01 is malformed, tampered, or does not bind the canonical calendar"
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(raw);
  });

  it("refuses a tampered calendar before creating a lock", async () => {
    const { root } = await seedCleanDay();
    const before = await tamperCalendar(root);
    const target = join(root, "data", "day-locks", `${DATE}.json`);

    await expect(lockDay(DATE, root)).rejects.toThrow(
      "Calendar integrity for 2099-01-01 is marked tampered; refusing to create or update a day lock."
    );

    expect(await exists(target)).toBe(false);
    expect(await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")).toBe(before);
  });

  it("refuses a tampered calendar with an old lock without restamping either record", async () => {
    const { root, slot1 } = await seedCleanDay();
    const lockPath = join(root, "data", "day-locks", `${DATE}.json`);
    await mkdir(join(root, "data", "day-locks"), { recursive: true });
    const oldLock = `${JSON.stringify({ date: DATE, locked_at: "2099-01-01T03:05:00.000Z", slot1 }, null, 2)}\n`;
    await writeFile(lockPath, oldLock, "utf8");
    const tamperedCalendar = await tamperCalendar(root);

    await expect(healDay(DATE, root)).rejects.toThrow(
      "Calendar integrity for 2099-01-01 is marked tampered; refusing to heal or rewrite the calendar."
    );

    expect(await readFile(lockPath, "utf8")).toBe(oldLock);
    expect(await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")).toBe(tamperedCalendar);
    expect((await loadDailyContent(DATE, root))?.tampered).toBe(true);
  });
});
