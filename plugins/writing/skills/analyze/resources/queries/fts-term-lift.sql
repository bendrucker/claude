WITH assistant_stats AS (
  SELECT SUM(len) AS total_tokens
  FROM fts_main_fts_assistant_corpus.docs
),
user_stats AS (
  SELECT SUM(len) AS total_tokens
  FROM fts_main_fts_user_corpus.docs
),
assistant_tf AS (
  SELECT d.term, SUM(t.tf) AS term_count
  FROM fts_main_fts_assistant_corpus.terms t
  JOIN fts_main_fts_assistant_corpus.dict d ON t.term_id = d.termid
  GROUP BY d.term
),
user_tf AS (
  SELECT d.term, SUM(t.tf) AS term_count
  FROM fts_main_fts_user_corpus.terms t
  JOIN fts_main_fts_user_corpus.dict d ON t.term_id = d.termid
  GROUP BY d.term
)
SELECT
  a.term,
  a.term_count AS assistant_count,
  COALESCE(u.term_count, 0) AS user_count,
  CASE WHEN ast.total_tokens > 0
    THEN ROUND(a.term_count::DOUBLE / ast.total_tokens * 1000000, 1)
  END AS assistant_per_m,
  CASE WHEN ust.total_tokens > 0
    THEN ROUND(COALESCE(u.term_count, 0)::DOUBLE / ust.total_tokens * 1000000, 1)
  END AS user_per_m,
  CASE WHEN ast.total_tokens > 0 AND ust.total_tokens > 0
    THEN ROUND(
      (a.term_count::DOUBLE / ast.total_tokens)
      / GREATEST(COALESCE(u.term_count, 0)::DOUBLE / ust.total_tokens, 1e-9),
      1
    )
  END AS lift
FROM assistant_tf a
CROSS JOIN assistant_stats ast
CROSS JOIN user_stats ust
LEFT JOIN user_tf u ON a.term = u.term
WHERE a.term_count >= COALESCE(getvariable('min_count')::BIGINT, 5)
ORDER BY lift DESC
LIMIT COALESCE(getvariable('limit')::BIGINT, 100);
