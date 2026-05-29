WITH scoped AS (
  SELECT role, model, text
  FROM text_content
  WHERE date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
    AND (role = 'assistant' OR (NOT is_subagent AND NOT is_system))
),
counts AS (
  SELECT
    role,
    model,
    COUNT(*) AS messages,
    SUM(length(text)) AS total_chars,
    SUM(
      CASE
        WHEN length(getvariable('phrase')) = 0 THEN 0
        ELSE (length(lower(text))
              - length(replace(lower(text), lower(getvariable('phrase')), '')))
             / length(getvariable('phrase'))
      END
    ) AS phrase_count
  FROM scoped
  GROUP BY role, model
),
with_rate AS (
  SELECT
    role,
    model,
    messages,
    total_chars,
    phrase_count,
    CASE WHEN total_chars > 0
         THEN phrase_count::DOUBLE / total_chars * 1000000
    END AS per_1m_chars
  FROM counts
),
user_baseline AS (
  SELECT AVG(per_1m_chars) AS user_per_1m
  FROM with_rate
  WHERE role = 'user' AND per_1m_chars IS NOT NULL
)
SELECT
  wr.role,
  wr.model,
  wr.messages,
  wr.total_chars,
  wr.phrase_count,
  ROUND(wr.per_1m_chars, 2) AS per_1m_chars,
  CASE
    WHEN wr.role = 'assistant'
         AND (SELECT user_per_1m FROM user_baseline) > 0
    THEN ROUND(wr.per_1m_chars / (SELECT user_per_1m FROM user_baseline), 2)
  END AS lift_vs_user
FROM with_rate wr
ORDER BY wr.role, wr.phrase_count DESC, wr.model NULLS FIRST;
