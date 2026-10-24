import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBJECT_SPEC_RULES,
  garmentPassportFromTopic,
  objectSpecFromTopic,
  wearKindFromTopic
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

const TIE_TOPIC = "領帶一季沒洗會怎樣？先看領結和尖端這 2 個位置";

describe("F20 fish-2 remaining generic clothing families have concrete default styles", () => {
  it("locks a 領帶 topic as a navy silk necktie, not the generic laundry-item fallback", () => {
    const spec = objectSpecFromTopic(TIE_TOPIC);
    const passport = garmentPassportFromTopic(TIE_TOPIC);
    expect(spec.noun).toMatch(/navy silk twill necktie/i);
    expect(spec.noun).toMatch(/pointed blade/i);
    expect(spec.noun).toMatch(/keeper loop/i);
    expect(spec.material).toMatch(/navy silk twill/i);
    expect(spec.lockNote).toMatch(/not a dress shirt/i);
    expect(spec.lockNote).toMatch(/not a suit jacket/i);
    expect(spec.wear).toMatch(/knot/i);
    expect(spec.wear).toMatch(/blade tip/i);
    expect(spec.noun).not.toMatch(/complete worn laundry item/i);
    expect(passport).toContain(spec.noun);
    expect(passport).not.toMatch(/complete worn laundry item/i);
  });

  it("locks 運動衣, T恤, 棉麻衣物, and a bare 衣物 topic to a specific garment, not a category word", () => {
    const athletic = objectSpecFromTopic("運動衣汗味與彈性纖維");
    expect(athletic.noun).toMatch(/navy polyester athletic tee/i);
    expect(athletic.noun).toMatch(/mesh underarm/i);
    expect(athletic.lockNote).toMatch(/not a cotton dress shirt/i);
    expect(athletic.noun).not.toMatch(/complete worn laundry item/i);

    const tee = objectSpecFromTopic("T恤領口油汗");
    expect(tee.noun).toMatch(/navy cotton crew-neck tee/i);
    expect(tee.lockNote).toMatch(/not a dress shirt/i);
    expect(tee.noun).not.toMatch(/complete worn laundry item/i);

    const linen = objectSpecFromTopic("夏季棉麻衣物的汗味殘留");
    expect(linen.noun).toMatch(/linen short-sleeve shirt/i);
    expect(linen.noun).toMatch(/camp collar/i);
    expect(linen.lockNote).toMatch(/not a dress shirt/i);
    expect(linen.noun).not.toMatch(/complete worn laundry item/i);

    const clothing = objectSpecFromTopic("衣物領口袖口的汗味");
    expect(clothing.noun).toMatch(/navy cotton crew-neck tee/i);
    expect(clothing.lockNote).toMatch(/not a mixed pile of garments/i);
    expect(clothing.noun).not.toMatch(/complete worn laundry item/i);

    const luxuryGarment = objectSpecFromTopic("精品衣物洗標與飾件的送洗前判斷");
    expect(luxuryGarment.noun).toMatch(/navy cotton crew-neck tee/i);
    expect(luxuryGarment.noun).not.toMatch(/designer leather sneakers/i);
    expect(luxuryGarment.noun).not.toMatch(/complete worn laundry item/i);
  });

  it("does not steal more specific garment rows", () => {
    expect(objectSpecFromTopic("深色衣服洗久變灰的判斷").noun).toMatch(/dark cotton tee/i);
    expect(objectSpecFromTopic("白襯衫領口與腋下泛黃").noun).toMatch(/white cotton dress shirt/i);
    expect(objectSpecFromTopic("先看懂：外套領口的皮脂痕跡").noun).toMatch(/beige cotton work jacket/i);
    expect(objectSpecFromTopic("精品名牌鞋護理").noun).toMatch(/designer leather sneakers/i);
  });

  it("mutation: dropping the necktie row would send 領帶 to the generic laundry-item fallback", () => {
    const necktie = OBJECT_SPEC_RULES.find((rule) => rule.id === "necktie");
    expect(necktie).toBeTruthy();
    expect(necktie!.match.test(TIE_TOPIC)).toBe(true);
    const idx = OBJECT_SPEC_RULES.findIndex((rule) => rule.id === "necktie");
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const rule of OBJECT_SPEC_RULES.slice(0, idx)) {
      expect(rule.match.test(TIE_TOPIC), rule.id).toBe(false);
    }
    const clothing = OBJECT_SPEC_RULES.find((rule) => rule.id === "generic-clothing");
    expect(clothing).toBeTruthy();
    expect(clothing!.match.test(TIE_TOPIC)).toBe(false);
  });

  it("mutation: linen and athletic rows sit above generic 衣物 so 棉麻衣物 and 運動衣 do not become the tee default", () => {
    const ids = OBJECT_SPEC_RULES.map((rule) => rule.id);
    const linen = ids.indexOf("linen-shirt");
    const athletic = ids.indexOf("athletic-tee");
    const clothing = ids.indexOf("generic-clothing");
    expect(linen).toBeGreaterThanOrEqual(0);
    expect(athletic).toBeGreaterThanOrEqual(0);
    expect(clothing).toBeGreaterThan(linen);
    expect(clothing).toBeGreaterThan(athletic);
    const clothingRule = OBJECT_SPEC_RULES[clothing];
    expect(clothingRule?.match.test("夏季棉麻衣物的汗味殘留")).toBe(true);
    expect(clothingRule?.match.test("健身房衣物不要悶在包裡")).toBe(true);
    expect(clothingRule?.match.test("運動衣汗味與彈性纖維")).toBe(false);
  });
});

