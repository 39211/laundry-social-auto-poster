import { getNumberOption, getOption, isMain } from "./cli";
import { assertSlotMediaMutable, parseMediaGuardOverride, SlotLockedError } from "./mediaMutationGuard";
import { projectRoot } from "./paths";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const date = getOption(args, "date");
  const slot = getNumberOption(args, "slot");
  const operation = getOption(args, "operation");
  if (!date || slot === undefined || slot <= 0 || !operation) {
    throw new Error("Required: --date YYYY-MM-DD --slot N --operation <text>.");
  }

  const root = projectRoot(getOption(args, "root"));
  const override = parseMediaGuardOverride(args);

  try {
    await assertSlotMediaMutable({ root, date, slot, operation, override });
    console.log("MEDIA_GUARD| ok");
  } catch (error) {
    if (error instanceof SlotLockedError) {
      console.error(error.message);
      process.exitCode = 3;
      return;
    }
    throw error;
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
