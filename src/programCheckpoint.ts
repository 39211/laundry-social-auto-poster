import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { buildLocalReachReport, type LocalReachReport } from "./localReach";
import { getZonedDateParts } from "./scheduler";

// The day 30 and day 60 decision rules from docs/reels-roadmap.md, evaluated
// rather than remembered. A checkpoint that lives only in a document is a
// checkpoint that gets skipped on the day, and the whole point of setting a
// threshold in advance is to decide before the result is in front of you.

export const PROGRAMME_START = "2026-07-11";

export type Verdict = "scale" | "adjust" | "stop";

export interface CheckpointResult {
  checkpoint: 30 | 60;
  as_of: string;
  programme_day: number;
  window_days: number;
  measured: {
    inquiries: number;
    bookings: number;
    accounts_engaged: number | null;
    followers_gained: number | null;
    reach_non_follower: number | null;
  };
  verdict: Verdict;
  reasoning: string;
  action: string;
}

export function programmeDay(date: string): number {
  const start = Date.parse(`${PROGRAMME_START}T00:00:00.000Z`);
  const now = Date.parse(`${date}T00:00:00.000Z`);
  return Math.floor((now - start) / 86_400_000) + 1;
}

// Watch ratio per Reel is not available from the account-level metrics this
// evaluates, so the rules here use the signals that are: inquiries, engaged
// accounts, bookings and followers. A Reel-level rule stays in the roadmap for
// the human to apply until per-Reel insights are collected.
export function decideDay30(report: LocalReachReport): { verdict: Verdict; reasoning: string; action: string } {
  const engaged = report.accounts_engaged ?? 0;

  if (report.inquiries >= 2 && engaged >= 8) {
    return {
      verdict: "scale",
      reasoning: `${report.inquiries} inquiries and ${engaged} engaged accounts clear the bar.`,
      action: "Move to the day 31-60 phase: three to four Reels a week, one daily post."
    };
  }
  if (report.inquiries >= 1 || engaged >= 5) {
    return {
      verdict: "adjust",
      reasoning: `${report.inquiries} inquiries and ${engaged} engaged accounts are below the bar but not flat.`,
      action: "Keep the topics that worked, put real footage in every Reel, retest for two weeks."
    };
  }
  return {
    verdict: "stop",
    reasoning: `${report.inquiries} inquiries and ${engaged} engaged accounts show nothing is landing.`,
    action: "Stop generated-only Reels. Return to posts and inquiry routing."
  };
}

export function decideDay60(report: LocalReachReport): { verdict: Verdict; reasoning: string; action: string } {
  const gained = report.followers_gained ?? 0;

  if (report.inquiries >= 8 && report.bookings >= 3 && gained >= 30) {
    return {
      verdict: "scale",
      reasoning: `${report.inquiries} inquiries, ${report.bookings} bookings and ${gained} new followers clear the bar.`,
      action: "Continue to day 61-90: strengthen calls to action, consider a small boost on a proven Reel."
    };
  }
  if (report.inquiries >= 4 || report.bookings >= 1) {
    return {
      verdict: "adjust",
      reasoning: `${report.inquiries} inquiries and ${report.bookings} bookings show partial traction.`,
      action: "Narrow to the topics that produced inquiries. Drop the rest."
    };
  }
  return {
    verdict: "stop",
    reasoning: `${report.inquiries} inquiries and ${report.bookings} bookings after 60 days is not traction.`,
    action: "Stop pursuing growth through Reels. Move to low frequency and high intent, and reconsider how much Instagram deserves."
  };
}

export async function evaluateCheckpoint(
  options: { checkpoint?: 30 | 60; asOf?: string; root?: string } = {}
): Promise<CheckpointResult> {
  const config = getConfig();
  const asOf = options.asOf ?? getZonedDateParts(new Date(), config.timezone).date;
  const day = programmeDay(asOf);
  const checkpoint = options.checkpoint ?? (day >= 60 ? 60 : 30);

  // Day 30 looks at the 12 days since the plan was rewritten; day 60 at 30 days.
  const windowDays = checkpoint === 30 ? 12 : 30;
  const report = await buildLocalReachReport({ days: windowDays, root: options.root });
  const decision = checkpoint === 30 ? decideDay30(report) : decideDay60(report);

  return {
    checkpoint,
    as_of: asOf,
    programme_day: day,
    window_days: windowDays,
    measured: {
      inquiries: report.inquiries,
      bookings: report.bookings,
      accounts_engaged: report.accounts_engaged,
      followers_gained: report.followers_gained,
      reach_non_follower: report.reach_non_follower
    },
    ...decision
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const raw = getNumberOption(args, "checkpoint");
  if (raw !== undefined && raw !== 30 && raw !== 60) {
    throw new Error("--checkpoint must be 30 or 60.");
  }

  const result = await evaluateCheckpoint({
    checkpoint: raw as 30 | 60 | undefined,
    asOf: getOption(args, "as-of"),
    root: getOption(args, "root")
  });

  console.log(JSON.stringify(result, null, 2));
  // A stop verdict exits non-zero so a scheduled run raises it instead of
  // filing it quietly in a log nobody opens.
  if (result.verdict === "stop") process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
