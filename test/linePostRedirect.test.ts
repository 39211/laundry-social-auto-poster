import { describe, expect, it } from "vitest";
import { getConfig } from "../src/config";
import {
  buildDailyContent,
  linePostRedirectUrl,
  withLineContact,
  withSharedCaptionRules
} from "../src/contentPlan";
import { commentTextFor } from "../src/firstComment";
import { captionsFor } from "../src/scheduleReel";
import type { ReelConcept } from "../src/reelConcepts";

const config = getConfig();
const LINE_POST = linePostRedirectUrl();

const reelConcept: ReelConcept = {
  id: "test-line-post-reel",
  object_type: "shoes",
  hook: "麂皮鞋摸起來變硬",
  close: "麂皮鞋 400 起,不確定材質先拍給我。",
  narration: "絨毛倒了就會發硬發亮,那不是髒。",
  before_subject: "a tan suede shoe",
  after_subject: "the same shoe restored"
};

function lineUrlsIn(caption: string): string[] {
  return (caption.match(/https?:\/\/[^\s()]+/g) ?? []).filter((url) => url.includes("/go/line.html"));
}

function expectExactPostRedirect(caption: string, label: string, opts?: { allowBio?: boolean }): void {
  expect(caption, `${label} missing LINE post redirect`).toContain(LINE_POST);
  if (!opts?.allowBio) {
    expect(caption, `${label} still points at the profile`).not.toContain("點個人檔案連結");
  }
  const lineUrls = lineUrlsIn(caption);
  expect(lineUrls.length, `${label} has no go/line.html URL`).toBeGreaterThan(0);
  for (const url of lineUrls) {
    expect(url, `${label} stacked utm or drifted off source=post`).toBe(LINE_POST);
  }
}

describe("W-CAPLINE: every caption assembly carries a tappable source=post URL", () => {
  it("uses PUBLIC_SITE_BASE_URL and the exact source=post query", () => {
    expect(LINE_POST).toBe(`${config.publicSiteBaseUrl}/go/line.html?source=post`);
    expect(LINE_POST).toContain("source=post");
    expect(LINE_POST).not.toMatch(/utm_/);
  });

  it("playbook FB/IG captions (image + reel slots) include the URL", () => {
    const content = buildDailyContent("2026-08-18", config);
    expect(content.slots.length).toBeGreaterThanOrEqual(2);
    for (const slot of content.slots) {
      expectExactPostRedirect(slot.facebook_caption, `2026-08-18 slot ${slot.slot} facebook`);
      expectExactPostRedirect(slot.instagram_caption, `2026-08-18 slot ${slot.slot} instagram`);
    }
  });

  it("legacy-template captions include the URL", () => {
    const content = buildDailyContent("2026-07-01", config);
    for (const slot of content.slots) {
      expectExactPostRedirect(slot.facebook_caption, `template slot ${slot.slot} facebook`);
      expectExactPostRedirect(slot.instagram_caption, `template slot ${slot.slot} instagram`);
    }
  });

  it("Reel captionsFor FB/IG include the URL", () => {
    const captions = captionsFor(reelConcept, 0, "2026-08-18");
    expectExactPostRedirect(captions.facebook, "reel facebook");
    expectExactPostRedirect(captions.instagram, "reel instagram");
  });

  it("withLineContact inserts the URL into an 8/15-style bio-only caption", () => {
    const bioOnly =
      "帆布鞋鞋口被擋住時，先別只拍鞋面。\n\n拍鞋子全貌、鞋口與鞋底，點個人檔案連結加 LINE 先詢問。\n\n#私享家洗衣店 #帆布鞋照護 #台中洗鞋";
    const patched = withLineContact(bioOnly);
    expectExactPostRedirect(patched, "8/15-style insert", { allowBio: true });
    expect(patched).toContain("0968327653");
  });

  it("withSharedCaptionRules is the insertion the assemblers call; stripping it drops the URL", () => {
    const bare = "麂皮鞋摸起來變硬。\n\n拍一張傳 LINE給我們。\n\n#私享家洗衣店 #台中洗鞋";
    const wired = withSharedCaptionRules(bare, "麂皮鞋摸起來變硬");
    expectExactPostRedirect(wired, "shared rules");
    expect(bare.includes(LINE_POST), "bare input must not already carry the URL").toBe(false);
  });
});

describe("W-CAPLINE mutation 1: 拔插入 → 紅", () => {
  it("組稿輸出含該 URL;拔插入後的成品不含", () => {
    const content = buildDailyContent("2026-08-18", config);
    const slot = content.slots[0]!;
    expect(slot.facebook_caption).toContain(LINE_POST);
    expect(slot.instagram_caption).toContain(LINE_POST);

    const strippedFb = slot.facebook_caption.replace(LINE_POST, "");
    const strippedIg = slot.instagram_caption.replace(LINE_POST, "");
    expect(strippedFb.includes(LINE_POST)).toBe(false);
    expect(strippedIg.includes(LINE_POST)).toBe(false);
    expect(strippedFb.includes("/go/line.html?source=post")).toBe(false);
  });
});

describe("W-CAPLINE mutation 2: source=post 精確參數;改成 bio 字樣 → 紅", () => {
  it("URL 帶 source=post;改成 bio 字樣後不再命中", () => {
    const content = buildDailyContent("2026-08-18", config);
    const caption = content.slots[0]!.facebook_caption;
    expect(caption).toContain("/go/line.html?source=post");
    expect(caption).not.toContain("點個人檔案連結");

    const asBio = caption
      .replace(LINE_POST, "點個人檔案連結")
      .replace(/\/go\/line\.html\?source=post/g, "點個人檔案連結");
    expect(asBio.includes("/go/line.html?source=post")).toBe(false);
    expect(asBio).toContain("點個人檔案連結");
    expect(caption.includes(LINE_POST) && asBio.includes(LINE_POST)).toBe(false);
  });
});

describe("W-CAPLINE mutation 3: 頭香 source=ig-comment 回歸", () => {
  it("firstComment 維持 source=ig-comment,不得改成 source=post", () => {
    const text = commentTextFor("白鞋泛黃", "2026-08-18", 1);
    expect(text).toContain("/go/line.html?source=ig-comment");
    expect(text).not.toMatch(/\/go\/line\.html\?source=post(?:&|\)|$)/);
    expect(text).toContain("0968327653");
  });
});
