import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { submitIndexNow } from "../src/submitIndexNow";

async function writeSitemap(root: string): Promise<void> {
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "docs", "sitemap.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      "<url><loc>https://39211.github.io/</loc></url>",
      "<url><loc>https://39211.github.io/services/white-shoe-cleaning.html</loc></url>",
      "<url><loc>https://39211.github.io/answers.json</loc></url>",
      "</urlset>"
    ].join("\n"),
    "utf8"
  );
}

describe("submitIndexNow", () => {
  it("is dry-run by default and submits only canonical HTML URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "test-indexnow-key" })).resolves.toEqual({
      dryRun: true,
      urlCount: 2,
      host: "39211.github.io"
    });
  });

  it("requires an explicit key before any IndexNow action", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-no-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root })).rejects.toThrow("INDEXNOW_KEY is required");
  });

  it("rejects keys that don't match the IndexNow 8-128 character pattern", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-bad-key-"));
    await writeSitemap(root);

    await expect(submitIndexNow({ root, key: "ab" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
    await expect(submitIndexNow({ root, key: "with spaces" })).rejects.toThrow("INDEXNOW_KEY must be 8-128");
  });

  it("expects the public key file to be named ${INDEXNOW_KEY}.txt and rejects stale locations", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-named-key-"));
    await writeSitemap(root);
    await writeFile(join(root, "docs", "indexnow-key.txt"), "laundry-test-key-2026\n", "utf8");

    await expect(
      submitIndexNow({ root, key: "laundry-test-key-2026", live: true })
    ).rejects.toThrow(/laundry-test-key-2026\.txt does not match INDEXNOW_KEY/);
  });

  it("verifies the public key file before live submission and never needs to expose the key", async () => {
    const root = mkdtempSync(join(tmpdir(), "laundry-indexnow-live-"));
    await writeSitemap(root);
    await writeFile(join(root, "docs", "test-indexnow-key.txt"), "test-indexnow-key\n", "utf8");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(String(input).endsWith("test-indexnow-key.txt") ? "test-indexnow-key" : "", { status: 200 });
    }) as typeof fetch;

    await expect(
      submitIndexNow({ root, key: "test-indexnow-key", live: true, endpoint: "https://indexnow.example/submit", fetchImpl })
    ).resolves.toEqual({ dryRun: false, urlCount: 2, host: "39211.github.io" });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://indexnow.example/submit");
    expect(calls[1]?.init?.body).toContain("white-shoe-cleaning.html");
    expect(calls[1]?.init?.body).not.toContain("answers.json");
  });
});
