/** Synchronize only the homepage's content dates, without using the build clock. */
export interface HomepageContentDatesInput {
  html: string;
  sitemapXml: string;
  canonicalUrl: string;
  includedPostDates: readonly string[];
}
export interface HomepageContentDatesResult {
  html: string;
  sitemapXml: string;
  changed: boolean;
  lastmod?: string;
  reason?: string;
}

function day(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return undefined;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  if (value.length > 10 && !Number.isFinite(Date.parse(value))) return undefined;
  return date;
}

/** Locate JSON objects without reserializing their surrounding JSON or HTML. */
function objectSpans(json: string): Array<{ start: number; end: number }> {
  const stack: number[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") stack.push(i);
    else if (ch === "}") {
      const start = stack.pop();
      if (start !== undefined) spans.push({ start, end: i + 1 });
    }
  }
  return spans;
}

function xmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity]!);
}

export function syncHomepageContentDates(input: HomepageContentDatesInput): HomepageContentDatesResult {
  const unchanged = (reason: string): HomepageContentDatesResult => ({
    html: input.html, sitemapXml: input.sitemapXml, changed: false, reason
  });
  const open = "<!-- SXJ:RECENT_POSTS -->";
  const close = "<!-- /SXJ:RECENT_POSTS -->";
  if (input.html.split(open).length !== 2 || input.html.split(close).length !== 2 ||
      input.html.indexOf(close) < input.html.indexOf(open)) return unchanged("Malformed homepage recent-post markers");
  const includedDays = input.includedPostDates.map(day);
  if (includedDays.some((value) => !value)) return unchanged("Invalid included post date");

  const candidates: Array<{ start: number; end: number; json: string; node: Record<string, unknown> }> = [];
  for (const script of input.html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const tagEnd = script[0].indexOf(">");
    const tag = script[0].slice(0, tagEnd + 1);
    if (!/\btype\s*=\s*(["'])application\/ld\+json\1/i.test(tag)) continue;
    const json = script[0].slice(tagEnd + 1, script[0].lastIndexOf("</"));
    try { JSON.parse(json); } catch { return unchanged("Invalid JSON-LD"); }
    for (const span of objectSpans(json)) {
      const raw = json.slice(span.start, span.end);
      const node = JSON.parse(raw) as Record<string, unknown>;
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      const isHome = node.url === input.canonicalUrl ||
        (node.url === undefined && node["@id"] === `${input.canonicalUrl}#webpage`);
      if (types.includes("WebPage") && isHome) {
        const start = script.index! + tagEnd + 1 + span.start;
        candidates.push({ start, end: start + raw.length, json: raw, node });
      }
    }
  }
  if (candidates.length !== 1) return unchanged("Missing or ambiguous homepage WebPage");
  const target = candidates[0]!;
  const authored = target.node.dateModified === undefined ? undefined : day(target.node.dateModified);
  if (target.node.dateModified !== undefined && !authored) return unchanged("Invalid homepage authored date");
  const lastmod = [authored, ...includedDays].filter((value): value is string => Boolean(value)).sort().at(-1);
  if (!lastmod) return unchanged("No defensible homepage content date");

  const entries = [...input.sitemapXml.matchAll(/<url\b[^>]*>[\s\S]*?<\/url\s*>/g)].filter((entry) => {
    const locations = [...entry[0].matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/g)];
    return locations.length === 1 && xmlText(locations[0]![1]!.trim()) === input.canonicalUrl;
  });
  if (entries.length !== 1) return unchanged("Missing or ambiguous homepage sitemap URL");
  const entry = entries[0]!;
  const existingDates = [...entry[0].matchAll(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod\s*>/g)];
  if (existingDates.length > 1 || existingDates.some((match) => !day(match[1]!.trim()))) return unchanged("Invalid homepage sitemap date");

  // Find only the direct dateModified property, excluding nested objects.
  const nested = objectSpans(target.json).filter((span) => span.start !== 0);
  const dateProperties = [...target.json.matchAll(/"dateModified"\s*:\s*"(?:\\.|[^"\\])*"/g)]
    .filter((match) => !nested.some((span) => match.index! > span.start && match.index! < span.end));
  if (target.node.dateModified !== undefined && dateProperties.length !== 1) return unchanged("Ambiguous homepage dateModified property");
  let nextNode = target.json;
  if (dateProperties.length) {
    const prop = dateProperties[0]!;
    const replacement = prop[0].replace(/:\s*"(?:\\.|[^"\\])*"$/, (value) => value.replace(/"(?:\\.|[^"\\])*"$/, JSON.stringify(lastmod)));
    nextNode = nextNode.slice(0, prop.index!) + replacement + nextNode.slice(prop.index! + prop[0].length);
  } else {
    nextNode = nextNode.slice(0, -1) + `,"dateModified":${JSON.stringify(lastmod)}}`;
  }
  const nextEntry = existingDates.length
    ? entry[0].replace(/(<lastmod\b[^>]*>)[\s\S]*?(<\/lastmod\s*>)/, `$1${lastmod}$2`)
    : entry[0].replace(/<\/url\s*>$/, (closing) => `<lastmod>${lastmod}</lastmod>${closing}`);
  const html = input.html.slice(0, target.start) + nextNode + input.html.slice(target.end);
  const sitemapXml = input.sitemapXml.slice(0, entry.index!) + nextEntry + input.sitemapXml.slice(entry.index! + entry[0].length);
  return { html, sitemapXml, lastmod, changed: html !== input.html || sitemapXml !== input.sitemapXml };
}
