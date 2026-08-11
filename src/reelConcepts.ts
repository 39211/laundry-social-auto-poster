import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { getFlag, getOption, isMain } from "./cli";
import { getConfig } from "./config";
import { projectRoot } from "./paths";
import { getZonedDateParts } from "./scheduler";

// The concept list is the thing that gets iterated, so it lives in code where a
// change is reviewable and a regeneration can be scoped to one concept. Chasing
// a weak Reel by regenerating all twelve stills wastes the eleven that worked.
//
// Scripts are in docs/reels-concepts.md. This carries what the pipeline needs:
// which stills belong to which concept, and what each still is meant to show.

export interface ReelConcept {
  id: string;
  object_type: string;
  hook: string;
  close: string;
  /**
   * Spoken from 0.5s while the hook is burned in as a subtitle for the first
   * 2.6 seconds. It therefore must not restate the hook: the viewer would read
   * and hear the same sentence at once, which spends the only seconds that
   * decide whether they keep watching. It continues the thought instead.
   */
  narration: string;
  before_subject: string;
  after_subject: string;
}

export const REEL_CONCEPTS: ReelConcept[] = [
  {
    id: "white-shoe-yellowing",
    object_type: "white-shoe",
    hook: "白鞋泛黃，不是刷得不夠用力",
    close: "台中收送，拍給我們看能不能救",
    narration:
      "問題多半在中底和鞋邊，那裡是材質在氧化。越用力刷，布面越容易起毛。",
    before_subject:
      "one pair of unbranded white sneakers, midsole edge and rubber trim visibly greyed and yellowed",
    after_subject:
      "the same sneakers, same position, midsole and trim clean, canvas still showing normal wear"
  },
  {
    id: "handbag-handle",
    object_type: "handbag",
    hook: "包包最先變舊的地方，是提把",
    close: "提把開始發黏就可以私訊我們",
    narration:
      "那不是灰塵，是手汗一天一天堆起來的。等到摸起來發黏，就比較難救了。",
    before_subject:
      "one everyday unbranded handbag, the handle darkened and slightly glossy where it is gripped",
    after_subject: "the same handbag, same position, handle restored to matte even colour"
  },
  {
    id: "leather-shoe-rain",
    object_type: "leather-shoe",
    hook: "皮鞋淋雨，擦乾就沒事了嗎",
    close: "別急著上油，先拍給我們看",
    narration:
      "水痕通常過幾天才浮出來。這時候上油，等於把它鎖進皮裡面。",
    before_subject: "one pair of unbranded leather dress shoes, faint dried rain marks across both vamps",
    after_subject: "the same shoes, same position, rain marks gone, leather evenly toned and not glossy"
  },
  {
    id: "plush-doll",
    object_type: "plush-doll",
    hook: "娃娃不是不能洗，是不能亂洗",
    close: "家裡有不敢洗的娃娃？私訊我們",
    narration: "怕的不是水，是脫水那一段。填充會結塊，黏上去的五官也可能掉。",
    before_subject: "one unbranded plush toy, fur flattened and dulled grey",
    after_subject: "the same toy, same position, fur lifted and clean, stitching and features unchanged"
  },
  {
    id: "duvet-storage",
    object_type: "duvet",
    hook: "棉被收進櫃子前，先聞一下",
    close: "換季前想清一次？台中收送",
    narration:
      "摸起來乾，中間那層不一定乾。帶著濕氣收進去，下一季就是那個味道。",
    before_subject:
      "one folded duvet with a fabric storage bag beside it, cover slightly limp and dull",
    after_subject: "the same duvet, same position, cover clean and evenly pressed"
  },
  {
    id: "leather-bag-corner",
    object_type: "leather-bag",
    hook: "精品包最怕的不是髒，是邊角",
    close: "邊角開始磨就該處理了",
    narration: "邊油磨掉就補不回來了。能處理的時間，比大部分人想的短很多。",
    before_subject: "a close view of one unbranded leather bag corner, edge coating worn and abraded",
    after_subject: "the same corner, same angle, edge treated and even, wear honestly reduced not erased"
  },

  // Batch two. Produced during batch one's run so 2026-08-04 follows without a
  // gap, and drawn from six more of the shop's real service pages so no object
  // type repeats across twelve days.
  {
    id: "shirt-collar",
    object_type: "shirt",
    hook: "襯衫領口發黃，洗衣精加倍沒有用",
    close: "領口開始黃就可以私訊我們",
    narration: "那不是沒洗乾淨，是皮脂氧化了。加倍的洗衣精只會把布洗薄。",
    before_subject: "one white dress shirt laid flat, collar band and inner collar edge yellowed",
    after_subject: "the same shirt, same position, collar even and clean, fabric still showing normal wear"
  },
  {
    id: "suit-shoulder",
    object_type: "suit",
    hook: "西裝變形，通常從肩線開始",
    close: "收起來前想檢查？台中收送",
    narration: "掛錯衣架、擠在衣櫃裡，肩襯塌下去就回不來了。那比髒更難處理。",
    before_subject: "one suit jacket on a padded hanger, shoulder line collapsed and lapel edge creased",
    after_subject: "the same jacket, same hanger and position, shoulder line restored and lapel flat"
  },
  {
    id: "curtain-hem",
    object_type: "curtain",
    hook: "窗簾最髒的地方，你可能沒看過",
    close: "整片窗簾不用自己拆，我們收",
    narration: "下緣那一折，灰塵和濕氣都積在裡面。摸起來乾，味道其實藏在那裡。",
    before_subject: "the lower hem section of one curtain panel spread on the counter, dust ingrained along the fold",
    after_subject: "the same hem section, same position, dust removed and fabric evenly toned"
  },
  {
    id: "luggage-wheel",
    object_type: "luggage",
    hook: "行李箱收進櫃子前，先看輪子",
    close: "旅行回來想清一次？私訊我們",
    narration: "輪子和底板整趟旅程都在地上磨。帶著那些灰收進櫃子，下次就是那個味道。",
    before_subject: "one fabric suitcase on a floor mat, wheels and lower panel visibly grimy",
    after_subject: "the same suitcase, same position, wheels and lower panel clean, fabric still worn"
  },
  {
    id: "backpack-base",
    object_type: "backpack",
    hook: "後背包底部，是全包最髒的一面",
    close: "背了一年沒洗過？私訊我們",
    narration: "它天天放在地上，卻幾乎沒人洗過。背帶的汗和底部的灰，是兩種不同的髒。",
    before_subject: "one fabric backpack tipped to show its base, ground grime across the bottom panel",
    after_subject: "the same backpack, same angle, base panel clean, straps and fabric still worn"
  },
  {
    id: "canvas-shoe-mud",
    object_type: "canvas-shoe",
    hook: "帆布鞋沾泥，越用力刷越糟",
    close: "沾到泥先別刷，拍給我們看",
    narration: "濕的時候刷，泥會被推進織紋裡，布面也會起毛。等乾了再處理反而好救。",
    before_subject: "one pair of canvas shoes with dried mud worked into the woven fabric",
    after_subject: "the same shoes, same position, mud gone, canvas texture intact and not fluffed"
  }
];

