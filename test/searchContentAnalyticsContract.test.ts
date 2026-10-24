import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { it } from "vitest";

it("passes the isolated analytics runtime contracts and mutation guards", () => {
  // Same dependency-free suite used by the independent audit. This runs only
  // a mocked DOM/gtag in node:vm; no network, OAuth, or production events.
  execFileSync(process.execPath, [
    "--experimental-transform-types", "--test",
    join(process.cwd(), "scripts/verify-search-content-analytics.mjs")
  ], { cwd: process.cwd(), stdio: "pipe", timeout: 15_000 });
});
