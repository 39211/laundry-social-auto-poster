import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => {
  process.env.PUBLIC_SITE_BASE_URL ??= "https://example.com/laundry-social-auto-poster";
  return { remaining: 0, code: "", errno: 0, corrupt: false, destinations: [] as string[] };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const copyFile: typeof actual.copyFile = async (src, dest, mode) => {
    if (String(src).endsWith("business-profile.json")) {
      fault.destinations.push(String(dest));
      if (fault.remaining-- > 0) {
        throw Object.assign(new Error("file locked"), { code: fault.code, errno: fault.errno });
      }
      if (fault.corrupt) {
        await actual.writeFile(dest, "truncated");
        return;
      }
    }
    await actual.copyFile(src, dest, mode);
  };
  return { ...actual, copyFile, default: { ...actual, copyFile } };
});
const site = await import("../src/generatePublicSite");
const { copyFileVerified, VERIFIED_COPY_ATTEMPTS } = await import("../src/verifiedCopy");
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "public-copy-lock-"));
  roots.push(root);
  await mkdir(join(root, "data"));
  await mkdir(join(root, "seo-overrides"));
  const source = await readFile(join(process.cwd(), "data/business-profile.json"));
  await writeFile(join(root, "data/business-profile.json"), source);
  const src = join(root, "seo-overrides/business-profile.json");
  await writeFile(src, source);
  return { root, src, source, target: join(root, "business-profile.json") };
}
afterEach(async () => {
  fault.remaining = 0;
  fault.corrupt = false;
  fault.destinations = [];
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("recovers from two EBUSY copies using temp files and exponential backoff", async () => {
  const { src, target, source, root } = await fixture();
  Object.assign(fault, { remaining: 2, code: "EBUSY", errno: -16 });
  const delay = vi.fn(async (_ms: number) => {});
  await Reflect.apply(copyFileVerified, undefined, [src, target, target, VERIFIED_COPY_ATTEMPTS, delay]);
  expect(await readFile(target)).toEqual(source);
  expect(delay.mock.calls.map(([ms]) => ms)).toEqual([50, 100]);
  expect(fault.destinations).toHaveLength(3);
  expect(fault.destinations.every((dest) => dest.startsWith(`${target}.tmp-${process.pid}-`))).toBe(true);
  expect((await readdir(root)).some((name) => name.includes(".tmp-"))).toBe(false);
});

it("recovers from two Windows UNKNOWN errno -4094 copies with backoff", async () => {
  const { src, target, source } = await fixture();
  Object.assign(fault, { remaining: 2, code: "UNKNOWN", errno: -4094 });
  const delay = vi.fn(async (_ms: number) => {});
  await Reflect.apply(copyFileVerified, undefined, [src, target, target, VERIFIED_COPY_ATTEMPTS, delay]);
  expect(await readFile(target)).toEqual(source);
  expect(delay.mock.calls.map(([ms]) => ms)).toEqual([50, 100]);
  expect(fault.destinations).toHaveLength(3);
});

it("rejects persistent sha mismatch naming the file and the CLI handler sets exit code 1", async () => {
  const { root } = await fixture();
  fault.corrupt = true;
  const error = await site.generatePublicSite({ root, baseUrl: "https://example.com/laundry-social-auto-poster", now: "2026-07-02T01:00:00.000Z" }).then(
    () => { throw new Error("generation unexpectedly succeeded"); },
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/business-profile\.json/);
  expect(fault.destinations).toHaveLength(VERIFIED_COPY_ATTEMPTS);
  expect((await readdir(join(root, "docs"))).some((name) => name.includes(".tmp-"))).toBe(false);
  const previousExitCode = process.exitCode;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    Reflect.apply(Reflect.get(site, "handlePublicSiteError"), undefined, [error]);
    expect(process.exitCode).toBe(1);
    expect(log).toHaveBeenCalledWith(error);
  } finally {
    process.exitCode = previousExitCode;
  }
});
