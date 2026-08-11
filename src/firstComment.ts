import { getNumberOption, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { loadDailyContent, loadPostLog, readJsonFile, writeJsonAtomic } from "./logging";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";
import { join } from "node:path";

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

function commentTextFor(topic: string): string {
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
  return `${tip} 直接點這裡問:${SITE}/go/line.html?source=ig-comment(或加 LINE:0968327653)`;
}

export async function postFirstComment(input: {
  date: string;
  slot: number;
  root?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ posted?: string; skipped?: string }> {
  const root = projectRoot(input.root);
  const config = getConfig();
  const fetchImpl = input.fetchImpl ?? fetch;

  const logPath = join(root, "data", "first-comments", `${input.date}.json`);
  const existing = await readJsonFile<FirstCommentLog[]>(logPath, []);
  if (existing.some((entry) => entry.slot === input.slot)) {
    return { skipped: `already commented on ${input.date} slot ${input.slot}` };
  }

  const posts = await loadPostLog(input.date, root);
  const live = posts.find(
    (post) =>
      post.slot === input.slot &&
      post.platform === "instagram" &&
      !post.dry_run &&
      ["success", "posted"].includes(post.status) &&
      post.post_id
  );
  if (!live?.post_id) return { skipped: `no live Instagram post for slot ${input.slot}` };
  if (config.dryRun) return { skipped: "dry run" };

  const content = await loadDailyContent(input.date, root);
  const topic = content?.slots.find((item) => item.slot === input.slot)?.topic ?? "";

  const response = await fetchImpl(
    `https://graph.facebook.com/${config.graphApiVersion}/${live.post_id}/comments`,
    {
      method: "POST",
      body: new URLSearchParams({
        message: commentTextFor(topic),
        access_token: config.metaAccessToken ?? ""
      })
    }
  );
  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(`First comment failed: ${payload.error?.message ?? response.status}`);
  }

  await writeJsonAtomic(logPath, [
    ...existing,
    {
      date: input.date,
      slot: input.slot,
      media_id: live.post_id,
      comment_id: payload.id,
      created_at: new Date().toISOString()
    }
  ]);
  return { posted: payload.id };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = getConfig();
  const date = getOption(args, "date") ?? getZonedDateParts(new Date(), config.timezone).date;
  const slot = getNumberOption(args, "slot");
  const slots = slot ? [slot] : [1, 2, 3];
  for (const target of slots) {
    const result = await postFirstComment({ date, slot: target, root: getOption(args, "root") });
    console.log(JSON.stringify({ slot: target, ...result }));
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
