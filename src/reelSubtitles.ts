// Full-narration subtitles for Reels.
//
// The hook and close are burned by ffmpeg drawtext at the top of the frame,
// but the narration itself — the part that carries the craftsman's judgment —
// was audio-only. Most feed viewers watch muted, so for them the narration did
// not exist. This module turns one narration string plus the real TTS duration
// into an ASS subtitle file for the bottom of the 720x1280 frame.
//
// Three constraints shaped it, each learned from a defect found while trialing
// VideoForge-Pro's subtitle engine on our own footage (2026-08-16):
//
//  - Lossless splitting. A scratch splitter demonstrably lost one clause and
//    duplicated another on a 49-character narration. splitNarration therefore
//    treats "the segments joined back equal the whitespace-normalized input"
//    as an invariant and throws if it ever fails. Collapsing runs of
//    whitespace to a single space (then trim) is design behaviour: join()
//    reproduces that normalized source, not the raw caller string.
//  - Proportional timing. VideoForge divides duration evenly by segment count,
//    so a 17-character line and a 7-character line get the same seconds.
//    Timing here allocates by character share of the real audio duration.
//  - The frame we actually ship. Their PlayRes is hardcoded 1920x1080
//    landscape, which rendered illegibly small on our portrait reels. PlayRes
//    here is 720x1280 and the style is sized so a full line fits the width.

export const SUB_MAX_CHARS = 15;
// Orphan tolerance: a trailing clause of 1-2 characters may ride along past
// SUB_MAX_CHARS instead of becoming its own blink-length cue. 17 chars at
// fontsize 40 is 680px, inside the 720px frame with the style margins.
const ORPHAN_CHARS = 2;

export interface SubtitleCue {
  text: string;
  /** Seconds from video start. */
  start: number;
  end: number;
}

// Punctuation that can end a clause. Shared by CLAUSE_BREAK and
// LEADING_PUNCTUATION below so the two sets can never drift apart.
const CLAUSE_PUNCTUATION = "。！？!?，,、；;：:…";
const CLAUSE_BREAK = new RegExp(`(?<=[${CLAUSE_PUNCTUATION}])`, "u");
const LEADING_PUNCTUATION = new RegExp(`^[${CLAUSE_PUNCTUATION}]+`, "u");

/**
 * Push `finished` onto segments and return what should continue as the next
 * line. CJK line-breaking forbids punctuation from opening a line (行首禁則):
 * a hard-wrap can otherwise slice a clause right before its trailing comma,
 * leaving that comma to lead the next cue. When `rest` starts with
 * punctuation, pull it back onto the end of `finished` instead.
 */
function flushSegment(segments: string[], finished: string, rest: string): string {
  const leading = finished ? rest.match(LEADING_PUNCTUATION) : null;
  if (leading) {
    segments.push(finished + leading[0]);
    return rest.slice(leading[0].length);
  }
  if (finished) segments.push(finished);
  return rest;
}

/**
 * Split a narration into subtitle lines of at most maxChars characters,
 * breaking at punctuation where possible. Invariant: joining the returned
 * segments reproduces the whitespace-normalized source exactly (runs of
 * whitespace collapse to one space, then trim) — not the raw input.
 */
export function splitNarration(text: string, maxChars = SUB_MAX_CHARS): string[] {
  const src = text.replace(/\s+/gu, " ").trim();
  if (!src) return [];

  const clauses = src.split(CLAUSE_BREAK).filter((c) => c.length > 0);
  const segments: string[] = [];
  let current = "";
  for (const clause of clauses) {
    if (current && current.length + clause.length <= maxChars) {
      current += clause;
      continue;
    }
    current = flushSegment(segments, current, clause);
    // A single clause longer than a line hard-wraps; the tail stays current so
    // a following short clause can still pack onto it.
    while (current.length > maxChars) {
      current = flushSegment(segments, current.slice(0, maxChars), current.slice(maxChars));
    }
  }
  if (current) {
    // A 1-2 character tail on its own would flash for a fraction of a second;
    // let it ride on the previous line when the tolerance allows.
    const prev = segments[segments.length - 1];
    if (
      current.length <= ORPHAN_CHARS &&
      prev !== undefined &&
      prev.length + current.length <= maxChars + ORPHAN_CHARS
    ) {
      segments[segments.length - 1] = prev + current;
    } else {
      segments.push(current);
    }
  }

  const rejoined = segments.join("");
  if (rejoined !== src) {
    throw new Error(
      `splitNarration lost or duplicated text: ${rejoined.length} chars out vs ${src.length} in`
    );
  }
  return segments;
}

