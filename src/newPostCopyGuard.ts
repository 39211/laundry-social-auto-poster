/**
 * 2026-11-05 起的新貼文（標題與正文）不得再帶功效向「除霉」、標準以外的「防水」。
 * 免費收送只允許「免費收送」；「台中全市」禁止出現。全站舊句另票替換，這道閘門不改歷史檔。
 * 更早的日曆、r6 檔與已上線歷史頁不在這道閘門裡。
 */

export const APPROVED_FREE_PICKUP_PHRASE = "免費收送";
const BANNED_CITYWIDE_PHRASE = "台中全市";

/** 含這天。更早的 date 直接放行。 */
export const NEW_POST_COPY_GUARD_FROM = "2026-11-05";

/** 「防水」只允許包在這兩個寫法裡。防潑水本身不含「防水」，仍先剝掉以免誤判。 */
const WATERPROOF_ALLOWED = ["防潑水", "防水透氣鞋"] as const;

export type NewPostCopyField = "title" | "body";
export type NewPostCopyRule = "除霉" | "防水" | "免費" | "台中全市";

export interface NewPostCopyViolation {
  rule: NewPostCopyRule;
  field: NewPostCopyField;
  excerpt: string;
}

export interface NewPostCopyInput {
  /** 缺日期時視為新貼文，避免漏傳日期就繞過。 */
  date?: string;
  title?: string;
  body?: string;
}

export function isNewPostCopyGuardDate(date: string | undefined): boolean {
  if (!date) return true;
  return date >= NEW_POST_COPY_GUARD_FROM;
}

function excerptAround(text: string, needle: string): string {
  const index = text.indexOf(needle);
  if (index < 0) return needle;
  const start = Math.max(0, index - 8);
  const end = Math.min(text.length, index + needle.length + 8);
  return text.slice(start, end).replace(/\s+/gu, " ");
}

export function findNewPostCopyViolations(text: string, field: NewPostCopyField): NewPostCopyViolation[] {
  const violations: NewPostCopyViolation[] = [];
  if (text.includes("除霉")) {
    violations.push({ rule: "除霉", field, excerpt: excerptAround(text, "除霉") });
  }

  let waterproof = text;
  for (const allowed of WATERPROOF_ALLOWED) {
    waterproof = waterproof.replaceAll(allowed, "");
  }
  if (waterproof.includes("防水")) {
    violations.push({ rule: "防水", field, excerpt: excerptAround(waterproof, "防水") });
  }

  if (text.includes(BANNED_CITYWIDE_PHRASE)) {
    violations.push({ rule: "台中全市", field, excerpt: excerptAround(text, BANNED_CITYWIDE_PHRASE) });
  }

  const withoutApprovedFree = text.replaceAll(APPROVED_FREE_PICKUP_PHRASE, "");
  if (withoutApprovedFree.includes("免費")) {
    violations.push({ rule: "免費", field, excerpt: excerptAround(withoutApprovedFree, "免費") });
  }

  return violations;
}

export function newPostCopyViolations(input: NewPostCopyInput): NewPostCopyViolation[] {
  if (!isNewPostCopyGuardDate(input.date)) return [];
  return [
    ...findNewPostCopyViolations(input.title ?? "", "title"),
    ...findNewPostCopyViolations(input.body ?? "", "body")
  ];
}

export function assertNewPostCopyAllowed(input: NewPostCopyInput): void {
  const violations = newPostCopyViolations(input);
  if (violations.length === 0) return;
  const detail = violations
    .map((item) => `${item.field} 含「${item.rule}」（${item.excerpt}）`)
    .join("；");
  throw new Error(
    `新貼文（${input.date ?? "未標日期"}）不可發佈禁用措辭。${detail}。除霉請改寫成發霉語境；防水只允許「防潑水」與品類名「防水透氣鞋」；免費只允許「${APPROVED_FREE_PICKUP_PHRASE}」，且不得出現「${BANNED_CITYWIDE_PHRASE}」。`
  );
}

export function assertDailySlotMayShip(
  date: string,
  slot: { topic?: string; facebook_caption?: string; instagram_caption?: string }
): void {
  assertNewPostCopyAllowed({
    date,
    title: slot.topic ?? "",
    body: `${slot.facebook_caption ?? ""}\n${slot.instagram_caption ?? ""}`
  });
}
