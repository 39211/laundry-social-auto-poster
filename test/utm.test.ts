import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import { buildDailyContent, buildGbpPostCaption, linePostRedirectUrl } from "../src/contentPlan";
import { buildShortMetadata, guideLinkFor } from "../src/postYouTube";
import { utmCampaign, utmTagged } from "../src/utm";

const config = getConfig({
  ...process.env,
  DRY_RUN: "true",
  PUBLIC_IMAGE_BASE_URL: "https://tester.github.io/laundry-social-auto-poster"
});

const LINE_POST = linePostRedirectUrl();

function hasUtmTrio(text: string, source: string, campaign: string): boolean {
  return (
    text.includes(`utm_source=${source}`) &&
    text.includes("utm_medium=social") &&
    text.includes(`utm_campaign=${campaign}`)
  );
}

function stripUtm(text: string): string {
  return text.replace(/[?&]utm_[^=]+=[^&\s)]+/g, "").replace(/\?&/, "?").replace(/\?$/, "");
}

function expectedCampaign(date: string, slot: { slot: number; format?: string }): string {
  return slot.format === "reel" ? `${date}-reel` : `${date}-slot${slot.slot}`;
}

describe("utmTagged", () => {
  it("writes the three utm keys and keeps an existing query", () => {
    const tagged = utmTagged(`${LINE_POST}&keep=yes`, {
      source: "facebook",
      campaign: "2026-08-17-slot1"
    });
    expect(tagged).toContain("source=post");
    expect(tagged).toContain("keep=yes");
    expect(hasUtmTrio(tagged, "facebook", "2026-08-17-slot1")).toBe(true);
  });

  it("does not stack utm params onto a URL that already has one", () => {
    const once = utmTagged(LINE_POST, { source: "facebook", campaign: "2026-08-17-slot1" });
    const twice = utmTagged(once, { source: "instagram", campaign: "2026-08-17-slot2" });
    expect(twice).toBe(once);
    expect(twice.match(/utm_source=/g)).toHaveLength(1);
  });

  it("rejects a relative URL", () => {
    expect(() => utmTagged("/go/line.html?source=post", { source: "facebook", campaign: "x" })).toThrow(
      /absolute URL/
    );
  });
});

describe("utmCampaign", () => {
  it("puts the slot number into feed campaigns and uses -reel for reels", () => {
    expect(utmCampaign("2026-08-17", 1)).toBe("2026-08-17-slot1");
    expect(utmCampaign("2026-08-17", 2, "slot")).toBe("2026-08-17-slot2");
    expect(utmCampaign("2026-08-17", 2, "reel")).toBe("2026-08-17-reel");
  });
});

describe("composition wiring", () => {
  it("puts the LINE redirect in FB and IG captions without stacking utm", () => {
    const date = "2026-08-17";
    const content = buildDailyContent(date, config);
    expect(content.slots.length).toBeGreaterThanOrEqual(2);
    for (const slot of content.slots.filter((item) => item.slot <= 2)) {
      expect(slot.facebook_caption).toContain(LINE_POST);
      expect(slot.instagram_caption).toContain(LINE_POST);
      expect(slot.facebook_caption).toContain("source=post");
      expect(slot.instagram_caption).toContain("source=post");
      expect(hasUtmTrio(slot.facebook_caption, "facebook", expectedCampaign(date, slot))).toBe(false);
      expect(hasUtmTrio(slot.instagram_caption, "instagram", expectedCampaign(date, slot))).toBe(false);
    }
  });

  it("tags the YouTube LINE link and the topic deep link", () => {
    const date = "2026-08-14";
    const topic = "白鞋鞋邊泛灰";
    const { description } = buildShortMetadata({
      topic,
      caption: "hook\n\nbody",
      date,
      slot: 2
    });
    const campaign = utmCampaign(date, 2, "reel");
    expect(hasUtmTrio(description, "youtube", campaign)).toBe(true);
    expect(description).toContain("source=yt");
    const guide = utmTagged(guideLinkFor(topic), { source: "youtube", campaign });
    expect(description).toContain(guide);
    expect(guideLinkFor(topic)).toBe("https://39211.github.io/guides/white-shoe-yellowing.html");
  });

  it("tags the GBP composition helper", () => {
    const caption = buildGbpPostCaption({ date: "2026-08-17", body: "本週白鞋檢查", slot: 1 });
    expect(hasUtmTrio(caption, "gbp", "2026-08-17-slot1")).toBe(true);
    expect(caption).toContain("source=gbp");
  });
});

describe("mutation 1: strip the LINE post redirect and the composition contract fails", () => {
  it("組稿輸出含 source=post 轉導鏈;拔掉 → 紅", () => {
    const date = "2026-08-17";
    const content = buildDailyContent(date, config);
    const slot = content.slots[0]!;
    expect(slot.facebook_caption).toContain(LINE_POST);
    expect(slot.instagram_caption).toContain(LINE_POST);

    const strippedFb = slot.facebook_caption.replaceAll(LINE_POST, "");
    expect(strippedFb).not.toContain(LINE_POST);
    expect(strippedFb.includes("source=post")).toBe(false);
  });
});

describe("mutation 2: existing query must survive", () => {
  it("既有 query 與 utm 共存;蓋掉既有 query → 紅", () => {
    const url = `${LINE_POST}&keep=yes`;
    const tagged = utmTagged(url, { source: "facebook", campaign: "2026-08-17-slot1" });
    expect(tagged).toContain("source=post");
    expect(tagged).toContain("keep=yes");
    expect(hasUtmTrio(tagged, "facebook", "2026-08-17-slot1")).toBe(true);

    const overwritten = `${url.split("?")[0]}?utm_source=facebook&utm_medium=social&utm_campaign=2026-08-17-slot1`;
    expect(overwritten.includes("source=post")).toBe(false);
    expect(overwritten.includes("keep=yes")).toBe(false);
    expect(tagged.includes("source=post") && overwritten.includes("source=post")).toBe(false);
  });
});

describe("mutation 3: campaign carries the live date and slot", () => {
  it("slot 編號進 campaign;寫死日期 → 紅", () => {
    const dateA = "2026-08-10";
    const dateB = "2026-08-12";
    const a = buildDailyContent(dateA, config);
    const b = buildDailyContent(dateB, config);
    const slotA1 = a.slots.find((item) => item.slot === 1)!;
    const slotA2 = a.slots.find((item) => item.slot === 2);
    const slotB1 = b.slots.find((item) => item.slot === 1)!;

    const campaignA1 = expectedCampaign(dateA, slotA1);
    const campaignB1 = expectedCampaign(dateB, slotB1);
    expect(slotA1.facebook_caption).toContain(LINE_POST);
    expect(slotB1.facebook_caption).toContain(LINE_POST);
    expect(campaignA1).not.toBe(campaignB1);
    expect(slotA1.facebook_caption).not.toContain("utm_campaign=");
    expect(slotB1.facebook_caption).not.toContain("utm_campaign=");

    if (slotA2 && slotA2.format !== "reel" && slotA1.format !== "reel") {
      expect(slotA1.facebook_caption).toContain(LINE_POST);
      expect(slotA2.facebook_caption).toContain(LINE_POST);
    }

    const reelDay = buildDailyContent("2026-07-16", config);
    const reel = reelDay.slots.find((item) => item.format === "reel");
    expect(reel, "2026-07-16 slot 2 is a playbook reel").toBeDefined();
    expect(reel!.facebook_caption).toContain(LINE_POST);
    expect(reel!.facebook_caption).not.toContain("utm_campaign=2026-07-16-slot2");
  });
});
