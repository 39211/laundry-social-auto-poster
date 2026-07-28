import { getNumberOption, getOption, isMain } from "./cli";
import { writeOperationsDashboardArtifact } from "./operationsDashboard";

export async function generateOperationsDashboardCli(args = process.argv.slice(2)): Promise<void> {
  const asOfValue = getOption(args, "as-of");
  const asOf = asOfValue ? new Date(asOfValue) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) {
    throw new Error("--as-of must be a valid ISO date-time.");
  }

  const { path, result } = await writeOperationsDashboardArtifact({
    startDate: getOption(args, "start-date"),
    totalDays: getNumberOption(args, "days"),
    root: getOption(args, "root"),
    outputPath: getOption(args, "output"),
    asOf
  });

  console.log(
    JSON.stringify(
      {
        artifact_path: path,
        generated_at: result.artifact.snapshot.generatedAt,
        status: result.artifact.snapshot.status,
        current_day: result.summary.current_day,
        due_slots: result.summary.due_slots,
        published_due_slots: result.summary.published_due_slots,
        kpi_coverage: result.summary.kpi_coverage,
        access_issues: result.artifact.snapshot.accessIssues?.length ?? 0
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  generateOperationsDashboardCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
