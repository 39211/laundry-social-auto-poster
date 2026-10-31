/**
 * B1-3 (owner decision C07 = A, 2026-10-30): the pickup-area claim is
 * 「台中市免費到府收送」. Customer-facing text must not say 台中市區 / 台中全區 /
 * 台中市全區 / 台中全市 / 台中市全市, nor 全市免費 / 全區免費.
 *
 * What is scanned:
 *   - every string literal ('…', "…", `…` template text) in src/*.ts
 *   - the raw text of the seo-overrides files listed in SEO_FILES
 *
 * Allow-mechanism (documented on purpose):
 *   - Comments are skipped.
 *   - Regex literals are skipped. A regex guard that forbids a word is not
 *     customer-facing text.
 *   - String literals inside an array literal are skipped when that array is
 *     assigned to a variable or property whose name ends with
 *     `Forbidden`, `FORBIDDEN`, `banned`, `Banned` or `BANNED`. Examples:
 *     `const AREA_FORBIDDEN = ["台中全市"]` and `bannedWords: new Set(["台中市區"])`.
 *     Use that naming when a guard list must spell an old variant out.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const OLD_AREA_WORDING = ["台中市區", "台中全區", "台中市全區", "台中全市", "台中市全市", "全市免費", "全區免費"];

const SEO_FILES = [
  "seo-overrides/ai-discovery.json",
  "seo-overrides/answers.json",
  "seo-overrides/llms.txt",
  "seo-overrides/.well-known/llms.txt",
  "seo-overrides/business-profile.json"
];

// Commander fix: the documented example `bannedWords` must be allowed too, so match the word anywhere in the name.
const ALLOW_LIST_NAME = /(?:forbidden|banned|boilerplate)/iu;
// BOILERPLATE_PHRASES (indexGrowthPages.ts) only strips repeated text before the similarity check;
// it is not customer-facing, so a list whose name contains "boilerplate" is allowed as well.
const FROZEN_SOURCES = new Set<string>();
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await"
]);

type Literal = { text: string; start: number; allowed: boolean };

/** Name of the variable/property an array literal opening at `at` is assigned to. */
function arrayOwnerName(src: string, at: number): string | undefined {
  const before = src.slice(Math.max(0, at - 200), at);
  const assigned = before.match(/([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*(?:new\s+Set\s*\(\s*)?$/u);
  if (assigned) return assigned[1];
  const property = before.match(/([A-Za-z_$][\w$]*)\s*:\s*(?:new\s+Set\s*\(\s*)?$/u);
  return property?.[1];
}

/** Small TypeScript lexer: returns string literals and template text chunks. */
export function collectStringLiterals(src: string): Literal[] {
  const literals: Literal[] = [];
  const stack: Array<{ allowed: boolean }> = [];
  const allowedNow = () => stack.some((entry) => entry.allowed);
  let i = 0;
  let prevOperand = false;

  function readQuoted(quote: string): void {
    const start = i;
    i += 1;
    let text = "";
    while (i < src.length && src[i] !== quote) {
      if (src[i] === "\\") {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (src[i] === "\n") break;
      text += src[i];
      i += 1;
    }
    i += 1;
    literals.push({ text, start, allowed: allowedNow() });
    prevOperand = true;
  }

  function readTemplate(): void {
    const start = i;
    i += 1;
    let text = "";
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") {
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (src[i] === "$" && src[i + 1] === "{") {
        literals.push({ text, start, allowed: allowedNow() });
        text = "";
        i += 2;
        readCode(true);
        continue;
      }
      text += src[i];
      i += 1;
    }
    i += 1;
    literals.push({ text, start, allowed: allowedNow() });
    prevOperand = true;
  }

  function skipRegex(): void {
    i += 1;
    let inClass = false;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n") break;
      if (inClass) {
        if (c === "]") inClass = false;
      } else if (c === "[") {
        inClass = true;
      } else if (c === "/") {
        i += 1;
        break;
      }
      i += 1;
    }
    while (i < src.length && /[A-Za-z]/u.test(src[i] ?? "")) i += 1;
    prevOperand = true;
  }

  function readCode(untilClosingBrace: boolean): void {
    let depth = 0;
    while (i < src.length) {
      const c = src[i] as string;
      const next = src[i + 1];
      if (c === "/" && next === "/") {
        const end = src.indexOf("\n", i);
        i = end === -1 ? src.length : end;
        continue;
      }
      if (c === "/" && next === "*") {
        const end = src.indexOf("*/", i + 2);
        i = end === -1 ? src.length : end + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        readQuoted(c);
        continue;
      }
      if (c === "`") {
        readTemplate();
        continue;
      }
      if (c === "/") {
        if (prevOperand) {
          i += 1;
          prevOperand = false;
        } else {
          skipRegex();
        }
        continue;
      }
      if (/\s/u.test(c)) {
        i += 1;
        continue;
      }
      if (/[A-Za-z_$0-9]/u.test(c)) {
        let j = i;
        while (j < src.length && /[\w$]/u.test(src[j] ?? "")) j += 1;
        const word = src.slice(i, j);
        i = j;
        prevOperand = !REGEX_PRECEDING_KEYWORDS.has(word);
        continue;
      }
      if (c === "{" || c === "(" || c === "[") {
        const allowed = c === "[" && ALLOW_LIST_NAME.test(arrayOwnerName(src, i) ?? "");
        stack.push({ allowed });
        if (c === "{") depth += 1;
        i += 1;
        prevOperand = false;
        continue;
      }
      if (c === "}" || c === ")" || c === "]") {
        if (c === "}" && untilClosingBrace && depth === 0) {
          i += 1;
          return;
        }
        if (c === "}") depth -= 1;
        stack.pop();
        i += 1;
        prevOperand = true;
        continue;
      }
      i += 1;
      prevOperand = false;
    }
  }

  readCode(false);
  return literals;
}

function oldWordingIn(text: string): string[] {
  return OLD_AREA_WORDING.filter((word) => text.includes(word));
}

function lineOf(src: string, position: number): number {
  return src.slice(0, position).split("\n").length;
}

describe("B1-3 pickup-area wording: 台中市免費到府收送", () => {
  it("lexer skips comments, regex literals and *Forbidden/*banned arrays", () => {
    const sample = [
      "// comment with 台中全市 is ignored",
      "const re = /台中全市|台中市區/u;",
      'const AREA_FORBIDDEN = ["台中全市", `台中市區`];',
      'const config = { bannedWords: new Set(["台中全區"]) };',
      "const ratio = a / b / c;",
      "const ok = `台中市${place}免費到府收送`;",
      "const bad = '台中市全區免費收送';"
    ].join("\n");
    const flagged = collectStringLiterals(sample)
      .filter((literal) => !literal.allowed && oldWordingIn(literal.text).length > 0)
      .map((literal) => literal.text);
    expect(flagged).toEqual(["台中市全區免費收送"]);
  });

  it("src/*.ts string literals carry no old pickup-area wording", () => {
    const srcDir = join(ROOT, "src");
    const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts") && !FROZEN_SOURCES.has(name));
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const name of files) {
      const src = readFileSync(join(srcDir, name), "utf8");
      for (const literal of collectStringLiterals(src)) {
        if (literal.allowed) continue;
        const found = oldWordingIn(literal.text);
        if (found.length > 0) {
          violations.push(`src/${name}:${lineOf(src, literal.start)} ${found.join(",")} → ${literal.text.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("seo-overrides texts carry no old pickup-area wording", () => {
    const violations: string[] = [];
    for (const relative of SEO_FILES) {
      const full = join(ROOT, relative);
      expect(existsSync(full), relative).toBe(true);
      const text = readFileSync(full, "utf8");
      for (const word of OLD_AREA_WORDING) {
        const count = text.split(word).length - 1;
        if (count > 0) violations.push(`${relative}: ${word} ×${count}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("src/contentPlan.ts carries the decided claim 台中市免費到府收送", () => {
    const src = readFileSync(join(ROOT, "src", "contentPlan.ts"), "utf8");
    expect(src).toContain("台中市免費到府收送");
  });
});
