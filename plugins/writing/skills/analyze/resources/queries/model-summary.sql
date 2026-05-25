WITH scoped AS (
  SELECT tc.*
  FROM text_content tc
  JOIN sessions s USING (session_id)
  WHERE tc.role = 'assistant'
    AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
)
SELECT
  COALESCE(model, '(unknown)') AS model,
  COUNT(*) AS text_items,
  COUNT(DISTINCT (source_file, source_line)) AS messages,
  COUNT(DISTINCT session_id) AS sessions,
  SUM(length(text)) AS total_chars,
  ROUND(AVG(length(text)), 1) AS avg_chars_per_item
FROM scoped
GROUP BY model
ORDER BY total_chars DESC NULLS LAST;
