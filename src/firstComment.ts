import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { findStrictLiveTransportEntry } from "./publishingReconciliation";
import { assertCanonicalPublicPublicationApproval } from "./publicPublicationApproval";
import { getZonedDateParts } from "./scheduler";
import { utmCampaign, utmTagged } from "./utm";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const SITE = "https://39211.github.io";

// The shop replies first on its own Instagram post. A comment is the highest
// distribution signal a post can earn and a thread with zero comments rarely
// starts itself; the shop opening the thread within the first half hour is the
// cheapest push a post can get. The comment adds a concrete tip or the LINE
// contact rather than restating the caption, and each post gets exactly one --
// an idempotency log guarantees a rerun never double-comments.

interface FirstCommentLog {
  date: string;
  slot: number;
  media_id: string;
  comment_id: string;
  created_at: string;
}

interface FirstCommentRemoteClaim {
  schema_version: 1;
  date: string;
  slot: number;
  platform: "instagram";
  media_id: string;
  claimed_at: string;
}

function isSameSlotCandidate(value: unknown, slot: number): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { slot?: unknown };
  return record.slot === slot || String(record.slot) === String(slot);
}

function hasTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isUsableLiveMetaValue(value: unknown): value is string {
  if (!hasTrimmedNonEmptyString(value)) return false;
  return !/^(?:\[.*\]|<.*>|your[-_].*|example.*|xxx.*|changeme|todo|set|present|redacted|true|false|\*+)$/i.test(
    value
  );
}

function assertLiveFirstCommentMetaConfig(config: ReturnType<typeof getConfig>): void {
  const invalid = [
    ["META_GRAPH_API_VERSION", config.graphApiVersion, /^v\d+(?:\.\d+)?$/],
    ["META_ACCESS_TOKEN", config.metaAccessToken]
  ].filter(([, value, format]) =>
    !isUsableLiveMetaValue(value) || (format instanceof RegExp && !format.test(value))
  );
  if (invalid.length > 0) {
    throw new Error(`invalid or missing live Meta config: ${invalid.map(([name]) => name).join(", ")}`);
  }
}

function firstCommentClaimPath(root: string, date: string, slot: number): string {
  return join(root, "data", "first-comment-claims", date, `slot-${String(slot).padStart(2, "0")}-instagram.json`);
}

