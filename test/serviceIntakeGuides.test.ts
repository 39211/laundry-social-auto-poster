import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

describe("two-page service intake build contract", () => {
  it("passes isolated tests and checked-in artifact integration without network or writes to docs", () => {
    execFileSync(process.execPath, ["--test", "scripts/service-intake-guides.test.mjs"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      timeout: 60000,
      stdio: "pipe"
    });
  }, 65000);
});