export interface TimingInput {
  /** Seconds before the first spoken word (the assembly's adelay). */
  delaySeconds: number;
  /** Real duration of the TTS file, from ffprobe — never estimated. */
  audioSeconds: number;
  /** When set and shorter than the cue chain, the whole timeline is scaled to fit. */
  videoSeconds?: number;
}

/**
 * Allocate the audio duration across segments proportionally to character
 * count, so long lines stay up longer. Cues are contiguous: each starts where
 * the previous ended, the first at delaySeconds, the last ending exactly at
 * delaySeconds + audioSeconds. If videoSeconds is shorter than that span,
 * the whole timeline is scaled so every cue still appears — no tail text is
 * dropped.
 */
export function timeSegments(segments: string[], input: TimingInput): SubtitleCue[] {
  if (segments.length === 0) return [];
  if (!(input.audioSeconds > 0)) {
    throw new Error(`audioSeconds must be positive, got ${input.audioSeconds}`);
  }
  const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
  const cues: SubtitleCue[] = [];
  let consumed = 0;
  for (const segment of segments) {
    const start = input.delaySeconds + (input.audioSeconds * consumed) / totalChars;
    consumed += segment.length;
    const end = input.delaySeconds + (input.audioSeconds * consumed) / totalChars;
    cues.push({ text: segment, start, end });
  }
  if (input.videoSeconds === undefined) return cues;
  const lastEnd = cues[cues.length - 1]!.end;
  if (!(lastEnd > input.videoSeconds)) return cues;
  const scale = input.videoSeconds / lastEnd;
  return cues.map((cue) => ({
    text: cue.text,
    start: cue.start * scale,
    end: cue.end * scale,
  }));
}

export interface AssOptions {
  playResX?: number;
  playResY?: number;
  fontSize?: number;
  marginV?: number;
}

function assTime(seconds: number): string {
  // Integer centiseconds via milliseconds so half-cs boundaries such as
  // 1.005 and 59.995 do not round the wrong way through float * 100.
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const totalCs = Math.round(ms / 10);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

function assText(text: string): string {
  // Braces open libass override blocks; narrations never legitimately contain
  // them, so map to full-width lookalikes rather than risking a style escape.
  return text.replace(/\{/gu, "（").replace(/\}/gu, "）").replace(/[\r\n]+/gu, " ");
}

/**
 * Render cues as an ASS file for the portrait reel frame. White text on a
 * semi-opaque black box (BorderStyle=3), bottom-centre, matching the look of
 * the drawtext hook at the top of the frame.
 */
export function buildAss(cues: SubtitleCue[], options: AssOptions = {}): string {
  const playResX = options.playResX ?? 720;
  const playResY = options.playResY ?? 1280;
  const fontSize = options.fontSize ?? 40;
  const marginV = options.marginV ?? 84;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Narration,Microsoft JhengHei,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H73000000,-1,0,0,0,100,100,0,0,3,6,0,2,20,20,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Narration,,0,0,0,,${assText(cue.text)}`
  );
  return [...header, ...events].join("\n") + "\n";
}

export interface NarrationAssInput extends TimingInput {
  narration: string;
  maxChars?: number;
  ass?: AssOptions;
}

/** One call from narration text to finished ASS content. */
export function narrationAss(input: NarrationAssInput): { ass: string; cues: SubtitleCue[] } {
  const segments = splitNarration(input.narration, input.maxChars ?? SUB_MAX_CHARS);
  const cues = timeSegments(segments, input);
  return { ass: buildAss(cues, input.ass), cues };
}
