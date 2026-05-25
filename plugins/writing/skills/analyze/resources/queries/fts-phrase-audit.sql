WITH raw_terms AS (
  SELECT unnest(string_split(getvariable('terms')::VARCHAR, ',')) AS input_term
),
terms_list AS (
  SELECT input_term, stem(lower(input_term), 'porter') AS term
  FROM raw_terms
),
assistant_total AS (
  SELECT SUM(len) AS total_tokens
  FROM fts_main_fts_assistant_corpus.docs
),
user_total AS (
  SELECT SUM(len) AS total_tokens
  FROM fts_main_fts_user_corpus.docs
),
assistant_tf AS (
  SELECT d.term, COUNT(*) AS term_count
  FROM fts_main_fts_assistant_corpus.terms t
  JOIN fts_main_fts_assistant_corpus.dict d ON t.termid = d.termid
  GROUP BY d.term
),
user_tf AS (
  SELECT d.term, COUNT(*) AS term_count
  FROM fts_main_fts_user_corpus.terms t
  JOIN fts_main_fts_user_corpus.dict d ON t.termid = d.termid
  GROUP BY d.term
)
SELECT
  tl.input_term AS term,
  COALESCE(a.term_count, 0) AS assistant_count,
  COALESCE(u.term_count, 0) AS user_count,
  CASE WHEN ast.total_tokens > 0
    THEN ROUND(COALESCE(a.term_count, 0)::DOUBLE / ast.total_tokens * 1000000, 1)
  END AS assistant_per_m,
  CASE WHEN ust.total_tokens > 0
    THEN ROUND(COALESCE(u.term_count, 0)::DOUBLE / ust.total_tokens * 1000000, 1)
  END AS user_per_m,
  CASE WHEN ast.total_tokens > 0 AND ust.total_tokens > 0
    THEN ROUND(
      (COALESCE(a.term_count, 0)::DOUBLE / ast.total_tokens)
      / GREATEST(COALESCE(u.term_count, 0)::DOUBLE / ust.total_tokens, 1e-9),
      1
    )
  END AS lift
FROM terms_list tl
CROSS JOIN assistant_total ast
CROSS JOIN user_total ust
LEFT JOIN assistant_tf a ON tl.term = a.term
LEFT JOIN user_tf u ON tl.term = u.term
ORDER BY lift DESC NULLS LAST;
