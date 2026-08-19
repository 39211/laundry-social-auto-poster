import { getFlag, getNumberOption, getOption, isMain } from "./cli";
import { markVideoRepairReady } from "./logging";
import { projectRoot } from "./paths";
import { resolveQualifiedDualPlatformReelReplacement } from "./publishingReconciliation";

export interface ResolveVideoRepairOptions {
  sourceDate: string;
  sourceSlot: number;
  replacementDate: string;
  replacementSlot: number;
  readyOnly?: boolean;
  root?: string;
}

export async function resolveVideoRepair(options: ResolveVideoRepairOptions): Promise<void> {
  const root = projectRoot(options.root);
  if (options.readyOnly) {
    await markVideoRepairReady(
      options.sourceDate,
      options.sourceSlot,
      options.replacementDate,
      options.replacementSlot,
      root
    );
  } else {
    const verification = await resolveQualifiedDualPlatformReelReplacement({
      sourceDate: options.sourceDate,
      sourceSlot: options.sourceSlot,
      replacementDate: options.replacementDate,
      replacementSlot: options.replacementSlot,
      root
    });
    if (!verification.qualified) {
      throw new Error(
        `Video repair remains VIDEO_DEFERRED: ${verification.reason ?? "qualified dual-platform Reel proof is missing"}.`
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceDate = getOption(args, "source-date");
  const sourceSlot = getNumberOption(args, "source-slot");
  const replacementDate = getOption(args, "replacement-date");
  const replacementSlot = getNumberOption(args, "replacement-slot");
  const readyOnly = getFlag(args, "ready");
  if (!sourceDate || !sourceSlot || !replacementDate || !replacementSlot) {
    throw new Error(
      "Required: --source-date YYYY-MM-DD --source-slot N --replacement-date YYYY-MM-DD --replacement-slot N"
    );
  }
  await resolveVideoRepair({ sourceDate, sourceSlot, replacementDate, replacementSlot, readyOnly });
  console.log(
    JSON.stringify({
      source_date: sourceDate,
      source_slot: sourceSlot,
      status: readyOnly ? "VIDEO_DEFERRED" : "RESOLVED",
      replacement_ready: readyOnly,
      replacement_date: replacementDate,
      replacement_slot: replacementSlot
    }, null, 2)
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