// The batch the schedule is currently publishing. Production runs one batch
// ahead: while these six publish, the next six are being made.
export const BATCH_ONE = REEL_CONCEPTS.slice(0, 6).map((concept) => concept.id);
export const BATCH_TWO = REEL_CONCEPTS.slice(6).map((concept) => concept.id);

// ---------------------------------------------------------------------------
// Extension concepts, authored as data so the pipeline keeps running without
// anyone editing code. The morning agent (Codex) writes new batches into
// data/reel-concepts-extension.json when the runway warning fires; this loader
// admits an entry only when it satisfies every rule the built-in concepts are
// tested against, and silently-but-loggedly rejects the rest. A bad or missing
// extension file leaves the built-in schedule untouched: extensions can add
// days, never break them.
interface ExtensionFile {
  concepts?: unknown[];
  schedule?: unknown[];
}

export interface ExtensionReport {
  accepted_concepts: string[];
  accepted_dates: string[];
  rejected: string[];
}

function isSafeConcept(entry: unknown, existingIds: Set<string>): entry is ReelConcept {
  if (typeof entry !== "object" || entry === null) return false;
  const c = entry as Record<string, unknown>;
  const strings = ["id", "object_type", "hook", "close", "narration", "before_subject", "after_subject"];
  if (!strings.every((key) => typeof c[key] === "string" && (c[key] as string).length > 0)) return false;
  if (!/^[a-z0-9-]{3,40}$/.test(c.id as string)) return false;
  if (existingIds.has(c.id as string)) return false;
  const hook = c.hook as string;
  const narration = c.narration as string;
  if (hook.length < 7 || hook.length > 20) return false;
  if ((c.close as string).length < 7 || narration.length < 21 || narration.length > 36) return false;
  // The narration must continue the hook, not restate it (it plays while the
  // hook is on screen as a subtitle).
  const hookBody = hook.replace(/[，。？、]/g, "");
  const narrationBody = narration.replace(/[，。？、]/g, "");
  for (let length = 5; length <= hookBody.length; length += 1) {
    if (narrationBody.includes(hookBody.slice(0, length))) return false;
  }
  return true;
}

