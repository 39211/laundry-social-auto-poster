import { getOption, isMain } from "./cli";
import { reclassifyVideoRepairQueue } from "./logging";
import { projectRoot } from "./paths";
import { isRetiredVideoAbsenceReason } from "./postCurrentSlot";

// Corrects queue entries recorded before the companion-video line was retired
// (docs-internal/OPTIMIZE-LOOP-20260817.md, 13:20 absorption ruling): an
// absence-of-video reason is a pending gate, not a fault, and must stop
// tripping the unexpected-defer alarms in catchup-publish and the command
// round. Safe to re-run; entries already corrected are left alone.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = projectRoot(getOption(args, "root"));
  const changed = await reclassifyVideoRepairQueue(
    (entry) => isRetiredVideoAbsenceReason(entry.failure_reason),
    new Date().toISOString(),
    root
  );
  console.log(
    JSON.stringify(
      {
        reclassified: changed.length,
        entries: changed.map((entry) => ({
          source_date: entry.source_date,
          source_slot: entry.source_slot
        }))
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
