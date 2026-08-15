-- Map `Operation not permitted` (and adjacent) Bash failures to concrete sandbox config
-- gaps (worktree writes, tmux sockets, process substitution, mktemp, TLS, SSH agent),
-- with session recurrence and date span, so each failure class becomes a settings diff.
--
-- `agent_threads` counts distinct (session, agent) contexts, `sessions` only distinct
-- transcripts. Subagents stamp their rows with the parent's session id, so one fan-out
-- where every agent hits the same gap once reads as a single session dominating a
-- category. Rank on `agent_threads` to see recurrence across real work.
-- Params: after_date, before_date, project, host.
WITH errs AS (
  SELECT te.host, te.session_id, te.agent_id, te.error_content, te.timestamp
  FROM tool_errors te
  JOIN sessions s USING (host, session_id)
  WHERE te.error_type = 'failure'
    AND date_filter(s.start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(s.project_path, getvariable('project'))
    AND host_filter(s.host, getvariable('host'))
)
SELECT
  host,
  CASE
    WHEN error_content LIKE '%/worktrees/agent-%Operation not permitted%' THEN 'worktree-agent-write'
    WHEN error_content LIKE '%/.tmux/%' THEN 'tmux-socket'
    WHEN error_content LIKE '%/dev/fd/%' THEN 'process-substitution'
    WHEN error_content LIKE '%mktemp%' OR error_content LIKE '%mkstemp%' OR error_content LIKE '%mkdtemp%' THEN 'mktemp'
    WHEN error_content LIKE '%failed to verify certificate%' OR error_content LIKE '%OSStatus -26276%' THEN 'tls-github'
    WHEN error_content LIKE '%signing failed for ECDSA%' OR error_content LIKE '%agent refused%'
      OR error_content LIKE '%communication with agent failed%' THEN 'ssh-agent'
  END AS cat,
  COUNT(*)                   AS n,
  COUNT(DISTINCT session_id) AS sessions,
  COUNT(DISTINCT (session_id, agent_id)) AS agent_threads,
  MIN(timestamp)::DATE       AS first_d,
  MAX(timestamp)::DATE       AS last_d
FROM errs
GROUP BY host, cat
HAVING cat IS NOT NULL
ORDER BY host, n DESC;
