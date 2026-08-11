import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const generatedAt = new Date().toISOString();

const searches = [
  {
    category: "ai-discovery",
    query: '"llms.txt" in:name,description,readme pushed:>=2025-01-01 stars:>=2'
  },
  {
    category: "geo-aeo",
    query: '"generative engine optimization" in:name,description,readme pushed:>=2025-01-01 stars:>=2'
  },
  {
    category: "geo-aeo",
    query: '"answer engine optimization" in:name,description,readme pushed:>=2025-01-01 stars:>=2'
  },
  {
    category: "ai-crawlers",
    query: '"OAI-SearchBot" OR "PerplexityBot" in:name,description,readme pushed:>=2025-01-01 stars:>=1'
  },
  {
    category: "structured-data",
    query: '"schema.org" "JSON-LD" SEO in:name,description,readme pushed:>=2024-01-01 stars:>=5'
  },
  {
    category: "indexing",
    query: 'IndexNow SEO in:name,description,readme pushed:>=2024-01-01 stars:>=2'
  },
  {
    category: "local-seo",
    query: '"local SEO" "Google Business Profile" in:name,description,readme pushed:>=2024-01-01 stars:>=2'
  },
  {
    category: "measurement",
    query: '"Google Search Console" SEO in:name,description,readme pushed:>=2024-01-01 stars:>=5'
  },
  {
    category: "technical-seo",
    query: 'sitemap robots.txt canonical lighthouse SEO in:name,description,readme pushed:>=2024-01-01 stars:>=10'
  }
];

const categoryPatterns = {
  "ai-discovery": [/llms\.txt/i, /machine[- ]readable/i, /ai[- ]readable/i],
  "geo-aeo": [
    /generative engine optimi[sz]ation/i,
    /answer engine optimi[sz]ation/i,
    /\bGEO\b.{0,40}(search|citation|llm)/i,
    /\bAEO\b.{0,40}(search|answer|citation)/i,
    /AI search visibility/i,
    /LLM citation/i
  ],
  "ai-crawlers": [/OAI-SearchBot/i, /GPTBot/i, /PerplexityBot/i, /ClaudeBot/i, /AI crawler/i],
  "structured-data": [/schema\.org/i, /JSON-LD/i, /structured data/i, /LocalBusiness/i],
  indexing: [/IndexNow/i, /sitemap/i, /robots\.txt/i, /canonical/i, /crawlability/i],
  "local-seo": [/local SEO/i, /Google Business Profile/i, /Google My Business/i, /NAP consistency/i],
  measurement: [/Google Search Console/i, /Bing Webmaster/i, /SEO analytics/i, /AI referral/i],
  "technical-seo": [/technical SEO/i, /SEO audit/i, /Lighthouse/i, /Core Web Vitals/i, /web-vitals/i]
};

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

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "sixiangjia-seo-evidence-audit"
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function fetchJson(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
  if (!response.ok) {
    const rateRemaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(`GitHub HTTP ${response.status}; search rate remaining=${rateRemaining ?? "unknown"}`);
  }
  return response.json();
}

async function fetchReadme(repo) {
  const url = `https://raw.githubusercontent.com/${repo.full_name}/HEAD/README.md`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": headers["User-Agent"] },
      signal: AbortSignal.timeout(12_000),
      redirect: "follow"
    });
    if (!response.ok) return "";
    return (await response.text()).slice(0, 80_000);
  } catch {
    return "";
  }
}

async function mapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return results;
}

function classify(text) {
  return Object.entries(categoryPatterns)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(text)))
    .map(([category]) => category);
}

function score(repo, categories, readme) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(repo.pushed_at)) / 86_400_000);
  const recency = Math.max(0, 18 - ageDays / 30);
  const stars = Math.min(30, Math.log10(Math.max(1, repo.stargazers_count)) * 10);
  const categoryDepth = Math.min(20, categories.length * 5);
  const authority = authoritativeOwners.has(repo.owner.login) ? 20 : 0;
  const evidence = readme.length >= 1_000 ? 8 : readme.length > 0 ? 3 : 0;
  return Math.round((recency + stars + categoryDepth + authority + evidence) * 10) / 10;
}

