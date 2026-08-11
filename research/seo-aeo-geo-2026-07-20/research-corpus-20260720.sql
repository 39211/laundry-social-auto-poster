-- Reproducible source-count snapshot from the reviewed X and GitHub corpora.
WITH research_counts (channel, count) AS (
  VALUES
    ('X', 153),
    ('GitHub 討論', 119),
    ('GitHub 實作', 160)
)
SELECT * FROM research_counts ORDER BY count DESC, channel;
