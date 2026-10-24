import { describe, expect, it } from "vitest";
import {
  SAME_GARMENT_CONTINUITY,
  buildCarouselImagePrompts,
  garmentPassportFromTopic,
  objectSpecFromTopic
} from "../src/contentPlan";
import {
  IMAGE_DOCTRINE_START_DATE,
  buildDoctrinePrompts,
  compositionBlock,
  imageDoctrineActive,
  materialOptics,
  objectFamily,
  needsOpening,
  sceneStationForDate,
  slideSpot,
  wearMechanism
} from "../src/imageDoctrine";

const LEGACY_TAIL = "no boutique or showroom interior, no stock-photo feel";
const kidsTopic = "開學一週童鞋就臭了？先看鞋墊、鞋口、鞋帶 3 個位置";
const caption = "先看鞋墊，再看鞋口，最後看鞋帶孔。";

describe("doctrine date gate", () => {
  it("is off before the start date and on from it", () => {
    expect(IMAGE_DOCTRINE_START_DATE).toBe("2026-09-09");
    expect(imageDoctrineActive("2026-09-08")).toBe(false);
    expect(imageDoctrineActive("2026-09-09")).toBe(true);
  });

  it("2026-09-08 keeps the legacy prompt byte-for-byte shape (stamped calendars stay valid)", () => {
    const prompts = buildCarouselImagePrompts({ date: "2026-09-08", slot: 1, topic: kidsTopic, caption });
    expect(prompts[0]).toContain(LEGACY_TAIL);
    expect(prompts[0]).not.toContain("MATERIAL OPTICS:");
    expect(prompts[0]).toContain("filling roughly 35-50%");
  });

  it("2026-09-09 emits the seven-segment prompt and drops the fixed negative tail", () => {
    const prompts = buildCarouselImagePrompts({ date: "2026-09-09", slot: 1, topic: kidsTopic, caption });
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).not.toContain(LEGACY_TAIL);
      expect(prompt).toContain(garmentPassportFromTopic(kidsTopic));
      expect(prompt).toContain("SCENE LOCK:");
      expect(prompt).toContain(sceneStationForDate("2026-09-09").location);
      expect(prompt).toContain("MATERIAL OPTICS:");
      expect(prompt).toContain("WEAR FIRST");
      for (const seg of ["LOCATION:", "COMPOSITION", "LIGHTING:", "STYLE:", "CAMERA:", "COLOR:", "Avoid:"]) {
        expect(prompt).toContain(seg);
      }
    }
    expect(prompts[0]).toContain("Photo 1 of 4.");
    expect(prompts[0]).not.toContain(SAME_GARMENT_CONTINUITY);
    for (const later of prompts.slice(1)) expect(later).toContain(SAME_GARMENT_CONTINUITY);
  });

  it("promo (scene-lock-only) topics keep the legacy prompt even after the start date", () => {
    const prompts = buildCarouselImagePrompts({ date: "2026-09-12", slot: 1, topic: "私享家海報：台中全區免費收送" });
    expect(prompts[0]).not.toContain("MATERIAL OPTICS:");
    expect(prompts[0]).toMatch(/scene-lock only/);
  });
});

describe("material optics and wear mechanism", () => {
  it("picks the optics text from the passport material, most specific row first", () => {
    expect(materialOptics(objectSpecFromTopic("麂皮鞋淋雨後絨毛倒了"))).toMatch(/suede nap/);
    expect(materialOptics(objectSpecFromTopic(kidsTopic))).toMatch(/foam midsole is chalky matte/);
    expect(materialOptics(objectSpecFromTopic("室內鞋一季沒洗"))).toMatch(/knit-mesh upper/);
    expect(materialOptics(objectSpecFromTopic("襯衫領口發黃"))).toMatch(/collar ring/);
    expect(materialOptics(objectSpecFromTopic("包角磨白怎麼辦"))).toMatch(/finish worn through/);
    expect(materialOptics(objectSpecFromTopic("羽絨外套塌了"))).toMatch(/nylon shell/);
    expect(materialOptics(objectSpecFromTopic("窗簾多久沒洗了？拆下來前先看下緣、掛勾、褶線 3 個位置"))).toMatch(/curtain fabric/);
  });

  it("writes wear as a mechanism at the named spots, and names the mechanism per kind", () => {
    const sweat = wearMechanism("sweat residue", ["insole", "shoe opening"], "fallback");
    expect(sweat).toMatch(/^WEAR FIRST/);
    expect(sweat).toMatch(/tide line/);
    expect(sweat).toContain("at the insole and shoe opening");
    expect(sweat).toMatch(/25-40% of that area/);
    const yellow = wearMechanism("yellowing", [], "collar and underarm yellowing");
    expect(yellow).toMatch(/warm-yellow band/);
    expect(yellow).toContain("(collar and underarm yellowing)");
    expect(wearMechanism("unknown-kind", [], "x")).toMatch(/grey dust in the texture valleys/);
  });

  it("odour topics map to the sweat/odour mechanism and 3 個位置 with a space still yields checkpoint slides", () => {
    const prompts = buildCarouselImagePrompts({ date: "2026-09-09", slot: 1, topic: kidsTopic, caption: "" });
    expect(prompts[0]).toMatch(/WEAR FIRST \(this is the story of the photo\): sweat and odour residue/);
    expect(prompts[0]).toMatch(/at the laces and insole and shoe opening|at the insole and shoe opening and laces/);
    expect(prompts[0]).toMatch(/the item is opened toward the camera/);
    expect(prompts[1]).toContain("checkpoint 1:");
    const curtain = buildCarouselImagePrompts({ date: "2026-09-10", slot: 1, topic: "窗簾多久沒洗了？拆下來前先看下緣、掛勾、褶線 3 個位置", caption: "" });
    expect(curtain[0]).toMatch(/curtain panel/);
    expect(curtain[0]).toMatch(/at the hem and hook header and pleat lines/);
    expect(curtain[1]).toContain("checkpoint 1: hem edge.");
    expect(curtain[2]).toContain("checkpoint 2: hook header.");
    expect(curtain[3]).toContain("checkpoint 3: pleat lines.");
  });

  it("the 9/9 kids-shoe prompt carries mesh optics and the sweat mechanism at the named spots", () => {
    const prompts = buildCarouselImagePrompts({ date: "2026-09-09", slot: 1, topic: kidsTopic, caption });
    expect(prompts[0]).toMatch(/engineered mesh scatters light/);
    expect(prompts[0]).toMatch(/WEAR FIRST .*sweat and odour residue/);
    expect(prompts[0]).toMatch(/insole and shoe opening/);
    expect(prompts[0]!.indexOf("WEAR FIRST")).toBeLessThan(prompts[0]!.indexOf("MATERIAL OPTICS"));
  });
});