await mkdir(here, { recursive: true });

const discovered = new Map();
for (const search of searches) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", search.query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "100");
  const payload = await fetchJson(url);
  for (const repo of payload.items ?? []) {
    if (repo.archived || repo.fork) continue;
    const existing = discovered.get(repo.full_name) ?? { ...repo, search_categories: [], search_queries: [] };
    if (!existing.search_categories.includes(search.category)) existing.search_categories.push(search.category);
    if (!existing.search_queries.includes(search.query)) existing.search_queries.push(search.query);
    discovered.set(repo.full_name, existing);
  }
}

const candidates = [...discovered.values()]
  .sort((a, b) => b.stargazers_count - a.stargazers_count || a.full_name.localeCompare(b.full_name))
  .slice(0, 360);

const enriched = await mapLimit(candidates, 8, async (repo) => {
  const readme = await fetchReadme(repo);
  const searchable = [repo.full_name, repo.description ?? "", repo.homepage ?? "", ...(repo.topics ?? []), readme].join("\n");
  const categories = classify(searchable);
  return {
    full_name: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    owner: repo.owner.login,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    open_issues: repo.open_issues_count,
    language: repo.language,
    license: repo.license?.spdx_id ?? null,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
    archived: repo.archived,
    topics: repo.topics ?? [],
    search_categories: repo.search_categories,
    evidence_categories: categories,
    readme_checked: readme.length > 0,
    readme_characters_checked: readme.length,
    relevance_score: score(repo, categories, readme)
  };
});

const relevant = enriched
  .filter((repo) => repo.evidence_categories.length > 0)
  .sort((a, b) => b.relevance_score - a.relevance_score || b.stars - a.stars || a.full_name.localeCompare(b.full_name));

if (relevant.length < 100) {
  throw new Error(`Only ${relevant.length} relevant GitHub sources survived README/metadata validation; need at least 100.`);
}

const selected = relevant.slice(0, Math.max(120, Math.min(160, relevant.length)));
const categoryCounts = Object.fromEntries(
  Object.keys(categoryPatterns).map((category) => [
    category,
    selected.filter((source) => source.evidence_categories.includes(category)).length
  ])
);

const report = {
  generated_at: generatedAt,
  methodology: {
    search_count: searches.length,
    unique_repositories_discovered: discovered.size,
    readme_candidates_checked: candidates.length,
    relevant_after_validation: relevant.length,
    selected_count: selected.length,
    selection_note:
      "Repositories are discovery and implementation evidence, not proof of ranking causation. Each selected item matched at least one explicit SEO/AEO/GEO term in metadata or the first 80k README characters."
  },
  category_counts: categoryCounts,
  searches,
  sources: selected
};

await writeFile(join(here, "github-sources.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

const markdown = [
  "# GitHub SEO / AEO / GEO technical-source ledger",
  "",
  `Generated: ${generatedAt}`,
  "",
  `Selected ${selected.length} unique repositories from ${discovered.size} discoveries; ${candidates.length} README candidates were checked.`,
  "",
  "> This ledger is a research corpus, not a popularity vote or ranking guarantee. Repositories with explicit relevance were retained; official search-engine documentation remains the higher-authority source for product behavior.",
  "",
  "## Category coverage",
  "",
  ...Object.entries(categoryCounts).map(([category, count]) => `- ${category}: ${count}`),
  "",
  "## Sources",
  "",
  ...selected.map(
    (source, index) =>
      `${index + 1}. [${source.full_name}](${source.url}) — score ${source.relevance_score}; stars ${source.stars}; ${source.evidence_categories.join(", ")}; pushed ${source.pushed_at.slice(0, 10)}${source.description ? ` — ${source.description.replace(/\s+/g, " ")}` : ""}`
  ),
  ""
].join("\n");

await writeFile(join(here, "github-sources.md"), markdown, "utf8");
console.log(
  JSON.stringify({
    selected: selected.length,
    discovered: discovered.size,
    readmes_checked: candidates.length,
    relevant: relevant.length,
    category_counts: categoryCounts
  })
);
