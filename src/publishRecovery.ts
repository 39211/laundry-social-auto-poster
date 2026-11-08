import { access } from "node:fs/promises";
import { join } from "node:path";
import { existingStaffGroup, type StaffAlertSender } from "./facebookLostAlert";
import { loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { imageAssetsForSlot } from "./mediaAssets";
import { getSlotPublishTime } from "./publishTimes";
import { getZonedDateParts } from "./scheduler";
import { NonRetryableError, requestNeverSent } from "./retry";
import type { AppConfig, DailySlot, Platform, PostLogEntry } from "./types";

export interface RecoveryRecord {
  date: string; slot: number; platform: Platform;
  status: "retry_pending" | "retry_claimed" | "needs_manual" | "resolved";
  retry_attempts: number;
  /** Separate, durable one-shot budget for an explicitly approved backfill. */
  backfill_attempts?: number;
  reason: string;
  notification: "none" | "reserved" | "pending" | "delivered" | "suppressed";
  checked_at: string;
  evidence?: "absent" | "published" | "pending" | "unknown";
}
export interface RecoveryDecision {
  action: "retry" | "confirmed" | "manual";
  record: RecoveryRecord;
  postId?: string;
  checkedAt: number;
}
export interface RecoveryInput {
  root: string; date: string; slot: DailySlot; platform: Platform;
  config: AppConfig; now: Date; fetchImpl: typeof fetch; sender?: StaffAlertSender;
  startedAt?: number;
  backfill?: boolean;
}
const pathFor = (input: Pick<RecoveryInput, "root" | "date" | "slot" | "platform">) =>
  join(input.root, "data", "gates", `publish-recovery-${input.date}-slot${input.slot.slot}-${input.platform}.json`);

/** Called while postCurrentSlot holds the existing date/slot publish lock. */
export async function markRecoveryManual(input: RecoveryInput, record: RecoveryRecord, reason: string): Promise<void> {
  record.status = "needs_manual";
  record.reason = reason;
  record.checked_at = input.now.toISOString();
  if (input.backfill) {
    record.notification = "suppressed";
    await writeJsonAtomic(pathFor(input), record);
    return;
  }
  await writeJsonAtomic(pathFor(input), record);
  if (record.notification === "delivered") return;
  // Reserve before external I/O; LINE also uses this stable key for idempotence.
  record.notification = "reserved";
  await writeJsonAtomic(pathFor(input), record);
  const key = input.platform === "facebook" ? `sxj:fb-lost:${input.date}:slot${input.slot.slot}` :
    `sxj:publish-recovery:${input.date}:slot${input.slot.slot}:${input.platform}`;
  const message = `[發布需人工處理] ${input.date} slot${input.slot.slot} ${input.platform}; 原因:${reason}; ` +
    `自動補發已停止（已用 ${record.retry_attempts}/1 次）。請先核對平台；保留原紀錄，勿直接重發。`;
  let delivered = false;
  try { delivered = await (input.sender ?? existingStaffGroup(input.root))(message, key); } catch { /* pending is visible in both reports */ }
  record.notification = delivered ? "delivered" : "pending";
  await writeJsonAtomic(pathFor(input), record);
}

function inWindow(input: RecoveryInput): boolean {
  const time = getSlotPublishTime(input.date, input.slot.slot, input.root);
  const start = Date.parse(`${input.date}T${time}:00+08:00`);
  const now = new Date(input.now.getTime() + (input.startedAt === undefined ? 0 : Date.now() - input.startedAt));
  const at = now.getTime();
  // ALLOW_OFF_SCHEDULE_PUBLISH never overrides the retry contract.
  return getZonedDateParts(now, "Asia/Taipei").date === input.date && at >= start && at < start + 4 * 3600_000;
}

export async function preparePublicationRecovery(input: RecoveryInput, failedAttempt?: unknown): Promise<RecoveryDecision | undefined> {
  const { loadScheduledLog, readPublicationEvidence } = await import("./scheduleAhead");
  const rows = await loadPostLog(input.date, input.root);
  const pair = rows.filter(row => row.slot === input.slot.slot && row.platform === input.platform && row.dry_run === false);
  if (pair.some(row => ["success", "posted"].includes(row.status))) return;
  const failure = pair.filter(row => ["failed", "uncertain"].includes(row.status)).at(-1);
  // Do not collapse an unreadable schedule to an empty queue: that could double-post.
  let scheduleUnreadable = false;
  let scheduled: Awaited<ReturnType<typeof loadScheduledLog>> = [];
  try {
    scheduled = input.platform === "facebook" ? await loadScheduledLog(input.date, input.root) : [];
    if (!Array.isArray(scheduled) || scheduled.some(row => !row || typeof row.slot !== "number")) throw new Error("invalid schedule");
  } catch { scheduled = []; scheduleUnreadable = true; }
  const scheduledFailure = scheduled.find(row => row.slot === input.slot.slot && row.status === "uncertain");
  if (!input.backfill && !failure && !scheduledFailure && !scheduleUnreadable) return;
  let ledgerUnreadable = false;
  let prior: RecoveryRecord | undefined;
  try { prior = await readJsonFile<RecoveryRecord | undefined>(pathFor(input), undefined); }
  catch { ledgerUnreadable = true; }
  if (prior !== undefined && (!prior || typeof prior !== "object" || Array.isArray(prior) ||
    prior.date !== input.date || prior.slot !== input.slot.slot || prior.platform !== input.platform ||
    !Number.isInteger(prior.retry_attempts) || prior.retry_attempts < 0 || prior.retry_attempts > 1 ||
    (prior.backfill_attempts !== undefined && prior.backfill_attempts !== 0 && prior.backfill_attempts !== 1) ||
    !["resolved", "needs_manual", "retry_pending", "retry_claimed"].includes(prior.status) ||
    !["none", "reserved", "pending", "delivered", "suppressed"].includes(prior.notification) || !/^[a-z_]{1,64}$/.test(prior.reason))) {
    prior = undefined;
    ledgerUnreadable = true;
  }
  const record: RecoveryRecord = {
    date: input.date, slot: input.slot.slot, platform: input.platform,
    status: prior?.status ?? "retry_pending", retry_attempts: prior?.retry_attempts ?? 0,
    reason: prior?.reason ?? "unconfirmed", notification: prior?.notification ?? "none", checked_at: input.now.toISOString(),
    ...(prior?.backfill_attempts !== undefined ? { backfill_attempts: prior.backfill_attempts } : {})
  };
  if (ledgerUnreadable) {
    record.retry_attempts = 1;
    // A damaged ledger may have lost a backfill claim. Rewriting a readable
    // manual receipt must not grant a new budget on the next invocation.
    record.backfill_attempts = 1;
  }
  const evidence = await readPublicationEvidence({
    config: input.config, fetchImpl: input.fetchImpl, platform: input.platform,
    caption: input.platform === "facebook" ? input.slot.facebook_caption : input.slot.instagram_caption,
    slotTime: Date.parse(`${input.date}T${getSlotPublishTime(input.date, input.slot.slot, input.root)}:00+08:00`) / 1000
  });
  record.evidence = evidence.state;
  record.checked_at = input.now.toISOString();
  const decision: RecoveryDecision = { action: "manual", record, checkedAt: Date.now() };
  if (evidence.state === "published") {
    record.status = "retry_pending";
    record.reason = "platform_confirmed_pending_record";
    await writeJsonAtomic(pathFor(input), record);
    return { ...decision, action: "confirmed", postId: evidence.postId };
  }
  let reason: string | undefined;
  if (ledgerUnreadable || scheduleUnreadable) reason = "recovery_source_unreadable";
  else if (evidence.state !== "absent") reason = `readback_${evidence.state}`;
  else if (input.backfill && (record.backfill_attempts ?? 0) >= 1) reason = "backfill_already_attempted";
  else if (!input.backfill && (prior?.status === "needs_manual" || record.retry_attempts >= 1)) reason = prior?.reason ?? "retry_exhausted";
  else if (prior?.status === "resolved" || (input.backfill && prior?.reason === "resolved_evidence_missing")) reason = "resolved_evidence_missing";
  else if (input.backfill && (prior?.status === "retry_claimed" || prior?.reason === "ambiguous_commit")) reason = "ambiguous_commit";
  else if (!input.backfill && !inWindow(input)) reason = "outside_same_day_window";
  else if ((failure?.error ?? "").startsWith("cloud:")) reason = "cloud_owned";
  else if (["reel", "mixed-carousel"].includes(failure?.published_media_type ?? scheduledFailure?.published_media_type ?? input.slot.media_type ?? "image")) reason = "pending_video_not_verifiable";
  else if (input.backfill && scheduled.some(row => row.slot === input.slot.slot)) reason = "facebook_schedule_exists";
  else if (scheduled.some(row => row.slot === input.slot.slot && row.status !== "uncertain" && row.scheduled_post_id)) reason = "confirmed_schedule_unverified";
  else {
    const error = failure?.error ?? scheduledFailure?.error ?? "";
    const transportUnsent = failure?.status === "failed" && requestNeverSent(failedAttempt);
    // Conservative allowlist: permissions, policy, unknown commit errors and missing IDs require a person.
    // These journals retain text, not a verifiable structured Facebook rejection.
    // Image-rejection words therefore cannot clear a possibly committed request.
    if (failure?.status === "uncertain" || (!failure && scheduledFailure !== undefined) ||
      /commit point|response lost|may already be live/i.test(error)) reason = "ambiguous_commit";
    // Explicit approval changes the window/budget, not the certainty of a
    // historical failure. A fresh backfill has no failed request to classify.
    else if ((!input.backfill || failure !== undefined) && ((!transportUnsent && !/(?:Missing or invalid image file|Public (?:image|asset) URL is not reachable \((?:404|429|50[0234])\)|temporar(?:y|ily)|HTTP (?:429|50[0234])|EAI_AGAIN|ECONNREFUSED|ENOTFOUND)/i.test(error)) ||
      /permission|auth|expired|denied|policy/i.test(error))) reason = "non_retryable";
    else {
      const assets = imageAssetsForSlot(input.slot);
      if (!assets.length) reason = "local_media_missing";
      for (const asset of assets) {
        try { await access(join(input.root, asset.local_image_path)); } catch { reason = "local_media_missing"; }
      }
    }
  }
  if (reason) {
    await markRecoveryManual(input, record, reason);
    return decision;
  }
  record.status = "retry_pending";
  record.reason = input.backfill ? "platform_absent_backfill" : "platform_absent_retryable";
  await writeJsonAtomic(pathFor(input), record);
  return { ...decision, action: "retry" };
}

export async function claimRecoveryRetry(input: RecoveryInput, decision: RecoveryDecision): Promise<void> {
  const stop = async (reason: string): Promise<never> => {
    await markRecoveryManual(input, decision.record, reason);
    throw new NonRetryableError(`needs_manual:${reason}`);
  };
  // Approval/media validation may outlive the earlier Page observation.
  if ((!input.backfill && !inWindow(input)) || Date.now() - decision.checkedAt > 60_000 || decision.record.evidence !== "absent") {
    return stop("evidence_or_window_expired");
  }
  const { loadScheduledLog, readPublicationEvidence } = await import("./scheduleAhead");
  const readStartedAt = Date.now();
  const evidence = await readPublicationEvidence({
    config: input.config, fetchImpl: input.fetchImpl, platform: input.platform,
    caption: input.platform === "facebook" ? input.slot.facebook_caption : input.slot.instagram_caption,
    slotTime: Date.parse(`${input.date}T${getSlotPublishTime(input.date, input.slot.slot, input.root)}:00+08:00`) / 1000
  });
  decision.record.evidence = evidence.state;
  if (evidence.state !== "absent") return stop(`retry_readback_${evidence.state}`);
  // Re-read the queue after platform I/O as well: any row for this FB slot owns
  // its publication, including uncertain rows with no scheduled_post_id.
  if (input.platform === "facebook") {
    let scheduled: Awaited<ReturnType<typeof loadScheduledLog>>;
    try {
      scheduled = await loadScheduledLog(input.date, input.root);
      if (!Array.isArray(scheduled) || scheduled.some(row => !row || typeof row.slot !== "number")) throw new Error("invalid schedule");
    } catch { return stop("recovery_source_unreadable"); }
    if (scheduled.some(row => row.slot === input.slot.slot)) return stop("facebook_schedule_exists");
  }
  if ((!input.backfill && !inWindow(input)) || Date.now() - readStartedAt > 60_000) return stop("evidence_or_window_expired");
  decision.checkedAt = Date.now();
  if (input.backfill) decision.record.backfill_attempts = 1;
  else decision.record.retry_attempts = 1;
  decision.record.status = "retry_claimed";
  decision.record.reason = input.backfill ? "backfill_reserved_before_publish" : "retry_reserved_before_publish";
  // Persistent before transport, never reclaim this budget after a crash.
  await writeJsonAtomic(pathFor(input), decision.record);
}

export async function finishRecovery(input: RecoveryInput, decision: RecoveryDecision, entry: PostLogEntry): Promise<void> {
  if (["success", "posted"].includes(entry.status)) {
    decision.record.status = "resolved";
    decision.record.reason = decision.action === "confirmed" ? "platform_confirmed" : input.backfill ? "backfill_published" : "retry_published";
    await writeJsonAtomic(pathFor(input), decision.record);
  } else await markRecoveryManual(input, decision.record, input.backfill ? "backfill_failed" : "retry_failed");
}
