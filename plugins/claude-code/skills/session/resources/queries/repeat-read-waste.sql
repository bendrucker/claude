-- ---
-- name: repeat-read-waste
-- tier: 1
-- dimensions: [tokens]
-- summary: >-
--   Repeat Reads split by cause, isolating the true context tax from pagination and
--   fan-out.
-- description: >-
--   A repeat Read is a file already read earlier in the same session, decomposed so that
--   by-design re-reads do not masquerade as waste. `paginated` passed `offset`/`limit`,
--   chunked reading of a large file. `sidechain` happened in a subagent, where parallel
--   fan-out loads shared files by design, and may also be paginated, so the two columns
--   overlap. `after_own_edit` is main-thread and unpaginated, but the session edited the
--   file since the previous main-thread read. `true_repeats` is main-thread, unpaginated,
--   with no intervening edit: the actual context tax. Only `true_repeats`, and arguably
--   `after_own_edit`, is actionable waste. A headline repeat percentage without this split
--   mostly measures pagination and fan-out architecture.
--
--   The actionable buckets require a prior main-thread read, because a subagent's read
--   shares the parent session id and without that gate the main thread's first read of a
--   file a subagent touched would count as a repeat. The token estimate uses the chars/4
--   proxy for text, but an image Read returns the file as a base64 image content block
--   whose real cost is the model's fixed image tokenization, around 1,600 tokens. Left
--   uncapped the proxy overstated one session's 31 image reads at ~2.2M tokens against
--   ~50K real, so image results are capped at a flat per-image budget and a re-read image
--   stays in the estimate at that bounded rate.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH reads AS (
  SELECT
    tc.host,
    tc.session_id,
    (tc.data->>'$.input.file_path') AS file_path,
    ((tc.data->'$.input.offset') IS NOT NULL
      OR (tc.data->'$.input.limit') IS NOT NULL) AS paginated,
    COALESCE(m.is_sidechain, FALSE) AS is_sidechain,
    CASE
      WHEN tr.content LIKE '%"type":"image"%'
      -- flat 1,600 tokens per image content block in the result (count the blocks by
      -- how many times the marker drops out of the string), so a base64 payload can't
      -- masquerade as millions of text tokens
      THEN 1600 * (length(tr.content) - length(replace(tr.content, '"type":"image"', '')))
                  / length('"type":"image"')
      ELSE length(tr.content) / 4.0
    END                             AS est_tokens,
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
    COUNT(*) FILTER (WHERE NOT is_sidechain) OVER (
      PARTITION BY host, session_id, file_path
      ORDER BY timestamp, source_line
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prior_main_reads,
    MAX(timestamp) FILTER (WHERE NOT is_sidechain) OVER (
      PARTITION BY host, session_id, file_path
      ORDER BY timestamp, source_line
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_main_read_ts
  FROM reads r
),
classified AS (
  SELECT
    r.*,
    EXISTS (
      SELECT 1 FROM tool_calls e
      WHERE e.host = r.host
        AND e.session_id = r.session_id
        AND e.file_path = r.file_path
        AND e.tool_name IN ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
        AND e.timestamp <= r.timestamp
        AND e.timestamp > r.prev_main_read_ts
    ) AS after_own_edit
  FROM ranked r
)
SELECT
  host,
  COUNT(*)                                       AS total_reads,
  COUNT(*) FILTER (WHERE rn > 1)                 AS repeat_reads,
  ROUND(100.0 * COUNT(*) FILTER (WHERE rn > 1) / COUNT(*), 1) AS repeat_pct,
  COUNT(*) FILTER (WHERE rn > 1 AND paginated)    AS paginated,
  COUNT(*) FILTER (WHERE rn > 1 AND is_sidechain) AS sidechain,
  COUNT(*) FILTER (WHERE prior_main_reads >= 1 AND NOT paginated AND NOT is_sidechain AND after_own_edit)
    AS after_own_edit,
  COUNT(*) FILTER (WHERE prior_main_reads >= 1 AND NOT paginated AND NOT is_sidechain AND NOT after_own_edit)
    AS true_repeats,
  ROUND(SUM(est_tokens) FILTER (WHERE prior_main_reads >= 1 AND NOT paginated AND NOT is_sidechain AND NOT after_own_edit) / 1000.0, 1)
    AS true_repeat_ktokens,
  ROUND(SUM(est_tokens) FILTER (WHERE rn > 1) / 1000.0, 1) AS repeat_ktokens
FROM classified
GROUP BY host
ORDER BY host;