// 2026-09-10: four of the five days in the D+1..D+4 window failed the carousel
// judge on OBJECT_IDENTITY or TOPIC_MATCH. Two of those were this table:
// 抱枕 and 枕頭 fell into the bedding row because its match carried a bare 枕,
// and 沙發 matched nothing at all so the generator drew a different garment on
// every slide.
describe("soft furnishings resolve to themselves, not to the duvet", () => {
  const idOf = (topic: string) => OBJECT_SPEC_RULES.find((rule) => rule.match.test(topic))?.id;

  it("抱枕 is a throw cushion and never the folded duvet", () => {
    const spec = objectSpecFromTopic("抱枕上的飲料痕，乾了以後才變黃", "2026-09-14");
    expect(spec.noun).toContain("throw cushion");
    expect(spec.noun).not.toContain("duvet");
    expect(spec.lockNote).toContain("not a duvet");
  });

  it("枕頭 is a bed pillow and never the folded duvet", () => {
    const spec = objectSpecFromTopic("枕頭那片黃是汗還是霉？聞、摸、翻 3 個動作先分清", "2026-09-12");
    expect(spec.noun).toContain("bed pillow");
    expect(spec.noun).not.toContain("duvet");
  });

  it("沙發 resolves to a seat-cushion cover instead of the untyped fallback", () => {
    const spec = objectSpecFromTopic("沙發布面坐出油光還能洗嗎？先看是可拆套還是固定布", "2026-09-11");
    expect(spec.noun).toContain("sofa seat-cushion cover");
    expect(spec.noun).not.toContain("complete worn laundry item");
    // The 2026-09-11 failure was slides 2-4 drawing shirts and tees.
    expect(spec.lockNote).toContain("not a shirt");
  });

  it("棉被 still resolves to the duvet", () => {
    expect(objectSpecFromTopic("棉被收進櫃子前，悶味來自沒散掉的濕氣", "2026-09-13").noun).toContain(
      "duvet cover"
    );
  });

  it("mutation: the bedding row must not match 抱枕 or 枕頭 on its own", () => {
    const bedding = OBJECT_SPEC_RULES.find((rule) => rule.id === "bedding");
    expect(bedding).toBeTruthy();
    expect(bedding!.match.test("抱枕上的飲料痕")).toBe(false);
    expect(bedding!.match.test("枕頭那片黃是汗還是霉")).toBe(false);
    expect(bedding!.match.test("棉被收進櫃子前")).toBe(true);
  });

  it("mutation: cushion and pillow rows sit above bedding, so ordering alone cannot regress this", () => {
    const ids = OBJECT_SPEC_RULES.map((rule) => rule.id);
    const bedding = ids.indexOf("bedding");
    expect(ids.indexOf("cushion")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("cushion")).toBeLessThan(bedding);
    expect(ids.indexOf("pillow")).toBeLessThan(bedding);
    expect(idOf("抱枕上的飲料痕")).toBe("cushion");
    expect(idOf("枕頭那片黃")).toBe("pillow");
  });
});

// The picture has to show the damage the headline promised. Before this, a
// topic that named the damage but no place on the object lost to the object
// row's own wearFallback: 「抱枕上的飲料痕」 was drawn as "sleep odor and
// trapped moisture in the thickest channel".
describe("wear named by the topic outranks the object row's fallback", () => {
  it("飲料痕 becomes a drink stain, not the object's stock wear", () => {
    const bedding = OBJECT_SPEC_RULES.find((rule) => rule.id === "bedding")!;
    const wear = objectSpecFromTopic("抱枕上的飲料痕，乾了以後才變黃", "2026-09-14").wear;
    expect(wear).toContain("drink stain");
    expect(wear).not.toBe(bedding.wearFallback);
  });

  it("變黃 counts as yellowing (發黃/泛黃 alone matched none of the captions)", () => {
    expect(wearKindFromTopic("乾了以後才變黃")).toBe("yellowing");
  });

  it("a row whose fallback already names that damage keeps its location detail", () => {
    // The first version of this rule replaced the fallback whenever the topic
    // named any damage, which shrank 深色衣服洗久變灰 from "sun-faded grey along
    // the shoulder line and both side seams" down to "sun-faded grey" and took
    // the only place-on-the-object information out of the prompt.
    const spec = objectSpecFromTopic("可收藏:深色衣服洗久變灰的判斷,送洗前先看三個位置", "2026-09-14");
    expect(spec.wear).toContain("sun-faded grey");
    expect(spec.wear).toContain("shoulder line");
  });

  it("a topic that names no damage still falls back to the object's own wear", () => {
    const spec = objectSpecFromTopic("民宿床組一週要換幾輪？批量送洗前先數這 3 件事", "2026-09-09");
    const bedding = OBJECT_SPEC_RULES.find((rule) => rule.id === "bedding")!;
    expect(spec.wear).toBe(bedding.wearFallback);
  });

  it("a topic that names a place still pins the damage to that place", () => {
    expect(objectSpecFromTopic("大衣入秋前要不要先送洗？先翻領口、袖口、腋下 3 個位置", "2026-09-13").wear).toBe(
      "honest everyday wear at the collar and cuffs and underarms"
    );
  });
});