describe("per-slide composition and lens", () => {
  it("hero crops to the problem half with one hand and a tool; checkpoint slides go macro on the named spot", () => {
    const hero = compositionBlock(1, undefined, false, "a worn horsehair shoe brush");
    expect(hero).toMatch(/crop allowed.*60-75% of the frame height/);
    expect(hero).toMatch(/one adult hand entering from the frame edge, wrist only/);
    expect(hero).toContain("a worn horsehair shoe brush rests at the frame edge");
    expect(compositionBlock(1, undefined, true)).toMatch(/opened toward the camera/);
    expect(hero).not.toMatch(/opened toward the camera/);
    expect(compositionBlock(2, "insole")).toMatch(/macro framing on the insole/);
    expect(compositionBlock(4)).toMatch(/compare directly/);
    expect(needsOpening(["insole"], "")).toBe(true);
    expect(needsOpening(["hem"], "dust at the hem")).toBe(false);
  });

  it("scene stations rotate by date, and all four slides of one day share one station", () => {
    const days = ["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"];
    expect(new Set(days.map((d) => sceneStationForDate(d).id)).size).toBe(4);
    expect(sceneStationForDate("2026-09-13").id).toBe(sceneStationForDate("2026-09-09").id);
    const prompts = buildCarouselImagePrompts({ date: "2026-09-10", slot: 1, topic: "窗簾多久沒洗了？拆下來前先看下緣、掛勾、褶線 3 個位置", caption: "" });
    const station = sceneStationForDate("2026-09-10");
    for (const p of prompts) {
      expect(p).toContain(station.lock);
      expect(p).toContain(station.location);
    }
    const mats = days.filter((d) => /pink self-healing cutting mat/.test(sceneStationForDate(d).location));
    expect(mats).toHaveLength(1);
    expect(sceneStationForDate(mats[0]!).location).toMatch(/less than a fifth of the frame/);
  });

  it("reads the checkpoint spot out of the brief and uses the close-focus lens for it", () => {
    expect(slideSpot("Close-up of checkpoint 2: toe box. Keep the rest of the same item recognizable at the frame edge.")).toBe("toe box");
    expect(slideSpot("Overall closer look at the complete passport item.")).toBeUndefined();
    const prompts = buildCarouselImagePrompts({ date: "2026-09-09", slot: 1, topic: kidsTopic, caption });
    expect(prompts[1]).toMatch(/COMPOSITION: macro framing on the insole/);
    expect(prompts[1]).toMatch(/CAMERA: phone close-focus at about 50mm-equivalent/);
    expect(prompts[0]).toMatch(/CAMERA: phone main camera, 26mm-equivalent, held from the worker's standing eye line/);
  });

  it("negatives are per object family, three to four items, not the legacy tail", () => {
    const shoe = buildDoctrinePrompts({
      date: "2026-09-09",
      spec: objectSpecFromTopic(kidsTopic),
      wearKind: "sweat residue",
      spots: ["insole"],
      passport: "P",
      briefs: ["b1", "b2", "b3", "b4"],
      sameGarment: "same"
    });
    expect(shoe[0]).toMatch(/Avoid: brand logos or logo-like marks, a second pair/);
    expect(shoe[0]).toMatch(/a second hand\.$/);
    expect(objectFamily(objectSpecFromTopic("襯衫領口發黃"))).toBe("garment");
    expect(objectFamily(objectSpecFromTopic("包角磨白"))).toBe("bag");
    expect(objectFamily(objectSpecFromTopic("棉被有汗味"))).toBe("bedding");
    expect(objectFamily(objectSpecFromTopic("領帶一季沒洗會怎樣？先看領結和尖端這 2 個位置"))).toBe("garment");
    expect(materialOptics(objectSpecFromTopic("領帶一季沒洗會怎樣？先看領結和尖端這 2 個位置"))).toMatch(/silk twill/);
  });
});
