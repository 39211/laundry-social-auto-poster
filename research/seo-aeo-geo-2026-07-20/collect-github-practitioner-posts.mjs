import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const generatedAt = new Date().toISOString();

const searches = [
  { category: "llms-txt", query: '"llms.txt" in:title,body type:issue is:public created:>=2025-01-01' },
  {
    category: "geo",
    query: '"generative engine optimization" in:title,body type:issue is:public created:>=2024-01-01'
  },
  {
    category: "aeo",
    query: '"answer engine optimization" in:title,body type:issue is:public created:>=2024-01-01'
  },
  {
    category: "ai-crawlers",
    query: '"OAI-SearchBot" in:title,body type:issue is:public created:>=2024-01-01'
  },
  {
    category: "ai-crawlers",
    query: '"PerplexityBot" in:title,body type:issue is:public created:>=2024-01-01'
  },
  { category: "indexnow", query: 'IndexNow in:title,body type:issue is:public updated:>=2024-01-01' },
  {
    category: "structured-data",
    query: '"LocalBusiness" "schema.org" in:title,body type:issue is:public updated:>=2024-01-01'
  },
  {
    category: "measurement",
    query: '"Google Search Console" AI in:title,body type:issue is:public created:>=2024-01-01'
  },
  {
    category: "local-seo",
    query: '"Google Business Profile" "local SEO" in:title,body type:issue is:public updated:>=2024-01-01'
  }
];

const authoritativeOwners = new Set([
  "AnswerDotAI",
  "IndexNow",
  "schemaorg",
  "GoogleChrome",
  "GoogleChromeLabs",
  "google",
  "googleapis",
  "microsoft",
  "openai",
  "anthropics",
  "cloudflare",
  "vercel",
  "withastro",
  "nuxt",
  "yoast",
  "ahrefs"
]);

const titlePatterns = {
  "llms-txt": /llms\.txt/i,
  geo: /\bGEO\b|generative engine/i,
  aeo: /\bAEO\b|answer engine/i,
  "ai-crawlers": /OAI-SearchBot|PerplexityBot|GPTBot|AI crawler/i,
  indexnow: /IndexNow/i,
  "structured-data": /LocalBusiness|schema\.org|structured data|JSON-LD/i,
  measurement: /Search Console|AI performance|AI referral|analytics/i,
  "local-seo": /local SEO|Google Business Profile|Google My Business|\bGBP\b/i
};

function repositoryName(item) {
  return item.repository_url.replace("https://api.github.com/repos/", "");
}

function evidenceTier(item) {
  const [owner] = repositoryName(item).split("/");
  if (authoritativeOwners.has(owner)) return "official-or-platform-project";
  if (["OWNER", "MEMBER", "COLLABORATOR"].includes(item.author_association)) return "maintainer-practitioner";
  return "community-implementation";
}

function score(item) {
  const reactions = item.reactions?.total_count ?? 0;
  const ageDays = Math.max(0, (Date.now() - Date.parse(item.updated_at)) / 86_400_000);
  const recency = Math.max(0, 20 - ageDays / 30);
  const discussion = Math.min(25, Math.log2(item.comments + reactions + 1) * 5);
  const association = ["OWNER", "MEMBER", "COLLABORATOR"].includes(item.author_association) ? 15 : 0;
  const authority = evidenceTier(item) === "official-or-platform-project" ? 20 : 0;
  return Math.round((recency + discussion + association + authority) * 10) / 10;
}

async function searchIssues(query) {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "api",
      "-X",
      "GET",
      "search/issues",
      "-f",
      `q=${query}`,
      "-f",
      "per_page=100",
      "-f",
      "sort=comments",
      "-f",
      "order=desc"
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, windowsHide: true }
  );
  return JSON.parse(stdout);
}

const itemsByUrl = new Map();
const queryStats = [];
for (const search of searches) {
  const payload = await searchIssues(search.query);
  queryStats.push({ ...search, total_count: payload.total_count, fetched: payload.items.length });
  for (const item of payload.items) {
    if (item.pull_request) continue;
    const existing = itemsByUrl.get(item.html_url) ?? { item, categories: [], matched_queries: [] };
    if (!existing.categories.includes(search.category)) existing.categories.push(search.category);
    if (!existing.matched_queries.includes(search.query)) existing.matched_queries.push(search.query);
    itemsByUrl.set(item.html_url, existing);
  }
}

const normalized = [...itemsByUrl.values()]
  .map(({ item, categories, matched_queries }) => ({
    title: item.title,
    url: item.html_url,
    repository: repositoryName(item),
    number: item.number,
    state: item.state,
    created_at: item.created_at,
    updated_at: item.updated_at,
    closed_at: item.closed_at,
    comments: item.comments,
    reactions: item.reactions?.total_count ?? 0,
    author_association: item.author_association,
    evidence_tier: evidenceTier(item),
    categories: categories.filter((category) => titlePatterns[category].test(item.title)),
    matched_queries,
    evidence_use:
      "Practitioner implementation, bug, or discussion evidence only; not proof that the described tactic causes rankings or AI citations.",
    relevance_score: score(item)
  }))
  .filter((item) => item.categories.length > 0);

