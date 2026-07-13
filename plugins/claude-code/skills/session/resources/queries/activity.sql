-- Session interaction profile: how work enters and flows through sessions, drawn from
-- the structured records that the chat-only views miss. Distinguishes human-driven
-- signals (prompts, interruptions) from automated ones (auto-continuations, scheduled
-- fires, queued goals), and reports compactions, API retries, hook friction, and the
-- distribution of permission modes. One labeled row per signal.
-- Several signal kinds (last-prompt, queue-operation, permission-mode) carry no
-- timestamp of their own, which date_filter would silently exclude (NULL >= x is
-- NULL); those rows borrow their session's last timestamp so a date window scopes
-- them by when the session ran instead of dropping them.
-- Params: after_date, before_date, project, host.
WITH session_ts AS (
  SELECT host, session_id, MAX(timestamp) AS last_ts
  FROM records
  WHERE timestamp IS NOT NULL
  GROUP BY host, session_id
),
base AS (
  SELECT *
  FROM (
    SELECT r.*, COALESCE(r.timestamp, s.last_ts) AS effective_ts
    FROM records r
    LEFT JOIN session_ts s ON s.host = r.host AND s.session_id = r.session_id
  )
  WHERE date_filter(effective_ts, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
)
SELECT signal, count
FROM (
  SELECT 'prompts submitted' AS signal,
         COUNT(*) AS count, 1 AS ord
    FROM base WHERE type = 'last-prompt'
  UNION ALL
  SELECT 'interruptions',
         COUNT(*), 2
    FROM base
   WHERE type = 'user'
     AND CAST(data->'$.message.content' AS VARCHAR) LIKE '%[Request interrupted%'
  UNION ALL
  SELECT 'auto-continuations',
         COUNT(*), 3
    FROM base
   WHERE attachment_kind = 'queued_command'
     AND (data->>'$.attachment.origin.kind') = 'auto-continuation'
  UNION ALL
  SELECT 'queued goals/commands',
         COUNT(*), 4
    FROM base WHERE type = 'queue-operation' AND (data->>'$.operation') = 'enqueue'
  UNION ALL
  SELECT 'scheduled fires (loop/cron)',
         COUNT(*), 5
    FROM base WHERE kind = 'system:scheduled_task_fire'
  UNION ALL
  SELECT 'compactions',
         COUNT(*), 6
    FROM base WHERE kind = 'system:compact_boundary'
  UNION ALL
  -- system:api_error stopped being emitted around CLI 2.1.179; newer versions mark
  -- the synthetic assistant message instead, so count both surfaces.
  SELECT 'api errors/retries',
         COUNT(*), 7
    FROM base
   WHERE kind = 'system:api_error'
      OR (type = 'assistant' AND (data->>'$.isApiErrorMessage') = 'true')
  UNION ALL
  SELECT 'hook blocks/asks',
         COUNT(*), 8
    FROM hook_blocks
   WHERE date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
     AND project_filter(project_path, getvariable('project'))
     AND host_filter(host, getvariable('host'))
  UNION ALL
  SELECT 'mode: ' || COALESCE(permission_mode, '(none)'),
         COUNT(*), 9
    FROM base WHERE type = 'permission-mode'
   GROUP BY permission_mode
) t
ORDER BY ord, signal;
