-- Reproducible snapshot built from the reviewed Google Search Console UI on 2026-07-20.
WITH gsc_baseline (
  window_start,
  window_end,
  impressions,
  clicks,
  ctr,
  average_position,
  indexed_pages,
  sitemap_discovered
) AS (
  VALUES ('2026-07-03', '2026-07-17', 135, 2, 0.015, 7, 1, 0)
)
SELECT * FROM gsc_baseline;

WITH gsc_queries (query, impressions, clicks) AS (
  VALUES
    ('私享', 17, 0),
    ('私享家', 14, 0),
    ('享家', 5, 0),
    ('洗衣店', 5, 0),
    ('西屯洗鞋', 2, 0),
    ('逢甲洗鞋', 2, 0),
    ('乾洗', 2, 0),
    ('洗包包', 1, 0),
    ('洗鞋子', 1, 0),
    ('烘鞋子', 1, 0)
)
SELECT * FROM gsc_queries ORDER BY impressions DESC, query;
