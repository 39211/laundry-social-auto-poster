import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

// 模擬複製到一半被打斷：目標檔只寫進前半段，但 copyFile 本身沒有丟錯。
// 這就是 10/24 13:00 docs/business-profile.json 只剩 4039/5418 bytes 的樣子。
const interrupt = vi.hoisted(() => {
  process.env.PUBLIC_SITE_BASE_URL ??= "https://example.com/laundry-social-auto-poster";
  return { target: "", times: 0 };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const copyFile = async (src: Parameters<typeof actual.copyFile>[0], dest: Parameters<typeof actual.copyFile>[1], mode?: number) => {
    if (interrupt.times > 0 && String(dest).endsWith(interrupt.target)) {
      interrupt.times -= 1;
      const data = await actual.readFile(src);
      await actual.writeFile(dest, data.subarray(0, Math.floor(data.length / 2)));
      return;
    }
    return actual.copyFile(src, dest, mode);
  };
  return { ...actual, copyFile, default: { ...actual, copyFile } };
});

const { generatePublicSite } = await import("../src/generatePublicSite");

async function makeRoot(): Promise<{ root: string; source: Buffer }> {
  const root = mkdtempSync(join(tmpdir(), "laundry-copy-verify-"));
  await mkdir(join(root, "data"), { recursive: true });
  const profile = await readFile(join(process.cwd(), "data", "business-profile.json"));
  await writeFile(join(root, "data", "business-profile.json"), profile);
  await mkdir(join(root, "seo-overrides"), { recursive: true });
  await writeFile(join(root, "seo-overrides", "business-profile.json"), profile);
  return { root, source: profile };
}

const run = (root: string) =>
  generatePublicSite({ root, baseUrl: "https://example.com/laundry-social-auto-poster", now: "2026-07-02T01:00:00.000Z" });

afterEach(() => {
  interrupt.target = "";
  interrupt.times = 0;
});

describe("generatePublicSite seo-overrides copy verification", () => {
  it("fails and names the file when every copy attempt is cut off halfway", async () => {
    const { root } = await makeRoot();
    interrupt.target = "business-profile.json";
    interrupt.times = 99;
    await expect(run(root)).rejects.toThrow(/business-profile\.json/);
  });

  it("recovers when only the first attempt is cut off", async () => {
    const { root, source } = await makeRoot();
    interrupt.target = "business-profile.json";
    interrupt.times = 1;
    await run(root);
    const written = await readFile(join(root, "docs", "business-profile.json"));
    expect(written.equals(source)).toBe(true);
  });
});
