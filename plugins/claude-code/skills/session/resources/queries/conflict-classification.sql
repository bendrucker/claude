-- Classify git conflict-resolution skill sessions: restack-context vs not, and
-- mechanical (lockfile / generated) vs semantic (code). The skill resolves a
-- lockfile conflict by regenerating it (bun install) rather than editing
-- bun.lock, so an Edit-on-lockfile signal undercounts. This keys off the files
-- staged before `git rebase --continue` (the true conflicted set) and the git
-- operation run under the skill.
WITH conflict_sessions AS (
  SELECT DISTINCT sc.host, sc.session_id
  FROM skill_calls sc
  JOIN sessions s USING (host, session_id)
  WHERE sc.skill_name IN ('git:conflicts', 'git:fix-conflicts')
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
),
skill_cmds AS (
  SELECT tc.host, tc.session_id, tc.command
  FROM tool_calls tc
  JOIN conflict_sessions cs USING (host, session_id)
  WHERE tc.attribution_skill IN ('git:conflicts', 'git:fix-conflicts')
    AND tc.command IS NOT NULL
),
per_session AS (
  SELECT
    cs.host,
    cs.session_id,
    BOOL_OR(c.command ILIKE '%rebase%' OR c.command ILIKE '%wt sync%' OR c.command ILIKE '%wt-sync%') AS is_restack,
    BOOL_OR(c.command ILIKE '%wt sync%' OR c.command ILIKE '%wt-sync%') AS used_wt_sync,
    -- A lockfile is the conflicted file only when it is staged for the rebase
    -- continue. Discards (`git checkout -- bun.lock`) and greps don't count.
    BOOL_OR(c.command ILIKE '%git add%' AND c.command ILIKE '%rebase --continue%'
            AND (c.command ILIKE '%bun.lock%' OR c.command ILIKE '%package-lock%' OR c.command ILIKE '%Cargo.lock%')) AS lockfile_conflict
  FROM conflict_sessions cs
  LEFT JOIN skill_cmds c USING (host, session_id)
  GROUP BY cs.host, cs.session_id
)
SELECT
  COUNT(*) AS total_sessions,
  COUNT(*) FILTER (WHERE is_restack) AS restack_sessions,
  COUNT(*) FILTER (WHERE used_wt_sync) AS wt_sync_sessions,
  COUNT(*) FILTER (WHERE lockfile_conflict) AS mechanical_lockfile_sessions,
  COUNT(*) FILTER (WHERE is_restack AND lockfile_conflict) AS restack_mechanical_sessions
FROM per_session;