async function claimFirstCommentRemotePost(input: {
  root: string;
  date: string;
  slot: number;
  mediaId: string;
}): Promise<"claimed" | "already_claimed"> {
  const path = firstCommentClaimPath(input.root, input.date, input.slot);
  const claim: FirstCommentRemoteClaim = {
    schema_version: 1,
    date: input.date,
    slot: input.slot,
    platform: "instagram",
    media_id: input.mediaId,
    claimed_at: new Date().toISOString()
  };
  await mkdir(join(input.root, "data", "first-comment-claims", input.date), { recursive: true });
  try {
    // The claim is the authority before Graph POST.  It is intentionally never
    // auto-cleared: a timeout or later ledger-write failure can still mean the
    // comment exists remotely.
    await writeFile(path, `${JSON.stringify(claim, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return "claimed";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "already_claimed";
    throw error;
  }
}

export function commentTextFor(topic: string, date: string, slot: number): string {
  // One practical starter per broad object family, then the contact line. The
  // comment must read like the shop talking, not a campaign.
  const tip = /鞋/.test(topic)
    ? "補充一個小判斷:鞋內乾不乾,聞的比摸的準。"
    : /包/.test(topic)
      ? "補充:提把發黏初期用乾布就能緩解,但變色就要處理了。"
      : /西裝|襯衫/.test(topic)
        ? "補充:掛衣架挑肩寬合的,比什麼保養都有效。"
        : /棉被|寢具|床/.test(topic)
          ? "補充:收納前挑有太陽的早上曬兩小時,味道差很多。"
          : "有任何不確定的,拍張照傳過來,我們先幫你看。";
  // The first comment is the one place Instagram lets a link be tapped without
  // costing reach, and it was spending that on a ten-digit number nobody can
  // tap. Twenty-eight days of profile-link taps sat at zero because no tappable
  // path to LINE existed anywhere. The coded redirect is what feeds GA4, so the
  // ads ladder finally has a number to read.
  const url = utmTagged(`${SITE}/go/line.html?source=ig-comment`, {
    source: "instagram",
    campaign: utmCampaign(date, slot)
  });
  return `${tip} 直接點這裡問:${url}(或加 LINE:0968327653)`;
}

export async function postFirstComment(input: {
  date: string;
  slot: number;
  root?: string;
  fetchImpl?: typeof fetch;
  writeJsonAtomicImpl?: typeof writeJsonAtomic;
}): Promise<{ posted?: string; skipped?: string }> {
  const root = projectRoot(input.root);
  const config = getConfig();
  const fetchImpl = input.fetchImpl ?? fetch;
  const writeLog = input.writeJsonAtomicImpl ?? writeJsonAtomic;

  const logPath = join(root, "data", "first-comments", `${input.date}.json`);
  const existing = await readJsonFile<unknown>(logPath, []);
  if (!Array.isArray(existing)) {
    return { skipped: `first-comment log for ${input.date} is malformed; automatic comment is blocked` };
  }
  if (existing.some((entry) => isSameSlotCandidate(entry, input.slot))) {
    return { skipped: `already commented on ${input.date} slot ${input.slot}` };
  }

  const posts = await loadPostLog(input.date, root);
  const live = findStrictLiveTransportEntry(posts, {
    date: input.date,
    slot: input.slot,
    platform: "instagram"
  });
  if (!live) {
    return { skipped: `no unambiguous live Instagram transport for ${input.date} slot ${input.slot}` };
  }
  if (config.dryRun) return { skipped: "dry run" };

  // A missing or placeholder credential is not a recoverable remote state.
  // Reject it before a no-retry claim: otherwise an operator could be left
  // with a durable claim for a request that never had permission to leave.
  try {
    assertLiveFirstCommentMetaConfig(config);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      skipped: `live Meta config for ${input.date} is invalid; automatic first comment is blocked: ${detail}`
    };
  }

  // A live comment is a public effect in its own right. The transport receipt
  // proves that Instagram accepted the feed post, but it is not permission to
  // add new public text later. Validate the exact immutable public-release
  // package before creating our no-retry claim or touching Graph.
  try {
    await assertCanonicalPublicPublicationApproval(input.date, root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      skipped: `canonical public approval for ${input.date} is unverified; automatic first comment is blocked: ${detail}`
    };
  }

  const content = await loadDailyContent(input.date, root);
  if (content?.tampered) {
    return { skipped: `calendar for ${input.date} is tampered; automatic first comment is blocked` };
  }
  const topic = content?.slots.find((item) => item.slot === input.slot)?.topic ?? "";

  // The calendar may have changed while the local topic was being read. Keep
  // the assertion adjacent to the immutable no-retry claim as well.
  try {
    await assertCanonicalPublicPublicationApproval(input.date, root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      skipped: `canonical public approval for ${input.date} is unverified; automatic first comment is blocked: ${detail}`
    };
  }

  let claim: "claimed" | "already_claimed";
  try {
    claim = await claimFirstCommentRemotePost({
      root,
      date: input.date,
      slot: input.slot,
      mediaId: live.post_id
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      skipped: `first-comment remote claim cannot be recorded for ${input.date} slot ${input.slot}; automatic comment is blocked: ${detail}`
    };
  }
  if (claim === "already_claimed") {
    return {
      skipped:
        `remote first-comment claim already exists for ${input.date} slot ${input.slot}; automatic retry is blocked pending recovery`
    };
  }

  const response = await fetchImpl(
    `https://graph.facebook.com/${config.graphApiVersion}/${live.post_id}/comments`,
    {
      method: "POST",
      body: new URLSearchParams({
        message: commentTextFor(topic, input.date, input.slot),
        access_token: config.metaAccessToken ?? ""
      })
    }
  );
  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || typeof payload.id !== "string" || payload.id.length === 0 || payload.id !== payload.id.trim()) {
    throw new Error(`First comment failed: ${payload.error?.message ?? response.status}`);
  }

  try {
    await writeLog(logPath, [
      ...existing,
      {
        date: input.date,
        slot: input.slot,
        media_id: live.post_id,
        comment_id: payload.id,
        created_at: new Date().toISOString()
      } satisfies FirstCommentLog
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `First comment ${payload.id} may be live for ${input.date} slot ${input.slot}, but local log commit failed: ${detail}. ` +
        "Automatic retry is blocked pending recovery."
    );
  }
  return { posted: payload.id };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const slot = getNumberOption(args, "slot");
  const slots = slot ? [slot] : [1, 2, 3];
  for (const target of slots) {
    try {
      const result = await postFirstComment({ date, slot: target, root: getOption(args, "root") });
      console.log(JSON.stringify({ slot: target, ...result }));
    } catch (error) {
      // Keep another tuple's valid comment independent of an uncertain prior
      // tuple, but make the failed local commit visible to the scheduler.
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
