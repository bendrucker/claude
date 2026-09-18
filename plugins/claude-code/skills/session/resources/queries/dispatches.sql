-- ---
-- name: dispatches
-- tier: 1
-- dimensions: [outcomes]
-- summary: >-
--   Herdr dispatch-ledger threads grouped by dispatcher and current outcome, with
--   time-to-done and PR yield.
-- description: >-
--   Reads the append-only dispatch ledger at `ledger_path`, one JSON object per line.
--   A thread is a `(repo, branch)` pair; its rows are the thread's states in order, so
--   the earliest row by `ts` is the dispatch and the latest is the current state.
--   Threads group by the dispatching `(tags->>'by')` (missing tag becomes `untagged`)
--   and the current `outcome`. `with_session` counts threads whose `session` matched
--   a row in the `sessions` view (any host). `after_date`/`before_date` scope the
--   dispatch `ts`; `project`/`host` scope the joined session, so a session id absent
--   from the index entirely still counts toward `threads`, while one that exists under
--   a different host or project is filtered out. `median_hours_to_done`/
--   `max_hours_to_done` cover threads whose current outcome is `done`, measured from
--   the dispatch row's `ts` to the done row's `ts`. `prs` counts threads carrying a
--   non-null `pr`.
--
--   Ledger columns are declared explicitly via `columns` on `read_json` rather than
--   inferred, so a ledger with no row carrying `tags` or `pr` still binds those
--   columns as NULL instead of failing to reference them; a ledger from before `tags`,
--   `pr`, and the `done` outcome existed reads the same way. `ignore_errors` skips
--   malformed lines. `tags` is typed `JSON`, so it's read with `(tags->>'key')` rather
--   than struct access. The query errors with "No files found" until herdr has
--   written to `ledger_path`; point that param at an existing ledger, or wait for a
--   dispatch.
-- params:
--   - name: ledger_path
--     default: '~/.claude/plugins/data/herdr-bendrucker/dispatches.jsonl'
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH ledger AS (
  SELECT
    TRY_CAST(ts AS TIMESTAMP) AS ts,
    repo,
    branch,
    session,
    outcome,
    tags,
    pr
  FROM read_json(
    COALESCE(
      TRY_CAST(getvariable('ledger_path') AS VARCHAR),
      '~/.claude/plugins/data/herdr-bendrucker/dispatches.jsonl'
    ),
    columns := {
      'ts':        'VARCHAR',
      'task':      'VARCHAR',
      'repo':      'VARCHAR',
      'branch':    'VARCHAR',
      'path':      'VARCHAR',
      'workspace': 'VARCHAR',
      'pane':      'VARCHAR',
      'agent':     'VARCHAR',
      'session':   'VARCHAR',
      'outcome':   'VARCHAR',
      'tags':      'JSON',
      'pr':        'VARCHAR',
      'note':      'VARCHAR'
    },
    ignore_errors := true
  )
),
threads AS (
  SELECT
    repo,
    branch,
    MIN(ts)                                                              AS dispatch_ts,
    MAX(ts)                                                              AS current_ts,
    arg_max(outcome, ts)                                                 AS outcome,
    COALESCE(
      arg_max((tags->>'by'), ts) FILTER (WHERE (tags->>'by') IS NOT NULL),
      'untagged'
    )                                                                     AS dispatched_by,
    arg_max(session, ts) FILTER (WHERE session IS NOT NULL)               AS session_id,
    bool_or(pr IS NOT NULL)                                               AS has_pr
  FROM ledger
  GROUP BY repo, branch
)
SELECT
  t.dispatched_by                                                          AS "by",
  t.outcome,
  COUNT(*)                                                                 AS threads,
  COUNT(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM sessions s WHERE s.session_id = t.session_id)
  )                                                                        AS with_session,
  ROUND(
    median(date_diff('second', t.dispatch_ts, t.current_ts) / 3600.0)
      FILTER (WHERE t.outcome = 'done'), 2)                               AS median_hours_to_done,
  ROUND(
    max(date_diff('second', t.dispatch_ts, t.current_ts) / 3600.0)
      FILTER (WHERE t.outcome = 'done'), 2)                               AS max_hours_to_done,
  COUNT(*) FILTER (WHERE t.has_pr)                                        AS prs
FROM threads t
WHERE date_filter(t.dispatch_ts, getvariable('after_date'), getvariable('before_date'))
  AND (
    t.session_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.session_id = t.session_id)
    OR EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.session_id = t.session_id
        AND host_filter(s.host, getvariable('host'))
        AND project_filter(s.project_path, getvariable('project'))
    )
  )
GROUP BY t.dispatched_by, t.outcome
ORDER BY threads DESC, "by", t.outcome;
