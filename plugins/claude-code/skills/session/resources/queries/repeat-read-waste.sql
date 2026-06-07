-- Repeat Reads (a file already read earlier in the same session), decomposed by cause
-- so by-design re-reads don't masquerade as waste:
--   paginated:      the read passed `offset`/`limit` (chunked reading of a large file)
--   sidechain:      the read happened in a subagent (parallel fan-out loads shared files
--                   by design); may also be paginated, the two columns overlap
--   after_own_edit: main-thread, unpaginated, but the session edited the file first
--                   (refreshing post-edit state)
--   true_repeats:   main-thread, unpaginated, never edited: the actual context tax
-- Only `true_repeats` (and arguably `after_own_edit`) is actionable waste; a headline
-- repeat percentage without this split mostly measures pagination and fan-out
-- architecture.
-- Params: after_date, before_date, project, host.
WITH reads AS (
  SELECT
    tc.host,
    tc.session_id,
    (tc.data->>'$.input.file_path') AS file_path,
    ((tc.data->'$.input.offset') IS NOT NULL
      OR (tc.data->'$.input.limit') IS NOT NULL) AS paginated,
    COALESCE(m.is_sidechain, FALSE) AS is_sidechain,
    length(tr.content)              AS chars,
    tc.timestamp,
    tc.source_line
  FROM content_items tc
  JOIN messages m USING (host, source_file, source_line)
  JOIN content_items tr
    ON tr.tool_use_id = tc.id AND tr.host = tc.host AND tr.type = 'tool_result'
  JOIN sessions s ON s.host = tc.host AND s.session_id = tc.session_id
  WHERE tc.type = 'tool_use'
    AND tc.name = 'Read'
    AND (tc.data->>'$.input.file_path') IS NOT NULL
    AND tr.content IS NOT NULL
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
ranked AS (
  SELECT
    r.*,
    row_number() OVER (
      PARTITION BY host, session_id, file_path
      ORDER BY timestamp, source_line
    ) AS rn,
    EXISTS (
      SELECT 1 FROM tool_calls e
      WHERE e.host = r.host
        AND e.session_id = r.session_id
        AND e.file_path = r.file_path
        AND e.tool_name IN ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
        AND e.timestamp <= r.timestamp
    ) AS after_own_edit
  FROM reads r
)
SELECT
  host,
  COUNT(*)                                       AS total_reads,
  COUNT(*) FILTER (WHERE rn > 1)                 AS repeat_reads,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rn > 1) / COUNT(*), 1) AS repeat_pct,
  COUNT(*) FILTER (WHERE rn > 1 AND paginated)    AS paginated,
  COUNT(*) FILTER (WHERE rn > 1 AND is_sidechain) AS sidechain,
  COUNT(*) FILTER (WHERE rn > 1 AND NOT paginated AND NOT is_sidechain AND after_own_edit)
    AS after_own_edit,
  COUNT(*) FILTER (WHERE rn > 1 AND NOT paginated AND NOT is_sidechain AND NOT after_own_edit)
    AS true_repeats,
  ROUND(SUM(chars) FILTER (WHERE rn > 1 AND NOT paginated AND NOT is_sidechain AND NOT after_own_edit) / 4.0 / 1000.0, 1)
    AS true_repeat_ktokens,
  ROUND(SUM(chars) FILTER (WHERE rn > 1) / 4.0 / 1000.0, 1) AS repeat_ktokens
FROM ranked
GROUP BY host
ORDER BY host;
