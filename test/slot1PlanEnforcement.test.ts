import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../src/config";
import {
  SLOT1_AIRED_REPEAT_WINDOW_DAYS,
  buildDailyContent,
  recentAiredTopics,
  repeatingObjectGram,
  resolveSlot1WithPlan
} from "../src/contentPlan";
import { generateDailyContent } from "../src/generateDailyContent";
import { buildGrowthPlaybook, plannedTopicSlot1, serviceForTopic } from "../src/growthPlaybook";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
});

// 2026-08-27 has no special slot and its planned object (登山鞋) appears
// nowhere in the seed rotation, so adoption vs rotation is unambiguous.
const DATE = "2026-08-27";
const EVE = "2026-08-26";
const PLANNED = "登山鞋泥沙";
// The F25 shape: the evening before, slot 2 is scheduled to post the same
// object the plan would hand slot 1 the next morning.
const PLANNED_COLLIDING = "行李箱布面";
const EVE_TOPIC = "細節拆解：行李箱布面與輪子灰塵，先看容易忽略的位置";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }))
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "slot1-plan-"));
  roots.push(root);
  await mkdir(join(root, "data", "content-calendar"), { recursive: true });
  await mkdir(join(root, "data", "posted-log"), { recursive: true });
  return root;
}

function playbookSlot1(date: string) {
  const day = buildGrowthPlaybook().days.find((item) => item.date === date);
  const slot = day?.slots.find((item) => item.slot === 1);
  if (!slot) throw new Error(`no playbook slot 1 for ${date}`);
  return slot;
}

async function writePlan(root: string, plan: Record<string, string>): Promise<void> {
  await writeFile(join(root, "data", "slot1-plan.json"), JSON.stringify(plan), "utf8");
}

async function writeCalendar(
  root: string,
  date: string,
  slots: Array<{ slot: number; topic: string }>
): Promise<void> {
  await writeFile(
    join(root, "data", "content-calendar", `${date}.json`),
    JSON.stringify({
      date,
      timezone: "Asia/Taipei",
      generated_at: new Date().toISOString(),
      slots
    }),
    "utf8"
  );
}

describe("slot 1 obeys the committed 90-day plan (F25)", () => {
  it("adopts the planned topic read from data/slot1-plan.json", async () => {
    const root = await tempRoot();
    await writePlan(root, { [DATE]: PLANNED });

    const content = buildDailyContent(DATE, config, {
      root,
      applySlot1Plan: true,
      applyAiredCooldown: true
    });
    const slot1 = content.slots.find((slot) => slot.slot === 1);
    expect(slot1?.topic).toContain("登山鞋");
    expect(slot1?.topic).not.toBe(playbookSlot1(DATE).topic);
  });

  it("keeps the rotation when no plan file exists", async () => {
    const root = await tempRoot();
    const content = buildDailyContent(DATE, config, {
      root,
      applySlot1Plan: true,
      applyAiredCooldown: true
    });
    expect(content.slots.find((slot) => slot.slot === 1)?.topic).toBe(playbookSlot1(DATE).topic);
  });

  it("keeps the rotation when the flag is off, even with a plan on disk", async () => {
    const root = await tempRoot();
    await writePlan(root, { [DATE]: PLANNED });
    const content = buildDailyContent(DATE, config, { root, applyAiredCooldown: true });
    expect(content.slots.find((slot) => slot.slot === 1)?.topic).toBe(playbookSlot1(DATE).topic);
  });

  it("builds the planned slot around the planned object's own service family", () => {
    const slot = plannedTopicSlot1(DATE, PLANNED);
    expect(slot).toBeTruthy();
    expect(slot!.topic).toContain("登山鞋");
    expect(slot!.date).toBe(DATE);
    expect(slot!.slot).toBe(1);
    // 登山鞋 is shoe-bag copy; the day's seed service must not leak through.
    expect(slot!.seo_sync_page).toBe("/services/shoe-bag-care.html");
    expect(slot!.hashtags[0]).toBe("#私享家洗衣店");
    expect(slot!.hook).toContain("登山鞋");
  });

  it("serviceForTopic speaks the plan's own vocabulary", () => {
    expect(serviceForTopic("開學前學生制服檢查")).toBe("shirt-suit");
    expect(serviceForTopic("白鞋鞋帶發灰")).toBe("white-shoe");
    expect(serviceForTopic("精品名牌鞋護理")).toBe("luxury-dry");
    expect(serviceForTopic("被單黃斑")).toBe("bedding-duvet");
    expect(serviceForTopic("健身房毛巾批量洗")).toBe("pickup-delivery");
    expect(serviceForTopic("窗簾拆洗")).toBe("fabric-storage");
  });

  it("a hand-authored special slot outranks the plan", () => {
    // 2026-09-25 is the mid-autumn real-shop-photo day.
    expect(plannedTopicSlot1("2026-09-25", "包包內裡")).toBeUndefined();
    const raw = playbookSlot1("2026-09-25");
    const decision = resolveSlot1WithPlan("2026-09-25", raw, "包包內裡", []);
    expect(decision.source).toBe("growth-playbook");
    expect(decision.fallbackReason).toBeUndefined();
    expect(decision.slot.topic).toBe(raw.topic);
  });

  it("a date outside the playbook window cannot adopt the plan", () => {
    expect(plannedTopicSlot1("2027-01-01", PLANNED)).toBeUndefined();
  });

  it("falls back to the rotation and records why when the planned topic sits inside the window", () => {
    const raw = playbookSlot1(DATE);
    const decision = resolveSlot1WithPlan(DATE, raw, PLANNED_COLLIDING, [EVE_TOPIC]);
    expect(decision.source).toBe("growth-playbook");
    expect(decision.fallbackReason).toContain(PLANNED_COLLIDING);
    expect(repeatingObjectGram(decision.slot.topic, EVE_TOPIC)).toBeUndefined();
  });
});

