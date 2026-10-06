-- ---
-- name: activity
-- tier: 1
-- summary: >-
--   Session interaction profile: one row per prompt source, plus interruptions, queued
--   goals, scheduled fires, compactions, API retries, hook friction, and the distribution
--   of permission modes.
-- description: >-
--   A `prompt: <source>` row carries the harness's own `$.promptSource` (`typed`, `system`,
--   `queued`, `sdk`, `suggestion_accepted`), which is where human-versus-automated entry
--   now comes from. A `queued command: <origin>` row keeps the finer split `promptSource`
--   collapses, since a `queued` prompt may be an auto-continuation, a peer's message, or
--   one the user typed ahead. `promptSource` starts 2026-06-03, so an earlier window
--   reports no prompts at all rather than a partial count.
-- params:
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
-- The `last-prompt` record is not a substitute for `promptSource`: it is a per-session
-- snapshot the harness rewrites every turn, so counting its rows counts rewrites (55,592
-- rows across 2,131 sessions when this was checked).
--
-- Interruptions stay on the `[Request interrupted` marker text. `$.interruptedMessageId`
-- names the message that was cut off but is set on well under half the marked turns, so
-- it identifies an interruption rather than counting them.
--
-- Several signal kinds (queue-operation, permission-mode) carry no timestamp of their
-- own, which date_filter would silently exclude (NULL >= x is NULL); those rows borrow
-- their session's last timestamp so a date window scopes them by when the session ran
-- instead of dropping them.
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
  SELECT 'prompt: ' || (data->>'$.promptSource') AS signal,
         COUNT(*) AS count, 1 AS ord
    FROM base WHERE (data->>'$.promptSource') IS NOT NULL
   GROUP BY 1
  UNION ALL
  SELECT 'interruptions',
         COUNT(*), 2
    FROM base
   WHERE type = 'user'
     AND CAST(data->'$.message.content' AS VARCHAR) LIKE '%[Request interrupted%'
  UNION ALL
  -- `promptSource` flattens every queued turn to `queued`. The queued_command
  -- attachment names who queued it, so the breakdown keeps an auto-continuation
  -- distinguishable from a prompt the user typed ahead.
  SELECT 'queued command: ' || COALESCE((data->>'$.attachment.origin.kind'), 'unattributed'),
         COUNT(*), 3
    FROM base WHERE attachment_kind = 'queued_command'
   GROUP BY 1
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
