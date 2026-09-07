import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBJECT_SPEC_RULES,
  garmentPassportFromTopic,
  objectSpecFromTopic
} from "../src/contentPlan";

const PLAN_PATH = join(__dirname, "..", "data", "slot1-plan.json");

/** Independent expected tokens. Removing the matching table row must turn that day red. */
const NEXT_14_DAYS: Array<{
  date: string;
  topic: string;
  object: string;
  material: string;
  sceneLockOnly?: boolean;
}> = [
  { date: "2026-08-18", topic: "海報宣傳-免費收送", object: "scene-lock only", material: "n/a", sceneLockOnly: true },
  { date: "2026-08-19", topic: "診所制服每週收送", object: "clinic uniform set", material: "clinic uniform" },
  { date: "2026-08-20", topic: "麂皮鞋雨天急救", object: "suede", material: "suede" },
  { date: "2026-08-21", topic: "開學前學生制服檢查", object: "school uniform set", material: "sailor blouse" },
  { date: "2026-08-22", topic: "童鞋開學檢查", object: "kids sneakers", material: "synthetic mesh kids sneakers" },
  { date: "2026-08-23", topic: "室內鞋汗味", object: "indoor slippers", material: "knit-mesh indoor slippers" },
  { date: "2026-08-24", topic: "皮鞋刮痕補色", object: "leather dress shoes", material: "leather dress shoes" },
  { date: "2026-08-25", topic: "球鞋中底黃斑", object: "grey-and-white running shoes", material: "grey-and-white running shoes" },
  { date: "2026-08-26", topic: "健身房毛巾批量洗", object: "batch of gym towels", material: "gym towels" },
  { date: "2026-08-27", topic: "登山鞋泥沙", object: "hiking boots", material: "split-leather hiking boots" },
  { date: "2026-08-28", topic: "老爹鞋網布", object: "chunky mesh sneakers", material: "chunky mesh sneakers" },
  { date: "2026-08-29", topic: "開學鞋襪", object: "shoes with socks", material: "shoes with socks" },
  { date: "2026-08-30", topic: "白鞋鞋帶發灰", object: "white leather low-top sneakers", material: "white leather" },
  { date: "2026-08-31", topic: "精品名牌鞋護理", object: "designer leather sneakers", material: "designer leather sneakers" }
];

