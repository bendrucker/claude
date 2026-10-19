-- ---
-- name: search
-- summary: >-
--   Find sessions by keyword, ranked by BM25 over each session's label, typed prompts and
--   main-thread assistant prose.
-- description: >-
--   Splits `query` into terms, or keeps it whole when wrapped in double quotes, and scores
--   each session as one BM25 document (k1 1.2, b 0.75). The label counts three times; skill
--   bodies, harness text and subagent turns are left out. A term matches anywhere in a word,
--   with no stemming. Returns `sessions` rows with `score` and `matched_terms`, best first.
-- params:
--   - query
--   - limit
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH q AS (
  SELECT lower(trim(CAST(getvariable('query') AS VARCHAR))) AS q
),
terms AS (
  SELECT DISTINCT term FROM (
    SELECT CASE WHEN regexp_matches(q, '^".+"$') THEN [trim(q, '"')]
      ELSE regexp_split_to_array(q, '[^[:alnum:]_.-]+') END AS ts
    FROM q
  ), unnest(ts) AS u(term)
  WHERE length(term) >= 2
),
scoped AS (
  SELECT i.* FROM search_items i SEMI JOIN scoped_sessions() s USING (host, session_id)
),
lengths AS (
  SELECT host, session_id, sum(length(text) * weight) AS len FROM scoped GROUP BY ALL
),
stats AS (
  SELECT count(*) AS n, avg(len) AS avg_len FROM lengths
),
tf AS (
  SELECT i.host, i.session_id, t.term,
    sum(weight * (length(i.text) - length(replace(i.text, t.term, ''))) // length(t.term)) AS tf
  FROM scoped i JOIN terms t ON contains(i.text, t.term)
  GROUP BY ALL
),
scored AS (
  SELECT tf.host, tf.session_id,
    sum(ln((st.n - df + 0.5) / (df + 0.5) + 1) * tf * 2.2
      / (tf + 1.2 * (0.25 + 0.75 * l.len / st.avg_len))) AS score,
    count(*) AS matched_terms
  FROM (SELECT *, count(*) OVER (PARTITION BY term) AS df FROM tf) tf
  JOIN lengths l USING (host, session_id)
  CROSS JOIN stats st
  GROUP BY ALL
)
SELECT s.*, round(sc.score, 3) AS score, sc.matched_terms
FROM scored sc
JOIN sessions s USING (host, session_id)
ORDER BY sc.score DESC, s.start_time DESC
LIMIT getvariable('limit');
