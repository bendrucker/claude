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
--   Threads group by the dispatching `tags->>'by'` (missing tag becomes `untagged`)
--   and the current `outcome`. `with_session` counts threads whose `session` matched
--   a row in the `sessions` view, LEFT joined so an unmatched or orphaned session
--   still counts toward `threads`. `median_hours_to_done`/`max_hours_to_done` cover
--   threads whose current outcome is `done`, measured from the dispatch row's `ts` to
--   the done row's `ts`. `prs` counts threads carrying a non-null `pr`.
--
--   Legacy rows predate `outcome`, `path`, and `tags`, so the ledger is read with
--   `union_by_name` and `ignore_errors` rather than a fixed schema. `tags` is a JSON
--   object whose keys vary and which is absent on rows before it existed, so it's read
--   with `->>'key'` rather than struct access. `after_date`/`before_date` scope the
--   dispatch `ts`; `project`/`host` scope the joined session, and a thread with no
--   matched session passes both.
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
  FROM read_json_auto(
    COALESCE(
      TRY_CAST(getvariable('ledger_path') AS VARCHAR),
      '~/.claude/plugins/data/herdr-bendrucker/dispatches.jsonl'
    ),
    ignore_errors := true,
    union_by_name := true
  )
),
threads AS (
  SELECT
    repo,
    branch,
    MIN(ts)                                                       AS dispatch_ts,
    MAX(ts)                                                       AS current_ts,
    arg_max(outcome, ts)                                          AS outcome,
    COALESCE(
      arg_max(tags->>'by', ts) FILTER (WHERE tags->>'by' IS NOT NULL),
      'untagged'
    )                                                              AS dispatched_by,
    arg_max(session, ts) FILTER (WHERE session IS NOT NULL)        AS session_id,
    bool_or(pr IS NOT NULL)                                        AS has_pr
  FROM ledger
  GROUP BY repo, branch
)
SELECT
  t.dispatched_by                                                   AS "by",
  t.outcome,
  COUNT(*)                                                          AS threads,
  COUNT(*) FILTER (WHERE s.session_id IS NOT NULL)                  AS with_session,
  ROUND(
    median(date_diff('second', t.dispatch_ts, t.current_ts) / 3600.0)
      FILTER (WHERE t.outcome = 'done'), 2)                         AS median_hours_to_done,
  ROUND(
    max(date_diff('second', t.dispatch_ts, t.current_ts) / 3600.0)
      FILTER (WHERE t.outcome = 'done'), 2)                         AS max_hours_to_done,
  COUNT(*) FILTER (WHERE t.has_pr)                                  AS prs
FROM threads t
LEFT JOIN sessions s ON s.session_id = t.session_id
WHERE date_filter(t.dispatch_ts, getvariable('after_date'), getvariable('before_date'))
  AND (s.session_id IS NULL OR project_filter(s.project_path, getvariable('project')))
  AND (s.session_id IS NULL OR host_filter(s.host, getvariable('host')))
GROUP BY t.dispatched_by, t.outcome
ORDER BY threads DESC, "by", t.outcome;
