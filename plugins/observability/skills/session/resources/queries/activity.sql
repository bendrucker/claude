-- ---
-- name: activity
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
-- Interruptions count text items opening with the `[Request interrupted` marker, so a tool
-- result quoting it does not count. `$.interruptedMessageId`
-- names the message that was cut off but is set on well under half the marked turns, so
-- it identifies an interruption rather than counting them.
--
-- Several signal kinds (queue-operation, permission-mode) carry no timestamp of their
-- own, which date_filter would silently exclude (NULL >= x is NULL); those rows borrow
-- their session's last timestamp so a date window scopes them by when the session ran
-- instead of dropping them.
WITH scoped AS NOT MATERIALIZED (
  SELECT * FROM records
  WHERE date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'))
),
-- permission-mode records carry no timestamp, so each counts at its session's last
-- timestamped record, as if it were written then. A session's maximum over the records
-- at or after the window's start equals its overall maximum whenever that falls in the
-- window, so the scan keeps the window's pruning.
last_ts AS (
  SELECT host, session_id, MAX(timestamp) AS last_ts
  FROM records
  WHERE timestamp >= COALESCE(getvariable('after_date')::TIMESTAMP, '-infinity'::TIMESTAMP)
  GROUP BY host, session_id
),
modes AS (
  SELECT r.permission_mode
  FROM records r
  LEFT JOIN last_ts s USING (host, session_id)
  WHERE r.type = 'permission-mode'
    AND date_filter(s.last_ts, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(r.project_path, getvariable('project'))
    AND host_filter(r.host, getvariable('host'))
)
SELECT signal, count
FROM (
  SELECT 'prompt: ' || prompt_source AS signal, COUNT(*) AS count, 1 AS ord
    FROM messages
   WHERE prompt_source IS NOT NULL
     AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
     AND project_filter(project_path, getvariable('project'))
     AND host_filter(host, getvariable('host'))
   GROUP BY 1
  UNION ALL
  SELECT 'interruptions',
         COUNT(*), 2
    FROM content_items
   WHERE type = 'text'
     AND starts_with(text, '[Request interrupted')
     AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
     AND project_filter(project_path, getvariable('project'))
     AND host_filter(host, getvariable('host'))
  UNION ALL
  -- `promptSource` flattens every queued turn to `queued`. The queued_command
  -- attachment names who queued it, so the breakdown keeps an auto-continuation
  -- distinguishable from a prompt the user typed ahead.
  SELECT 'queued command: ' || COALESCE((data->>'$.attachment.origin.kind'), 'unattributed'),
         COUNT(*), 3
    FROM scoped WHERE attachment_kind = 'queued_command'
   GROUP BY 1
  UNION ALL
  SELECT 'queued goals/commands',
         COUNT(*), 4
    FROM scoped WHERE type = 'queue-operation' AND (data->>'$.operation') = 'enqueue'
  UNION ALL
  SELECT 'scheduled fires (loop/cron)',
         COUNT(*), 5
    FROM scoped WHERE kind = 'system:scheduled_task_fire'
  UNION ALL
  SELECT 'compactions',
         COUNT(*), 6
    FROM scoped WHERE kind = 'system:compact_boundary'
  UNION ALL
  -- system:api_error stopped being emitted around CLI 2.1.179; newer versions mark
  -- the synthetic assistant message instead, so count both surfaces.
  SELECT 'api errors/retries',
         (SELECT COUNT(*) FROM scoped WHERE kind = 'system:api_error')
           + (SELECT COUNT(*) FROM messages
               WHERE type = 'assistant'
                 AND is_api_error
                 AND date_filter(timestamp, getvariable('after_date'), getvariable('before_date'))
                 AND project_filter(project_path, getvariable('project'))
                 AND host_filter(host, getvariable('host'))),
         7
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
    FROM modes
   GROUP BY permission_mode
) t
ORDER BY ord, signal;
