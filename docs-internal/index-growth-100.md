# Index growth 100 operating plan

## Milestone math (measured in this clone)

Source baseline is **32** canonical HTML URLs after transplanting the six already-live pages the clean branch lacked (`luggage-wheel-cleaning`, `curtain-cleaning`, `carpet-cleaning`, `fengjia-laundry-pickup`, `zhongke-office-laundry`, `donghai-laundry-pickup`).

Breakdown: 1 homepage + 7 services + 24 existing support/local pages. Phase 1 then adds `accepted_count` catalog guides. Sitemap size is exactly `32 + accepted_count`. If all 24 remain accepted this is 56.

| Milestone | Measured meaning | Do not claim |
| --- | --- | --- |
| 32 | source baseline matching the 2026-08-30 live sitemap | Google indexed 32 |
| 32 + accepted_count | baseline plus accepted catalog projection | live GSC = sitemap |
| 100 | later accepted batches only | drafts count |
| 150 / 200 | only accepted rows | indexing |

A smaller accepted catalog is preferable to a policy-unsafe quota. Draft/rejected/merge rows stay in research and cannot enter sitemap, HTML, answers, AI sitemap, AI discovery, llms, services, knowledge graph, or GEO records.

## GSC evidence states

Verified snapshot `data/insights/gsc-index/2026-08-30.json`: **26 indexed**, **5 discovered_not_indexed**, **1 unknown**, 32 URLs.

Allowed states: `generated`, `submitted`, `crawled`, `indexed`, `discovered_not_indexed`, `unknown`.

Never label a sitemap-generated URL `submitted` or `indexed`. Sitemap submission is a hint. Google indexing, ranking, and citation are not guaranteed.

## Seven- and 28-day GSC gates

- Day 0: submit sitemap. Record URL Inspection for new accepted paths plus the currently non-indexed service/hub URLs.
- Day 7: do not rewrite the 2026-08-30 indexed cohort source fields. Only record crawled/indexed/excluded reasons.
- Day 28: keep/merge/drop by query impressions and overlap, not by URL count.

## Consolidation rules

- One page per decision cluster. Material nouns without a new decision are backlog or merge.
- Duplicate citation answers, doorway location swaps, and 3-gram Jaccard ≥ 0.68 fail closed.
- Drafts stay in `topic-inventory.csv` only.

## Non-guarantee boundary

Sitemap lastmod and URL count are publication facts. They are not evidence of Google indexing, sitelinks, ranking, or citation.