const selectedByUrl = new Map();
for (const category of [...new Set(searches.map((search) => search.category))]) {
  const categoryItems = normalized
    .filter((item) => item.categories.includes(category))
    .sort((a, b) => b.relevance_score - a.relevance_score || b.comments - a.comments || a.url.localeCompare(b.url))
    .slice(0, 24);
  for (const item of categoryItems) selectedByUrl.set(item.url, item);
}

if (selectedByUrl.size < 100) {
  for (const item of normalized.sort((a, b) => b.relevance_score - a.relevance_score || a.url.localeCompare(b.url))) {
    selectedByUrl.set(item.url, item);
    if (selectedByUrl.size >= 120) break;
  }
}

const balancedSelected = [...selectedByUrl.values()].sort(
  (a, b) => b.relevance_score - a.relevance_score || b.comments - a.comments || a.url.localeCompare(b.url)
);

const automatedNoise = /\b(daily|weekly)\b.*\b(maintenance|autohealing|report)\b|\bCI failure\b|\bbount(?:y|ies)\b|\bSEO perfection\b/i;
const selected = balancedSelected.filter(
  (item) =>
    !automatedNoise.test(item.title) &&
    (item.comments + item.reactions >= 3 || item.evidence_tier === "official-or-platform-project")
);

if (selected.length < 100) {
  for (const item of normalized
    .filter((candidate) => !automatedNoise.test(candidate.title) && candidate.comments + candidate.reactions >= 2)
    .sort((a, b) => b.relevance_score - a.relevance_score || b.comments - a.comments || a.url.localeCompare(b.url))) {
    if (!selected.some((candidate) => candidate.url === item.url)) selected.push(item);
    if (selected.length >= 120) break;
  }
}

selected.sort((a, b) => b.relevance_score - a.relevance_score || b.comments - a.comments || a.url.localeCompare(b.url));
if (selected.length < 100) throw new Error(`Only ${selected.length} substantive public GitHub practitioner posts were selected.`);

const categoryCounts = Object.fromEntries(
  [...new Set(searches.map((search) => search.category))].map((category) => [
    category,
    selected.filter((item) => item.categories.includes(category)).length
  ])
);
const tierCounts = Object.fromEntries(
  [...new Set(selected.map((item) => item.evidence_tier))].map((tier) => [
    tier,
    selected.filter((item) => item.evidence_tier === tier).length
  ])
);

const report = {
  generated_at: generatedAt,
  methodology: {
    public_only: true,
    search_count: searches.length,
    unique_items_discovered: normalized.length,
    selected_count: selected.length,
    note:
      "Items are public GitHub issues whose title explicitly names the selected SEO/AEO/GEO topic, then filtered for substantive discussion (at least three comments/reactions, or an official platform project). Automated maintenance, autohealing, CI-failure, and bounty noise is excluded. Titles and metadata are retained; issue bodies are not copied."
  },
  query_stats: queryStats,
  category_counts: categoryCounts,
  evidence_tier_counts: tierCounts,
  sources: selected
};

await mkdir(here, { recursive: true });
await writeFile(join(here, "github-practitioner-posts.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = [
  "# GitHub practitioner-post ledger for SEO / AEO / GEO",
  "",
  `Generated: ${generatedAt}`,
  "",
  `Selected ${selected.length} unique public issue posts from ${normalized.length} discovered items across ${searches.length} focused searches.`,
  "",
  "> GitHub posts show implementation adoption, breakages, and practitioner discussion. They are not causal ranking studies; official search-engine documentation outranks them when claims conflict.",
  "",
  "## Coverage",
  "",
  ...Object.entries(categoryCounts).map(([category, count]) => `- ${category}: ${count}`),
  "",
  "## Evidence tiers",
  "",
  ...Object.entries(tierCounts).map(([tier, count]) => `- ${tier}: ${count}`),
  "",
  "## Sources",
  "",
  ...selected.map(
    (item, index) =>
      `${index + 1}. [${item.repository}#${item.number}: ${item.title.replace(/\s+/g, " ")}](${item.url}) — ${item.evidence_tier}; ${item.categories.join(", ")}; comments ${item.comments}; updated ${item.updated_at.slice(0, 10)}`
  ),
  ""
].join("\n");

await writeFile(join(here, "github-practitioner-posts.md"), markdown, "utf8");
console.log(
  JSON.stringify({
    selected: selected.length,
    discovered: normalized.length,
    categories: categoryCounts,
    tiers: tierCounts
  })
);
