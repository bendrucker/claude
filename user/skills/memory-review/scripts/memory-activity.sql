-- Per memory file: Write/Edit and Read activity from tool_calls, and recall
-- count from relevant_memories attachments. Requires SET VARIABLE dir to the
-- absolute memory directory, with no trailing slash.
WITH touched AS (
  SELECT
    regexp_extract(file_path, '[^/]+$') AS file,
    count(*) FILTER (WHERE tool_name IN ('Write', 'Edit')) AS writes,
    max(timestamp) FILTER (WHERE tool_name IN ('Write', 'Edit')) AS last_write,
    count(*) FILTER (WHERE tool_name = 'Read') AS reads,
    max(timestamp) FILTER (WHERE tool_name = 'Read') AS last_read
  FROM tool_calls
  WHERE file_path LIKE getvariable('dir') || '/%.md'
  GROUP BY 1
),
recalled AS (
  SELECT
    regexp_extract(m ->> 'path', '[^/]+$') AS file,
    count(*) AS recalls,
    max(timestamp) AS last_recall
  FROM attachments, unnest(CAST(attachment -> '$.memories' AS JSON[])) AS t(m)
  WHERE kind = 'relevant_memories'
    AND (m ->> 'path') LIKE getvariable('dir') || '/%'
  GROUP BY 1
)
SELECT *
FROM touched
FULL JOIN recalled USING (file)
ORDER BY file;
