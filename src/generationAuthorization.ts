import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projectRoot } from "./paths";

// The single source of truth for paid video generation authorization.
//
// Until 2026-08-17 two signals contradicted each other: the video candidate
// manifest hardcoded generation_authorized: true while the retired Codex
// governance automation wrote output/operations/*-preproduction-contract.json
// with generation_authorized: false every morning. Neither value was ever a
// decision anyone made (BOARD0817-ABSORB, DEAD_VS_ALIVE). The contract files
// are archived; authorization now comes only from the owner-granted budget in
// data/publishing-policy.json under paid_video_budget, and every branch below
// fails closed: a missing file, a missing block, or any unproven condition
// means NOT authorized.
//
// Call-time enforcement (per-call ledger writes, per-concept stop-loss,
// batch_concept scoping) belongs to the reel production line (W4a); this
// module answers the planning-time question the manifest publishes.

export const GENERATION_AUTHORIZATION_SOURCE = "data/publishing-policy.json#paid_video_budget";

export interface PaidVideoBudget {
  authorized_by?: string | null;
  authorized_at?: string | null;
  expires_at?: string | null;
  max_calls?: number | null;
  batch_concept?: string | null;
  tripped?: boolean | null;
}

export interface GenerationAuthorization {
  authorized: boolean;
  source: typeof GENERATION_AUTHORIZATION_SOURCE;
  blockers: string[];
  used_calls: number;
  max_calls: number;
}

function grantedDate(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return value.slice(0, 10);
}

// Every paid call writes one ledger line before and one after it, and a
// crashed call leaves its start line behind — so ceil(lines / 2) counts a
// crashed call as spent budget instead of free retries. used_calls is only
// ever derived from the ledger, never hand-written.
async function countLedgerCalls(root: string): Promise<number> {
  try {
    const raw = await readFile(join(root, "data", "paid-video-ledger.jsonl"), "utf8");
    return Math.ceil(raw.split(/\r?\n/).filter((line) => line.trim().length > 0).length / 2);
  } catch {
    return 0;
  }
}

export async function loadGenerationAuthorization(
  date: string,
  root = projectRoot()
): Promise<GenerationAuthorization> {
  const blockers: string[] = [];

  let budget: PaidVideoBudget | undefined;
  try {
    const policy = JSON.parse(await readFile(join(root, "data", "publishing-policy.json"), "utf8")) as {
      paid_video_budget?: PaidVideoBudget;
    };
    budget = policy.paid_video_budget;
    if (!budget) {
      blockers.push("data/publishing-policy.json has no paid_video_budget block; the owner has not granted a generation budget.");
    }
  } catch {
    blockers.push("data/publishing-policy.json is missing or unreadable.");
  }

  const usedCalls = await countLedgerCalls(root);
  const maxCalls =
    typeof budget?.max_calls === "number" && Number.isFinite(budget.max_calls) ? budget.max_calls : 0;

  if (budget) {
    if (budget.tripped !== false) blockers.push("paid_video_budget.tripped is not false; the line brake is engaged.");
    if (!budget.authorized_by) blockers.push("paid_video_budget.authorized_by is empty; a grant must name who gave it.");
    if (!grantedDate(budget.authorized_at)) {
      blockers.push("paid_video_budget.authorized_at is not a dated grant.");
    } else if (date < grantedDate(budget.authorized_at)!) {
      blockers.push(`paid_video_budget starts ${grantedDate(budget.authorized_at)}; ${date} is before the grant.`);
    }
    const expires = grantedDate(budget.expires_at);
    if (!expires) {
      blockers.push("paid_video_budget.expires_at is missing; an open-ended grant is not a grant.");
    } else if (date > expires) {
      blockers.push(`paid_video_budget expired ${expires}; ${date} is outside the grant.`);
    }
    if (maxCalls < 1) {
      blockers.push("paid_video_budget.max_calls is not a positive number.");
    } else if (usedCalls >= maxCalls) {
      blockers.push(`paid_video_budget exhausted: ${usedCalls}/${maxCalls} calls used per data/paid-video-ledger.jsonl.`);
    }
  }

  return {
    authorized: blockers.length === 0,
    source: GENERATION_AUTHORIZATION_SOURCE,
    blockers,
    used_calls: usedCalls,
    max_calls: maxCalls
  };
}