export function loadExtensions(root = projectRoot()): ExtensionReport {
  const report: ExtensionReport = { accepted_concepts: [], accepted_dates: [], rejected: [] };
  let parsed: ExtensionFile;
  try {
    parsed = JSON.parse(
      readFileSync(join(root, "data", "reel-concepts-extension.json"), "utf8").replace(/^﻿/, "")
    ) as ExtensionFile;
  } catch {
    return report; // no file or unreadable: built-ins stand alone
  }

  const ids = new Set(REEL_CONCEPTS.map((concept) => concept.id));
  for (const entry of parsed.concepts ?? []) {
    if (isSafeConcept(entry, ids)) {
      REEL_CONCEPTS.push(entry);
      ids.add(entry.id);
      report.accepted_concepts.push(entry.id);
    } else {
      report.rejected.push(`concept:${JSON.stringify(entry).slice(0, 60)}`);
    }
  }

  // Schedule entries must extend the run day by day, never rewrite it: each
  // accepted date is exactly one day after the current last date, names a
  // known concept, and never repeats the previous day's object type.
  for (const entry of parsed.schedule ?? []) {
    const item = entry as { date?: unknown; conceptId?: unknown };
    const last = REEL_SCHEDULE[REEL_SCHEDULE.length - 1];
    const expected = new Date(Date.parse(`${last?.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const concept = REEL_CONCEPTS.find((c) => c.id === item.conceptId);
    const lastConcept = REEL_CONCEPTS.find((c) => c.id === last?.conceptId);
    const scheduledIds = new Set(REEL_SCHEDULE.map((s) => s.conceptId));
    if (
      typeof item.date === "string" &&
      item.date === expected &&
      concept &&
      !scheduledIds.has(concept.id) &&
      concept.object_type !== lastConcept?.object_type
    ) {
      REEL_SCHEDULE.push({ date: item.date, conceptId: concept.id });
      report.accepted_dates.push(item.date);
    } else {
      report.rejected.push(`schedule:${JSON.stringify(entry).slice(0, 60)}`);
    }
  }

  return report;
}

// Which day each concept publishes. This lives beside the concepts because
// production order has to follow it: daily production must always build the
// one that runs out first, not the next one in the list. The two orders are
// deliberately different — publishing alternates object types so consecutive
// days do not look alike — so following the list would build the least urgent
// concept first and a single failed day would land on a publishing date.
export const REEL_SCHEDULE: Array<{ date: string; conceptId: string }> = [
  { date: "2026-07-29", conceptId: "leather-bag-corner" },
  // 07-30, 07-31 and 08-01 were lost to morning rewrites of the calendar (the
  // last one bypassed the preservation guard by writing the file directly;
  // --heal now restores the slot before approval and publishing). Every lost
  // Reel moves to the end of the run instead of being thrown away.
  { date: "2026-08-02", conceptId: "handbag-handle" },
  { date: "2026-08-03", conceptId: "duvet-storage" },
  // 08-04 and 08-05 were lost to a midnight automation that disabled the
  // publish task and pushed its own off-plan content; both finished Reels move
  // to the end of the run, the same salvage as the three losses before them.
  { date: "2026-08-06", conceptId: "canvas-shoe-mud" },
  { date: "2026-08-07", conceptId: "suit-shoulder" },
  { date: "2026-08-08", conceptId: "backpack-base" },
  { date: "2026-08-09", conceptId: "curtain-hem" },
  { date: "2026-08-10", conceptId: "plush-doll" },
  { date: "2026-08-11", conceptId: "leather-shoe-rain" },
  { date: "2026-08-12", conceptId: "white-shoe-yellowing" },
  { date: "2026-08-13", conceptId: "shirt-collar" },
  { date: "2026-08-14", conceptId: "luggage-wheel" }
];

export function publishDateFor(conceptId: string): string | undefined {
  return REEL_SCHEDULE.find((entry) => entry.conceptId === conceptId)?.date;
}

// ---------------------------------------------------------------------------
// Mid-video treatments for 2026-08-12..14 watch-time A/B/C.
// Plan file: data/mid-treatment-plan.json maps date → "A"|"B"|"C".
// Missing plan falls back to the current three-act layout and warns.
// ---------------------------------------------------------------------------

export type MidTreatmentCode = "A" | "B" | "C";
export type MidTreatment = MidTreatmentCode | "none";

export interface MidTreatmentSelection {
  date: string;
  treatment: MidTreatment;
  /** Filename suffix for attribution: -tA / -tB / -tC, or empty for none. */
  suffix: string;
  label: string;
  plan_found: boolean;
  warning?: string;
}

export interface TimelineAct {
  role: string;
  source: string;
  duration_s: number;
  start_s: number;
  end_s: number;
  notes: string;
}

export interface NarrationSegment {
  role: string;
  start_s: number;
  end_s: number;
  text: string;
}

export interface MidTreatmentStoryboard {
  date: string;
  concept_id: string;
  treatment: MidTreatment;
  suffix: string;
  label: string;
  total_duration_s: number;
  acts: TimelineAct[];
  narration_segments: NarrationSegment[];
  narration_full: string;
  warning?: string;
  text: string;
}

const MID_TREATMENT_LABELS: Record<MidTreatment, string> = {
  A: "判斷答案型(旁白重排,第4-6秒職人判斷,三幕4/6/4)",
  B: "結果前置型(幕序 before3→after4→middle4→after3回味)",
  C: "特寫快切型(中段2-3個快切特寫,旁白不變)",
  none: "現行三幕(before5→middle5→after5,無治療)"
};

export function treatmentSuffix(treatment: MidTreatment): string {
  if (treatment === "A") return "-tA";
  if (treatment === "B") return "-tB";
  if (treatment === "C") return "-tC";
  return "";
}

function isMidTreatmentCode(value: unknown): value is MidTreatmentCode {
  return value === "A" || value === "B" || value === "C";
}

/**
 * Load date→treatment map. Returns null when the plan file is missing or unreadable
 * (callers must fall back to the current three-act layout and warn).
 */
export function loadMidTreatmentPlan(root = projectRoot()): Record<string, MidTreatmentCode> | null {
  try {
    const raw = readFileSync(join(root, "data", "mid-treatment-plan.json"), "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const out: Record<string, MidTreatmentCode> = {};
    for (const [date, code] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && isMidTreatmentCode(code)) {
        out[date] = code;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Select mid-video treatment for a calendar date.
 * Mutation contract: date 2026-08-13 → B when plan present; missing plan → none + warning.
 */
export function selectMidTreatment(date: string, root = projectRoot()): MidTreatmentSelection {
  const plan = loadMidTreatmentPlan(root);
  if (!plan) {
    return {
      date,
      treatment: "none",
      suffix: "",
      label: MID_TREATMENT_LABELS.none,
      plan_found: false,
      warning: "mid-treatment-plan.json missing or unreadable; falling back to current three-act layout"
    };
  }
  const code = plan[date];
  if (!code) {
    return {
      date,
      treatment: "none",
      suffix: "",
      label: MID_TREATMENT_LABELS.none,
      plan_found: true,
      warning: `No mid-treatment entry for ${date}; falling back to current three-act layout`
    };
  }
  return {
    date,
    treatment: code,
    suffix: treatmentSuffix(code),
    label: MID_TREATMENT_LABELS[code],
    plan_found: true
  };
}

/** Split narration on sentence boundaries (Chinese full stop / Latin period). */
export function splitNarrationSentences(narration: string): string[] {
  const trimmed = narration.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[。！？.!?])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return [trimmed];
  return parts;
}

/**
 * Core craftsman judgment pulled from narration for treatment A.
 * Prefer the first sentence (diagnostic); fall back to the whole line.
 */
export function extractJudgmentSentence(narration: string): string {
  const parts = splitNarrationSentences(narration);
  return parts[0] ?? narration;
}

/**
 * Rearrange spoken text for a treatment. A: judgment first (lands in 4–6s window
 * when timed); B: result/consequence first then cause; C/none: original order.
 */
export function narrationForTreatment(narration: string, treatment: MidTreatment): {
  full: string;
  judgment: string;
  remainder: string;
  segments_plain: string[];
} {
  const parts = splitNarrationSentences(narration);
  const judgment = parts[0] ?? narration;
  const remainder = parts.slice(1).join("");

  if (treatment === "A") {
    // Judgment answer: speak the diagnostic first so assembly can place it at 4–6s.
    const full = [judgment, remainder].filter(Boolean).join("");
    return { full: full || narration, judgment, remainder, segments_plain: [judgment, remainder].filter(Boolean) };
  }
  if (treatment === "B") {
    // Result-first: put consequence/result phrasing ahead of the cause when two+ sentences.
    if (parts.length >= 2) {
      const reordered = [...parts.slice(1), parts[0]!].join("");
      return {
        full: reordered,
        judgment,
        remainder,
        segments_plain: [...parts.slice(1), parts[0]!]
      };
    }
    return { full: narration, judgment, remainder: "", segments_plain: [narration] };
  }
  // C and none: narration unchanged
  return { full: narration, judgment, remainder, segments_plain: parts.length > 0 ? parts : [narration] };
}

function buildActsForTreatment(treatment: MidTreatment): TimelineAct[] {
  if (treatment === "A") {
    return [
      { role: "before", source: "before", duration_s: 4, start_s: 0, end_s: 4, notes: "問題入場,鏡頭推進到磨損處" },
      {
        role: "middle",
        source: "middle",
        duration_s: 6,
        start_s: 4,
        end_s: 10,
        notes: "職人處理中;第4-6秒播核心判斷句"
      },
      { role: "after", source: "after", duration_s: 4, start_s: 10, end_s: 14, notes: "結果落定" }
    ];
  }
  if (treatment === "B") {
    return [
      { role: "before", source: "before", duration_s: 3, start_s: 0, end_s: 3, notes: "問題快閃" },
      { role: "after_first", source: "after", duration_s: 4, start_s: 3, end_s: 7, notes: "結果前置" },
      { role: "middle", source: "middle", duration_s: 4, start_s: 7, end_s: 11, notes: "過程回看" },
      { role: "after_echo", source: "after", duration_s: 3, start_s: 11, end_s: 14, notes: "結果回味" }
    ];
  }
  if (treatment === "C") {
    return [
      { role: "before", source: "before", duration_s: 4, start_s: 0, end_s: 4, notes: "問題入場" },
      {
        role: "middle_cu1",
        source: "middle",
        duration_s: 2,
        start_s: 4,
        end_s: 6,
        notes: "特寫快切1:裁中上區放大(ffmpeg crop+scale)"
      },
      {
        role: "middle_cu2",
        source: "middle",
        duration_s: 2,
        start_s: 6,
        end_s: 8,
        notes: "特寫快切2:裁中央區放大"
      },
      {
        role: "middle_cu3",
        source: "middle",
        duration_s: 1.5,
        start_s: 8,
        end_s: 9.5,
        notes: "特寫快切3:裁中下接觸點放大"
      },
      { role: "after", source: "after", duration_s: 4.5, start_s: 9.5, end_s: 14, notes: "結果落定" }
    ];
  }
  // Current three-act control (matches assemble-reel.ps1 ~5+5+5 with dissolves)
  return [
    { role: "before", source: "before", duration_s: 5, start_s: 0, end_s: 5, notes: "現行第一幕" },
    { role: "middle", source: "middle", duration_s: 5, start_s: 5, end_s: 10, notes: "現行中段" },
    { role: "after", source: "after", duration_s: 5, start_s: 10, end_s: 15, notes: "現行結果幕" }
  ];
}

function buildNarrationSegments(
  narration: string,
  treatment: MidTreatment
): { segments: NarrationSegment[]; full: string } {
  const rearranged = narrationForTreatment(narration, treatment);

  if (treatment === "A") {
    // Judgment lands in the critical 4–6s retention window; remainder after.
    const segments: NarrationSegment[] = [
      { role: "judgment", start_s: 4, end_s: 6, text: rearranged.judgment }
    ];
    if (rearranged.remainder) {
      segments.push({ role: "follow", start_s: 6, end_s: 10, text: rearranged.remainder });
    }
    return { segments, full: rearranged.full };
  }

  if (treatment === "B") {
    const segments: NarrationSegment[] = [];
    const plain = rearranged.segments_plain;
    // Align TTS beats with the four visual acts: open / result / process / echo.
    if (plain.length >= 2) {
      segments.push({ role: "result", start_s: 3, end_s: 7, text: plain[0]! });
      segments.push({ role: "cause", start_s: 7, end_s: 11, text: plain.slice(1).join("") });
    } else {
      segments.push({ role: "full", start_s: 0.5, end_s: 12, text: rearranged.full });
    }
    return { segments, full: rearranged.full };
  }

  // C and none: single narration starting at 0.5s (assemble-reel adelay)
  return {
    segments: [{ role: "full", start_s: 0.5, end_s: 12, text: rearranged.full }],
    full: rearranged.full
  };
}

export function buildMidTreatmentStoryboard(input: {
  date: string;
  concept: ReelConcept;
  treatment?: MidTreatment;
  root?: string;
}): MidTreatmentStoryboard {
  const root = input.root ?? projectRoot();
  const selection =
    input.treatment !== undefined
      ? {
          date: input.date,
          treatment: input.treatment,
          suffix: treatmentSuffix(input.treatment),
          label: MID_TREATMENT_LABELS[input.treatment],
          plan_found: true as boolean,
          warning: undefined as string | undefined
        }
      : selectMidTreatment(input.date, root);

  const acts = buildActsForTreatment(selection.treatment);
  const { segments, full } = buildNarrationSegments(input.concept.narration, selection.treatment);
  const total = acts.length > 0 ? acts[acts.length - 1]!.end_s : 0;

  const lines: string[] = [
    `# Mid-treatment storyboard`,
    `date: ${input.date}`,
    `concept: ${input.concept.id}`,
    `treatment: ${selection.treatment}`,
    `suffix: ${selection.suffix || "(none)"}`,
    `label: ${selection.label}`,
    selection.warning ? `warning: ${selection.warning}` : "",
    `total_duration_s: ${total}`,
    ``,
    `## Acts (visual)`,
    ...acts.map(
      (act, i) =>
        `${i + 1}. [${act.start_s.toFixed(1)}–${act.end_s.toFixed(1)}s] ${act.role} ← ${act.source} (${act.duration_s}s) — ${act.notes}`
    ),
    ``,
    `## Narration timeline`,
    `full: ${full}`,
    ...segments.map(
      (seg) =>
        `- [${seg.start_s.toFixed(1)}–${seg.end_s.toFixed(1)}s] (${seg.role}) ${seg.text}`
    ),
    ``,
    `## Hook / close (subtitles, unchanged)`,
    `hook: ${input.concept.hook}`,
    `close: ${input.concept.close}`,
    ``,
    `## Attribution`,
    `mp4 suffix: ${selection.suffix || "(scheduleReel standard name only)"}`,
    `manifest field: treatment=${selection.treatment}`
  ].filter((line) => line !== undefined);

  return {
    date: input.date,
    concept_id: input.concept.id,
    treatment: selection.treatment,
    suffix: selection.suffix,
    label: selection.label,
    total_duration_s: total,
    acts,
    narration_segments: segments,
    narration_full: full,
    warning: selection.warning,
    text: lines.join("\n")
  };
}

/**
 * Dry-run: write one storyboard+narration timeline file per treatment day
 * into output/mid-test/ for human review.
 */
export function writeMidTestTimelines(root = projectRoot()): string[] {
  const outDir = join(root, "output", "mid-test");
  mkdirSync(outDir, { recursive: true });

  const days: Array<{ date: string; treatment: MidTreatmentCode }> = [
    { date: "2026-08-12", treatment: "A" },
    { date: "2026-08-13", treatment: "B" },
    { date: "2026-08-14", treatment: "C" }
  ];

  const written: string[] = [];
  for (const day of days) {
    const scheduled = REEL_SCHEDULE.find((entry) => entry.date === day.date);
    const concept =
      REEL_CONCEPTS.find((c) => c.id === scheduled?.conceptId) ?? REEL_CONCEPTS[0]!;
    const board = buildMidTreatmentStoryboard({
      date: day.date,
      concept,
      treatment: day.treatment,
      root
    });
    const fileName = `${day.date}-t${day.treatment}-${concept.id}.txt`;
    const path = join(outDir, fileName);
    writeFileSync(path, board.text, "utf8");
    written.push(path);
  }
  return written;
}

export interface ProductionRunway {
  today: string;
  last_scheduled_date: string;
  days_of_runway: number;
  scheduled_unproduced: number;
  needs_new_concepts: boolean;
}

/**
 * How many more days of Reels are scheduled. Production goes quiet once every
 * concept is built, and a quiet daily task looks exactly like a healthy one, so
 * the runway is reported rather than inferred from silence: writing six more
 * concepts takes a sitting, but only if someone knows it is due.
 */
export async function productionRunway(
  today: string,
  root = projectRoot(),
  // The schedule holds 12 entries, so a threshold of 14 made the warning fire
  // on every run from day one -- indistinguishable noise, which is the exact
  // failure this warning exists to prevent. Five days is enough time to write,
  // produce and review a new batch before the schedule runs dry.
  warnBelowDays = 5
): Promise<ProductionRunway> {
  const remaining = REEL_SCHEDULE.filter((entry) => entry.date >= today);
  const last = REEL_SCHEDULE[REEL_SCHEDULE.length - 1]?.date ?? today;

  let unproduced = 0;
  for (const entry of remaining) {
    try {
      await access(join(root, "output", "reels-run", "2026-07-29", "reels", `${entry.conceptId}.mp4`));
    } catch {
      unproduced += 1;
    }
  }

  return {
    today,
    last_scheduled_date: last,
    days_of_runway: remaining.length,
    scheduled_unproduced: unproduced,
    needs_new_concepts: remaining.length < warnBelowDays
  };
}

// Kept identical across every still so that separate generation sessions still
// cut together, and so that a single regenerated still drops back into a pair
// without the join showing.
// Three acts have to look like one shop. They did not: before and after were
// square photos on a tiled floor with metal racks, while the middle act was
// generated separately as a 4:5 portrait on a pink cutting mat against a white
// slat wall -- a different counter, a different room, and for the white-shoe
// reel a different pair of shoes, leather in two acts and canvas in the third.
// Fourteen seconds in which the object changes identity is most of what "it
// doesn't look real" means. The scene is now stated once, in the aspect the
// reel is actually cut to, and every act is generated from it.
const SHOP_SCENE =
  "a Taiwanese laundry and shoe-care shop: a light counter with a pink cutting mat, white slat-wall " +
  "panels behind, shelves of fabric-care bottles softly out of focus, everyday clutter at the frame edge. " +
  "Shot on a phone main camera at about 26mm equivalent, held at chest height and angled 20-35 degrees " +
  "down at the counter, handheld with imperfect framing. The storefront window is the key light from one " +
  "side, weak fluorescent ceiling fill, uneven brightness across the counter, slightly imperfect auto " +
  "white balance, phone sensor noise in the deep shadows only. The item rests fully on the surface with a " +
  "continuous hard contact shadow. Not cinematic, not studio lighting, no film grain, no film colour " +
  "grade, no creamy background blur, no waxy surfaces, no readable text, no logo, no watermark, no faces.";

export const SHARED_STILL_PROMPT =
  `Ordinary portrait 4:5 shop photo. [SUBJECT] on the inspection counter of ${SHOP_SCENE} ` +
  "The item fills 45-65% of the frame height and stays sharp; the background is readable, not blurred away.";

// The middle act is the one most likely to drift, because it is the only one
// with a hand and a tool in it. Generating it by editing the before image --
// the same route that already keeps before and after consistent -- is what
// holds the object, counter, background and light identical across the cut.
export const MIDDLE_STILL_PROMPT =
  "Edit the supplied BEFORE image, do not generate a new scene. Keep the same camera position, the same " +
  "counter, the same background, the same light direction and the same white balance. The item must be " +
  "the SAME physical object: same material, same colour, same laces or fittings, same wear marks. " +
  "Add one adult hand entering from the right holding a soft-bristle brush, the brush in contact with " +
  "[WEAR_LOCATION], a small wet cleaned patch already visible at that exact spot, and the rest of the " +
  "item still in its BEFORE condition. Fingers anatomically correct: five fingers, no fusing, no second " +
  "hand. Portrait 4:5. No readable text, no logo, no watermark, no faces.";

export function stillPathsFor(concept: ReelConcept): { before: string; after: string } {
  return {
    before: `data/reference-photos/${concept.object_type}/${concept.id}-before.png`,
    after: `data/reference-photos/${concept.object_type}/${concept.id}-after.png`
  };
}

export function promptFor(concept: ReelConcept, state: "before" | "after"): string {
  const subject = state === "before" ? concept.before_subject : concept.after_subject;
  return SHARED_STILL_PROMPT.replace("[SUBJECT]", subject);
}

export interface ConceptStatus {
  id: string;
  object_type: string;
  hook: string;
  close: string;
  narration: string;
  publish_date?: string;
  has_before: boolean;
  has_after: boolean;
  ready: boolean;
}

export async function conceptStatuses(root = projectRoot()): Promise<ConceptStatus[]> {
  const statuses: ConceptStatus[] = [];

  for (const concept of REEL_CONCEPTS) {
    const paths = stillPathsFor(concept);
    const exists = async (relative: string) => {
      try {
        await access(join(root, ...relative.split("/")));
        return true;
      } catch {
        return false;
      }
    };
    const hasBefore = await exists(paths.before);
    const hasAfter = await exists(paths.after);
    statuses.push({
      id: concept.id,
      object_type: concept.object_type,
      hook: concept.hook,
      close: concept.close,
      narration: concept.narration,
      publish_date: publishDateFor(concept.id),
      has_before: hasBefore,
      has_after: hasAfter,
      ready: hasBefore && hasAfter
    });
  }

  // Production order is deadline order. An unscheduled concept sorts last: it
  // has no date to miss.
  return statuses.sort((a, b) => (a.publish_date ?? "9999").localeCompare(b.publish_date ?? "9999"));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = getOption(args, "concept");
  const wantPrompts = getFlag(args, "prompts");
  const wantMidTest = getFlag(args, "mid-test");
  const selectDate = getOption(args, "select-treatment");
  const root = projectRoot(getOption(args, "root"));

  // Dry-run: three storyboard+narration timelines for human review.
  if (wantMidTest) {
    const written = writeMidTestTimelines(root);
    console.log(
      JSON.stringify(
        {
          mode: "mid-test",
          files: written.map((path) => path.replace(/\\/g, "/")),
          plan: loadMidTreatmentPlan(root)
        },
        null,
        2
      )
    );
    return;
  }

  // Mutation/self-check helper: print treatment selection for one date.
  if (selectDate) {
    const selection = selectMidTreatment(selectDate, root);
    console.log(JSON.stringify(selection, null, 2));
    return;
  }

  const extensions = loadExtensions(root);
  const statuses = await conceptStatuses(root);
  const selected = only ? REEL_CONCEPTS.filter((concept) => concept.id === only) : REEL_CONCEPTS;
  if (only && selected.length === 0) {
    throw new Error(`Unknown concept: ${only}. Known: ${REEL_CONCEPTS.map((c) => c.id).join(", ")}`);
  }

  if (wantPrompts) {
    // Regenerating one concept is the normal iteration, so the prompts print
    // per concept rather than as one undifferentiated batch.
    for (const concept of selected) {
      const paths = stillPathsFor(concept);
      console.log(`\n=== ${concept.id} (${concept.object_type}) ===`);
      console.log(`hook: ${concept.hook}`);
      console.log(`\n[before] -> ${paths.before}\n${promptFor(concept, "before")}`);
      console.log(`\n[after]  -> ${paths.after}\n${promptFor(concept, "after")}`);
    }
    return;
  }

  const today = getOption(args, "today") ?? getZonedDateParts(new Date(), getConfig().timezone).date;
  console.log(
    JSON.stringify(
      {
        total: statuses.length,
        ready: statuses.filter((status) => status.ready).length,
        runway: await productionRunway(today, root),
        extensions,
        mid_treatment: selectMidTreatment(today, root),
        concepts: only ? statuses.filter((status) => status.id === only) : statuses
      },
      null,
      2
    )
  );
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