describe("the seven-day window sees scheduled-but-unaired posts (F25 time gap)", () => {
  it("counts a not-yet-finished day's calendar topics without posted-log proof", async () => {
    const root = await tempRoot();
    await writeCalendar(root, EVE, [{ slot: 2, topic: EVE_TOPIC }]);
    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root, EVE)).toEqual([
      EVE_TOPIC
    ]);
  });

  it("a finished day without a posted-log stays dark, exactly as before", async () => {
    const root = await tempRoot();
    await writeCalendar(root, EVE, [{ slot: 2, topic: EVE_TOPIC }]);
    expect(recentAiredTopics(DATE, SLOT1_AIRED_REPEAT_WINDOW_DAYS, root, DATE)).toEqual([]);
  });

  it("blocks the planned topic against a same-object post scheduled for tonight", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const root = await tempRoot();
      await writePlan(root, { [DATE]: PLANNED_COLLIDING });
      await writeCalendar(root, EVE, [{ slot: 2, topic: EVE_TOPIC }]);

      const content = buildDailyContent(DATE, config, {
        root,
        applySlot1Plan: true,
        applyAiredCooldown: true,
        today: EVE
      });
      const slot1 = content.slots.find((slot) => slot.slot === 1);
      expect(slot1?.topic).not.toContain("行李箱");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("[slot1-plan]"));
    } finally {
      warn.mockRestore();
    }
  });

  it("adopts the same planned topic once that scheduled day turned out dark", async () => {
    const root = await tempRoot();
    await writePlan(root, { [DATE]: PLANNED_COLLIDING });
    await writeCalendar(root, EVE, [{ slot: 2, topic: EVE_TOPIC }]);

    const content = buildDailyContent(DATE, config, {
      root,
      applySlot1Plan: true,
      applyAiredCooldown: true,
      today: DATE
    });
    expect(content.slots.find((slot) => slot.slot === 1)?.topic).toContain("行李箱");
  });

  it("generateDailyContent feeds the plan into the calendar it writes", async () => {
    const root = await tempRoot();
    await writePlan(root, { [DATE]: PLANNED });

    await generateDailyContent({ date: DATE, root, force: true });
    const written = JSON.parse(
      await readFile(join(root, "data", "content-calendar", `${DATE}.json`), "utf8")
    ) as { slots: Array<{ slot: number; topic: string }> };
    expect(written.slots.find((slot) => slot.slot === 1)?.topic).toContain("登山鞋");
  });
});