describe("slot1-plan 14-day object passport table", () => {
  const plan = JSON.parse(readFileSync(PLAN_PATH, "utf8").replace(/^\uFEFF/u, "")) as Record<string, string>;

  it.each(NEXT_14_DAYS)("$date $topic maps to $object / $material", (row) => {
    expect(plan[row.date]).toBe(row.topic);
    const spec = objectSpecFromTopic(row.topic);
    const passport = garmentPassportFromTopic(row.topic);
    if (row.sceneLockOnly) {
      expect(spec.sceneLockOnly).toBe(true);
      expect(passport).toMatch(/scene-lock only/i);
      expect(passport).not.toMatch(/generic complete worn laundry item/i);
      expect(passport).not.toMatch(/exactly one complete worn laundry item/i);
      return;
    }
    expect(spec.sceneLockOnly).toBeFalsy();
    expect(passport.toLowerCase()).toContain(row.object.toLowerCase());
    expect(passport.toLowerCase()).toContain(row.material.toLowerCase());
    expect(spec.material.toLowerCase()).toContain(row.material.toLowerCase());
  });

  it("table rows are what the 14-day topics resolve through", () => {
    const ids = OBJECT_SPEC_RULES.map((rule) => rule.id);
    for (const required of [
      "poster-promo",
      "school-uniform",
      "clinic-uniform",
      "gym-towels",
      "shoes-with-socks",
      "suede-shoes",
      "kids-sneakers",
      "indoor-slippers",
      "hiking-boots",
      "chunky-mesh",
      "designer-sneakers"
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("mutation: dropping the suede row would send 麂皮鞋 to leather dress shoes", () => {
    const suede = OBJECT_SPEC_RULES.find((rule) => rule.id === "suede-shoes");
    expect(suede).toBeTruthy();
    expect(suede!.match.test("麂皮鞋雨天急救")).toBe(true);
    expect(/皮鞋/.test("麂皮鞋雨天急救")).toBe(true);
  });

  it("indoor-slippers names a real material and locks sweat to foot-contact surfaces", () => {
    const spec = objectSpecFromTopic("室內鞋汗味");
    const passport = garmentPassportFromTopic("室內鞋汗味");
    expect(spec.material.toLowerCase()).not.toBe("indoor slippers");
    expect(spec.material).toMatch(/knit-mesh/i);
    expect(spec.material).toMatch(/cloth lining/i);
    expect(spec.material).toMatch(/eva foam/i);
    expect(spec.wear).toMatch(/sweat residue/i);
    expect(spec.wear).toMatch(/shoe opening|collar lining/i);
    expect(spec.wear).toMatch(/insole/i);
    expect(spec.wear).toMatch(/heel-counter lining/i);
    expect(spec.wear).toMatch(/everyday-clean/i);
    expect(spec.wear).toMatch(/must not read as overall soiling/);
    expect(spec.wear).not.toMatch(/positions the topic names/);
    expect(passport).toContain(spec.material);
    expect(passport).toContain(spec.wear);
  });

  it("mutation: dropping the school-uniform row would send 學生制服 to clinic uniform", () => {
    const school = OBJECT_SPEC_RULES.find((rule) => rule.id === "school-uniform");
    const clinic = OBJECT_SPEC_RULES.find((rule) => rule.id === "clinic-uniform");
    expect(school).toBeTruthy();
    expect(clinic).toBeTruthy();
    expect(school!.match.test("開學前學生制服檢查")).toBe(true);
    expect(clinic!.match.test("開學前學生制服檢查")).toBe(true);
    const schoolIndex = OBJECT_SPEC_RULES.findIndex((rule) => rule.id === "school-uniform");
    const clinicIndex = OBJECT_SPEC_RULES.findIndex((rule) => rule.id === "clinic-uniform");
    expect(schoolIndex).toBeGreaterThanOrEqual(0);
    expect(clinicIndex).toBeGreaterThan(schoolIndex);
  });
});

describe("F20 fish-2 generic jacket family has a concrete default style", () => {
  it("locks a bare 外套 topic as a beige cotton work jacket, not a category word", () => {
    const spec = objectSpecFromTopic("先看懂：外套領口的皮脂痕跡");
    const passport = garmentPassportFromTopic("先看懂：外套領口的皮脂痕跡");
    expect(spec.noun).toMatch(/beige cotton work jacket/i);
    expect(spec.noun).toMatch(/shirt collar/i);
    expect(spec.noun).toMatch(/buttoned cuffs/i);
    expect(spec.noun).not.toMatch(/everyday fabric jacket/i);
    expect(spec.material).toMatch(/beige cotton twill/i);
    expect(spec.material).toMatch(/shirt collar/i);
    expect(spec.material).toMatch(/cuff buttons/i);
    expect(spec.lockNote).toMatch(/not a down jacket/i);
    expect(spec.lockNote).toMatch(/not a dress shirt/i);
    expect(spec.lockNote).toMatch(/not a wool overcoat/i);
    expect(passport).toContain(spec.noun);
    expect(passport).toContain(spec.lockNote);
    expect(passport).not.toMatch(/everyday fabric jacket/i);
  });

  it("locks a bare 夾克 topic to the same work-jacket default", () => {
    const spec = objectSpecFromTopic("夾克袖口發黑");
    expect(spec.noun).toMatch(/beige cotton work jacket/i);
    expect(spec.lockNote).toMatch(/not a down jacket/i);
  });

  it("locks 大衣 as a wool overcoat instead of the work-jacket fallback", () => {
    const spec = objectSpecFromTopic("大衣預檢");
    const passport = garmentPassportFromTopic("大衣預檢");
    expect(spec.noun).toMatch(/beige wool overcoat/i);
    expect(spec.noun).toMatch(/notch lapels/i);
    expect(spec.noun).not.toMatch(/work jacket/i);
    expect(spec.noun).not.toMatch(/everyday fabric jacket/i);
    expect(spec.material).toMatch(/beige wool coating/i);
    expect(spec.lockNote).toMatch(/not a down jacket/i);
    expect(spec.lockNote).toMatch(/not a work jacket/i);
    expect(spec.lockNote).toMatch(/not a dress shirt/i);
    expect(passport).toContain(spec.noun);
  });

  it("keeps named jacket families on their specific rows", () => {
    expect(objectSpecFromTopic("羽絨外套袖口發黑").noun).toMatch(/quilted down jacket/i);
    expect(objectSpecFromTopic("西裝外套肩線垮了").noun).toMatch(/navy wool suit jacket/i);
    expect(objectSpecFromTopic("西裝大衣預檢").noun).toMatch(/navy wool suit jacket/i);
  });

  it("mutation: down-jacket, suit-jacket, and wool-overcoat sit above the generic 外套 row", () => {
    const ids = OBJECT_SPEC_RULES.map((rule) => rule.id);
    const down = ids.indexOf("down-jacket");
    const suit = ids.indexOf("suit-jacket");
    const wool = ids.indexOf("wool-overcoat");
    const everyday = ids.indexOf("everyday-jacket");
    expect(down).toBeGreaterThanOrEqual(0);
    expect(suit).toBeGreaterThanOrEqual(0);
    expect(wool).toBeGreaterThanOrEqual(0);
    expect(everyday).toBeGreaterThan(down);
    expect(everyday).toBeGreaterThan(suit);
    expect(everyday).toBeGreaterThan(wool);
    const everydayRule = OBJECT_SPEC_RULES[everyday];
    expect(everydayRule?.match.test("羽絨外套袖口發黑")).toBe(true);
    expect(everydayRule?.match.test("西裝外套肩線垮了")).toBe(true);
  });
});
