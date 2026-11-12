import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Existing wrapper tests stub adjacent I/O and model NO retirements.
 * The real shared reader, including failure and mutations, is covered separately
 * by slotRetirement.powershell.test.ts. All original assertions stay intact. */
export function installLegacySlotRetirementFixture(root: string): void {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "src/slot-retirements.json"), JSON.stringify({ version: 1, retirements: [] }));
  writeFileSync(join(root, "scripts/slot-retirements.ps1"), '\uFEFFfunction Remove-RetiredPublishSlots { param([AllowEmptyCollection()][int[]]$Slots, [string]$Root, [string]$Date); return [int[]]@($Slots) }\n', "utf8");
  const slotLibrary = join(root, "scripts/publish-slot-times.ps1");
  if (existsSync(slotLibrary)) {
    const source = readFileSync(slotLibrary, "utf8");
    if (!source.includes('"slot-retirements.ps1"')) writeFileSync(slotLibrary, `${source}\n. (Join-Path $PSScriptRoot "slot-retirements.ps1")\n`, "utf8");
  }
}
