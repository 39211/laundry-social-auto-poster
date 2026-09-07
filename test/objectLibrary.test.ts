import { describe, expect, it } from "vitest";
import { buildCarouselImagePrompts, garmentPassportFromTopic, objectSpecFromTopic } from "../src/contentPlan";
import { materialOptics, objectFamily } from "../src/imageDoctrine";
import {
  BAG_VARIANTS,
  LUXURY_RULES,
  NO_MARK_CLAUSE,
  SHOE_VARIANTS,
  everydayVariantForTopic,
  luxuryVariantForTopic,
  variantForDate
} from "../src/objectLibrary";

describe("luxury classics resolve by brand or model word, described by shape not letters", () => {
  it("maps the owner's named classics", () => {
    expect(luxuryVariantForTopic("香奈兒雙色鞋包頭起毛先看羅緞")?.id).toBe("two-tone-slingback");
    expect(luxuryVariantForTopic("香奈兒芭蕾平底鞋鞋頭磨白")?.id).toBe("two-tone-ballet-flats");
    expect(luxuryVariantForTopic("香奈兒菱格包鏈帶與邊角")?.id).toBe("quilted-chain-flap-bag");
    expect(luxuryVariantForTopic("愛馬仕涼鞋鞋床腳印與邊油")?.id).toBe("h-cutout-slide-sandals");
    expect(luxuryVariantForTopic("愛馬仕包提把手汗與底角")?.id).toBe("belted-top-handle-bag");
    expect(luxuryVariantForTopic("Gucci 馬銜釦樂福鞋面折痕")?.id).toBe("horsebit-loafers");
    expect(luxuryVariantForTopic("風衣領口袖口油痕與腰帶")?.id).toBe("gabardine-trench");
    expect(luxuryVariantForTopic("髒髒鞋真髒與做舊怎麼分")?.id).toBe("distressed-star-sneakers");
    expect(luxuryVariantForTopic("喀什米爾毛衣起球與腋下")?.id).toBe("cashmere-sweater");
    expect(luxuryVariantForTopic("白鞋鞋邊泛灰前的檢查")).toBeUndefined();
  });

  it("never spells a brand and every shoe/bag passport declares blank surfaces", () => {
    for (const { variant } of LUXURY_RULES) {
      const blob = `${variant.noun} ${variant.material} ${variant.lockNote}`;
      expect(blob).not.toMatch(/chanel|herm[eè]s|gucci|dior|vuitton|burberry|moncler|ugg|golden goose|\bLV\b|\bCC\b/i);
      if (variant.family === "shoe") expect(variant.lockNote).toContain(NO_MARK_CLAUSE);
      if (variant.family === "bag") expect(variant.lockNote).toMatch(/no printed or embossed letters/);
    }
  });

  it("luxury passports flow through objectSpecFromTopic regardless of date and pick the right optics", () => {
    const spec = objectSpecFromTopic("香奈兒雙色鞋包頭起毛先看羅緞");
    expect(spec.noun).toMatch(/grosgrain toe caps/);
    expect(spec.wear).toMatch(/frayed grosgrain/);
    expect(materialOptics(spec)).toMatch(/ribbed texture/);
    expect(objectFamily(spec)).toBe("shoe");
    const bag = objectSpecFromTopic("香奈兒菱格包鏈帶與邊角");
    expect(materialOptics(bag)).toMatch(/quilted valleys/);
    expect(objectFamily(bag)).toBe("bag");
    const trench = objectSpecFromTopic("風衣領口袖口油痕與腰帶");
    expect(materialOptics(trench)).toMatch(/diagonal twill/);
    expect(objectFamily(trench)).toBe("garment");
  });
});

describe("everyday variety rotates by date for generic topics only", () => {
  it("generic 球鞋 gets a different concrete shoe on different days, stable for the same day", () => {
    const a = everydayVariantForTopic("球鞋鞋底邊緣的灰", "2026-09-11");
    const b = everydayVariantForTopic("球鞋鞋底邊緣的灰", "2026-09-12");
    const c = everydayVariantForTopic("球鞋鞋底邊緣的灰", "2026-09-11");
    expect(a).toBeDefined();
    expect(a!.id).not.toBe(b!.id);
    expect(a!.id).toBe(c!.id);
    expect(SHOE_VARIANTS.map((v) => v.id)).toContain(a!.id);
  });

  it("specific shoe topics keep their fixed passport (麂皮/童鞋/白鞋/帆布 are not rotated)", () => {
    for (const topic of ["麂皮鞋淋雨後", "童鞋鞋墊臭", "白鞋鞋邊泛灰", "帆布鞋泥灰卡進織紋"]) {
      expect(everydayVariantForTopic(topic, "2026-09-11")).toBeUndefined();
    }
  });

  it("without a date, or before the doctrine start, the legacy passport is unchanged", () => {
    const legacy = objectSpecFromTopic("球鞋鞋底邊緣的灰");
    expect(legacy.material).toBe("grey-and-white running shoes");
    expect(objectSpecFromTopic("球鞋鞋底邊緣的灰", "2026-09-08").material).toBe("grey-and-white running shoes");
    const rotated = objectSpecFromTopic("球鞋鞋底邊緣的灰", "2026-09-11");
    expect(rotated.material).not.toBe("grey-and-white running shoes");
    expect(rotated.lockNote).toContain(NO_MARK_CLAUSE);
  });

  it("shirts, tees, jackets and bags rotate too, and the carousel passport carries the variant", () => {
    expect(everydayVariantForTopic("襯衫領口發黃", "2026-09-11")?.family).toBe("garment");
    expect(everydayVariantForTopic("T恤印花龜裂", "2026-09-11")?.id).toMatch(/tee/);
    expect(everydayVariantForTopic("外套領口袖口的日常油痕", "2026-09-11")?.family).toBe("garment");
    expect(everydayVariantForTopic("背包底部磨損", "2026-09-11")?.family).toBe("bag");
    expect(everydayVariantForTopic("羽絨外套塌了", "2026-09-11")).toBeUndefined();
    const days = ["2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"];
    const ids = new Set(days.map((d) => variantForDate(BAG_VARIANTS, d, 5).id));
    expect(ids.size).toBe(BAG_VARIANTS.length);
    const passport = garmentPassportFromTopic("襯衫領口發黃", "2026-09-11");
    expect(passport).toMatch(/oxford|poplin|striped/);
    const prompts = buildCarouselImagePrompts({ date: "2026-09-11", slot: 1, topic: "襯衫領口發黃", caption: "" });
    for (const p of prompts) expect(p).toContain(passport);
  });
});
