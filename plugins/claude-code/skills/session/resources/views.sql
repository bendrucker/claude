CREATE OR REPLACE VIEW messages AS
SELECT
  r.* EXCLUDE (data, summary),
  r.data,
  CASE
    WHEN json_type(r.data->'$.message.content') = 'VARCHAR'
    THEN r.data->>'$.message.content'
  END AS content_text,
  (r.data->>'$.message.model') AS model,
  TRY_CAST(r.data->>'$.message.usage.cache_read_input_tokens'     AS BIGINT) AS cache_read_tokens,
  TRY_CAST(r.data->>'$.message.usage.cache_creation_input_tokens' AS BIGINT) AS cache_creation_tokens,
  (r.data->>'$.attributionSkill')     AS attribution_skill,
  (r.data->>'$.attributionPlugin')    AS attribution_plugin,
  (r.data->>'$.attributionAgent')     AS attribution_agent,
  (r.data->>'$.attributionMcpServer') AS attribution_mcp_server,
  (r.data->>'$.attributionMcpTool')   AS attribution_mcp_tool,
  s.summary
FROM raw r
LEFT JOIN (
  SELECT host, session_id, ANY_VALUE(summary) AS summary
  FROM raw
  WHERE type = 'summary' AND summary IS NOT NULL
  GROUP BY host, session_id
) s USING (host, session_id)
WHERE r.type IN ('user', 'assistant');

-- Per-message usage, deduped. Claude Code writes one JSONL row per content block, and
-- every row repeats the parent message's cumulative usage, so summing token columns
-- per-row inflates totals 2-3.5x. One row per assistant message (keyed by the API
-- message id, falling back to the record uuid), taking MAX of each usage column.
-- `content_rows` preserves the raw row count for queries that need it.
CREATE OR REPLACE VIEW message_usage AS
SELECT
  host,
  session_id,
  COALESCE((data->>'$.message.id'), (data->>'$.uuid')) AS message_id,
  ANY_VALUE(project_path) AS project_path,
  MIN(timestamp)          AS timestamp,
  ANY_VALUE(model)        AS model,
  ANY_VALUE(attribution_skill)  AS attribution_skill,
  ANY_VALUE(attribution_plugin) AS attribution_plugin,
  ANY_VALUE(attribution_agent)  AS attribution_agent,
  MAX(input_tokens)           AS input_tokens,
  MAX(output_tokens)          AS output_tokens,
  MAX(cache_read_tokens)      AS cache_read_tokens,
  MAX(cache_creation_tokens)  AS cache_creation_tokens,
  COUNT(*)                    AS content_rows
FROM messages
WHERE type = 'assistant'
GROUP BY host, session_id, message_id;

-- Session rewind/resume replays JSONL lines verbatim (same uuid, usually later in the
-- same file), so tool_use/tool_result rows would double-count without dedupe. Two
-- passes: drop replayed source lines (same record uuid, keep the latest copy), then
-- drop residual duplicate tool ids that arrive under fresh uuids (e.g. an Agent
-- tool_use echoed into its subagent transcript).
CREATE OR REPLACE TABLE content_items AS
WITH src AS (
  SELECT
    r.host,
    r.session_id,
    r.timestamp,
    r.project_path,
    r.source_file,
    r.source_line,
    r.data->'$.message.content' AS message_content,
    r.data->'$.toolUseResult'   AS tool_use_result,
    r.data->>'$.attributionSkill'  AS attribution_skill,
    r.data->>'$.attributionPlugin' AS attribution_plugin,
    r.data->>'$.attributionAgent'  AS attribution_agent
  FROM raw r
  WHERE r.type IN ('user', 'assistant')
  QUALIFY (r.data->>'$.uuid') IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY r.host, r.session_id, (r.data->>'$.uuid')
         ORDER BY r.source_line DESC, r.source_file DESC
       ) = 1
)
SELECT
  s.host,
  s.session_id,
  s.timestamp,
  s.project_path,
  s.source_file,
  s.source_line,
  (item->>'$.type')        AS type,
  (item->>'$.name')        AS name,
  (item->>'$.id')          AS id,
  (item->>'$.tool_use_id') AS tool_use_id,
  (item->>'$.text')        AS text,
  (item->>'$.content')     AS content,
  TRY_CAST(item->>'$.is_error' AS BOOLEAN) AS is_error,
  item AS data,
  s.tool_use_result,
  s.attribution_skill,
  s.attribution_plugin,
  s.attribution_agent
FROM src s,
LATERAL (SELECT unnest(json_extract(s.message_content, '$[*]')) AS item) t
WHERE json_type(s.message_content) = 'ARRAY'
QUALIFY COALESCE(id, tool_use_id) IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY s.host, type, COALESCE(id, tool_use_id)
       ORDER BY s.source_line DESC, s.source_file DESC
     ) = 1;

CREATE OR REPLACE VIEW tool_calls AS
SELECT
  name AS tool_name,
  id   AS tool_id,
  host,
  session_id,
  project_path,
  timestamp,
  (data->>'$.input.file_path')   AS file_path,
  (data->>'$.input.command')     AS command,
  attribution_skill,
  attribution_plugin,
  attribution_agent
FROM content_items
WHERE type = 'tool_use' AND name IS NOT NULL;

CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id   AS tool_id,
  er.content       AS error_content,
  COALESCE(tc.tool_name, 'unknown') AS tool_name,
  er.host,
  er.session_id,
  tc.project_path,
  er.timestamp,
  CASE WHEN er.tool_use_result::VARCHAR = '"User rejected tool use"'
       THEN 'rejection' ELSE 'failure' END AS error_type
FROM content_items er
LEFT JOIN tool_calls tc ON er.tool_use_id = tc.tool_id AND er.host = tc.host
WHERE er.type = 'tool_result' AND er.is_error;

CREATE OR REPLACE VIEW skill_calls AS
SELECT
  (data->>'$.input.skill') AS skill_name,
  NULLIF((data->>'$.input.args'), '') AS args,
  id AS tool_id,
  host,
  session_id,
  project_path,
  timestamp
FROM content_items
WHERE type = 'tool_use'
  AND name = 'Skill'
  AND (data->>'$.input.skill') IS NOT NULL;

CREATE OR REPLACE VIEW permission_requests AS
SELECT
  tc.name AS tool_name,
  tc.id   AS tool_id,
  (tc.data->>'$.input.command')     AS command,
  (tc.data->>'$.input.file_path')   AS file_path,
  (tc.data->>'$.input.description') AS description,
  tc.host,
  tc.session_id,
  tc.project_path,
  tc.timestamp
FROM content_items er
JOIN content_items tc ON er.tool_use_id = tc.id AND er.host = tc.host
WHERE er.type = 'tool_result'
  AND er.tool_use_result::VARCHAR = '"User rejected tool use"';

CREATE OR REPLACE VIEW sandbox_bypasses AS
WITH bypass AS (
  SELECT
    (data->>'$.input.command')     AS command,
    (data->>'$.input.description') AS description,
    id AS tool_id,
    host,
    session_id,
    project_path,
    timestamp
  FROM content_items
  WHERE type = 'tool_use'
    AND name = 'Bash'
    AND (data->>'$.input.dangerouslyDisableSandbox') = 'true'
)
SELECT
  b.command,
  b.description,
  b.tool_id,
  b.host,
  b.session_id,
  b.project_path,
  b.timestamp,
  prior.tool_id AS retried_tool_id,
  prior.error   AS retried_error
FROM bypass b
LEFT JOIN LATERAL (
  SELECT tc.id AS tool_id, er.content AS error
  FROM content_items tc
  JOIN content_items er
    ON er.tool_use_id = tc.id AND er.host = tc.host
       AND er.type = 'tool_result' AND er.is_error
  WHERE tc.type = 'tool_use'
    AND tc.name = 'Bash'
    AND COALESCE((tc.data->>'$.input.dangerouslyDisableSandbox'), 'false') = 'false'
    AND tc.host = b.host
    AND tc.session_id = b.session_id
    AND tc.timestamp  < b.timestamp
    AND (tc.data->>'$.input.command') = b.command
  ORDER BY tc.timestamp DESC
  LIMIT 1
) prior ON true;

CREATE OR REPLACE VIEW text_content AS
WITH unified AS (
  SELECT
    ci.host,
    ci.session_id,
    ci.timestamp,
    ci.project_path,
    m.type AS role,
    CASE WHEN m.type = 'assistant' THEN (m.data->>'$.message.model') END AS model,
    ci.text AS raw_text,
    ci.source_file,
    ci.source_line,
    ci.source_file LIKE '%/subagents/%' AS is_subagent,
    ci.text LIKE '<%'
      OR ci.text LIKE '[Request interrupted%'
    AS is_system
  FROM content_items ci
  JOIN messages m USING (host, source_file, source_line)
  WHERE ci.type = 'text'
    AND ci.text IS NOT NULL
    AND length(trim(ci.text)) > 0
    AND NOT m.is_meta

  UNION ALL

  SELECT
    m.host,
    m.session_id,
    m.timestamp,
    m.project_path,
    m.type AS role,
    NULL AS model,
    m.content_text AS raw_text,
    m.source_file,
    m.source_line,
    m.source_file LIKE '%/subagents/%' AS is_subagent,
    m.content_text LIKE '<%'
      OR m.content_text LIKE '[Request interrupted%'
      OR m.content_text LIKE 'Implement the following plan:%'
      OR m.content_text LIKE 'This session is being continued from a previous conversation%'
      OR m.content_text LIKE 'Goal set:%'
      OR m.content_text LIKE 'Ultraplan %'
      OR m.content_text LIKE '◇ %'
      OR m.content_text LIKE '◆ %'
    AS is_system
  FROM messages m
  WHERE m.type = 'user'
    AND m.content_text IS NOT NULL
    AND length(trim(m.content_text)) > 0
    AND NOT m.is_meta
)
SELECT
  host,
  session_id,
  timestamp,
  project_path,
  role,
  model,
  regexp_replace(
    regexp_replace(raw_text, '```.*?```', '', 'gs'),
    '`[^`\n]*`', '', 'g'
  ) AS text,
  raw_text,
  source_file,
  source_line,
  is_subagent,
  is_system
FROM unified;

CREATE OR REPLACE VIEW sessions AS
SELECT
  host,
  session_id,
  project_id(host, ANY_VALUE(project_path)) AS project_id,
  ANY_VALUE(summary) AS summary,
  MIN(timestamp) AS start_time,
  MAX(timestamp) AS end_time,
  MAX(timestamp) - MIN(timestamp) AS duration,
  ANY_VALUE(project_path) AS project_path,
  ANY_VALUE(git_branch)   AS git_branch,
  COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) AS user_messages,
  COUNT(*) FILTER (WHERE type = 'assistant')            AS assistant_messages
FROM messages
GROUP BY host, session_id
HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0;

-- Universal record union. One row per JSONL line of every type, with a normalized
-- `kind` label (type, plus subtype/attachment kind when present) and the cross-cutting
-- dimensions every record may carry. This is the anti-blindness backbone: the full
-- taxonomy is `SELECT kind, COUNT(*) FROM records GROUP BY kind`, and `data` holds the
-- complete original line for drilling into anything not pinned here. Extraction is via
-- `->>` (text) so divergent value types never error.
CREATE OR REPLACE VIEW records AS
SELECT
  host,
  session_id,
  project_path,
  git_branch,
  timestamp,
  source_file,
  source_line,
  is_meta,
  is_sidechain,
  type,
  (data->>'$.subtype')         AS subtype,
  (data->>'$.attachment.type') AS attachment_kind,
  type
    || COALESCE(':' || (data->>'$.subtype'), '')
    || COALESCE(':' || (data->>'$.attachment.type'), '') AS kind,
  (data->>'$.uuid')            AS uuid,
  (data->>'$.parentUuid')      AS parent_uuid,
  (data->>'$.permissionMode')  AS permission_mode,
  (data->>'$.version')         AS version,
  (data->>'$.slug')            AS slug,
  data
FROM raw;

-- Every attachment record (the richest non-chat category: hooks, diagnostics,
-- skill/tool listings, plan/auto mode, queued commands, command permissions, ...).
-- `kind` is the attachment subtype; `attachment` is its full payload.
-- Replayed lines (rewind/resume, same uuid) are deduped so per-event counts stay
-- one row per event; the latest copy wins.
CREATE OR REPLACE VIEW attachments AS
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  source_file,
  source_line,
  (data->>'$.attachment.type')      AS kind,
  (data->>'$.attachment.hookName')  AS hook_name,
  (data->>'$.attachment.hookEvent') AS hook_event,
  (data->>'$.attachment.toolUseID') AS tool_use_id,
  (data->'$.attachment')            AS attachment,
  data
FROM raw
WHERE type = 'attachment'
QUALIFY (data->>'$.uuid') IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY host, session_id, (data->>'$.uuid')
       ORDER BY source_line DESC, source_file DESC
     ) = 1;

-- System events: per-turn timing, stop-hook summaries, compaction boundaries,
-- API errors/retries, scheduled-task fires, local slash commands, away summaries.
-- Pins the high-value payload fields per subtype defensively (TRY_CAST).
CREATE OR REPLACE VIEW system_events AS
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  source_file,
  source_line,
  (data->>'$.subtype') AS subtype,
  (data->>'$.level')   AS level,
  (data->>'$.content') AS content,
  TRY_CAST(data->>'$.durationMs'   AS BIGINT) AS duration_ms,
  TRY_CAST(data->>'$.messageCount' AS BIGINT) AS message_count,
  TRY_CAST(data->>'$.hookCount'    AS INTEGER) AS hook_count,
  TRY_CAST(data->>'$.preventedContinuation' AS BOOLEAN) AS prevented_continuation,
  (data->>'$.stopReason')              AS stop_reason,
  (data->>'$.compactMetadata.trigger') AS compact_trigger,
  TRY_CAST(data->>'$.compactMetadata.preTokens'  AS BIGINT) AS compact_pre_tokens,
  TRY_CAST(data->>'$.compactMetadata.durationMs' AS BIGINT) AS compact_duration_ms,
  (data->>'$.cause.code')                  AS error_code,
  TRY_CAST(data->>'$.retryAttempt' AS INTEGER) AS retry_attempt,
  data
FROM raw
WHERE type = 'system';

-- Hook executions, flattened from `hook_*` attachment records. Covers every event
-- (PreToolUse, PostToolUse, Stop, SessionStart, UserPromptSubmit, PermissionRequest).
-- A PreToolUse deny/ask is recorded as a hook_success whose decision lives inside the
-- stdout JSON (hookSpecificOutput.permissionDecision), so the decision/reason are
-- parsed from there; exit-2 blocks arrive as hook_blocking_error. `command` names the
-- exact hook script (NULL for blocking_error / permission_decision records).
CREATE OR REPLACE VIEW hook_events AS
WITH att AS (
  -- Dedupe replayed lines (rewind/resume, same uuid) so a block never counts twice.
  SELECT
    host, session_id, project_path, timestamp, source_file, source_line,
    (data->'$.attachment') AS a
  FROM raw
  WHERE type = 'attachment'
    AND (data->>'$.attachment.type') LIKE 'hook%'
  QUALIFY (data->>'$.uuid') IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY host, session_id, (data->>'$.uuid')
         ORDER BY source_line DESC, source_file DESC
       ) = 1
),
parsed AS (
  SELECT
    att.*,
    (a->>'$.type') AS kind,
    TRY_CAST(regexp_extract(COALESCE(a->>'$.stdout', ''), '\{.*\}') AS JSON) AS sj
  FROM att
),
-- Resolve the permission decision once: a PreToolUse deny/ask lands in the stdout
-- JSON, an exit-2 block lands as hook_blocking_error, and some events carry a bare
-- `decision`. Computed here so the SELECT and the `blocked` flag share one source.
decided AS (
  SELECT
    parsed.*,
    COALESCE(
      (a->>'$.decision'),
      sj->>'$.hookSpecificOutput.permissionDecision',
      sj->>'$.permissionDecision',
      sj->>'$.decision'
    ) AS decision
  FROM parsed
)
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  source_file,
  source_line,
  kind,
  (a->>'$.hookEvent') AS hook_event,
  (a->>'$.hookName')  AS hook_name,
  (a->>'$.command')   AS command,
  (a->>'$.toolUseID') AS tool_use_id,
  TRY_CAST(a->>'$.exitCode'   AS INTEGER) AS exit_code,
  TRY_CAST(a->>'$.durationMs' AS BIGINT)  AS duration_ms,
  decision,
  COALESCE(
    sj->>'$.hookSpecificOutput.permissionDecisionReason',
    sj->>'$.reason',
    -- blockingError arrives wrapped as {"blockingError": "<message>"}; pull the message
    TRY_CAST(a->>'$.blockingError' AS JSON)->>'$.blockingError',
    NULLIF(a->>'$.blockingError', ''),
    NULLIF(a->>'$.stderr', '')
  ) AS reason,
  sj->>'$.hookSpecificOutput.additionalContext' AS additional_context,
  kind = 'hook_blocking_error' OR decision = 'deny' AS blocked,
  (a->>'$.stdout')        AS stdout,
  (a->>'$.stderr')        AS stderr,
  (a->>'$.content')       AS content,
  (a->>'$.blockingError') AS blocking_error,
  a AS attachment
FROM decided;

-- The friction surface: hook events that stopped or interrupted a tool call or the
-- model. `decision` is deny/ask/block; `reason` is the message the hook surfaced.
-- Use this to find hooks that overfire (high counts, repeated blocks within a session).
CREATE OR REPLACE VIEW hook_blocks AS
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  hook_event,
  hook_name,
  command,
  tool_use_id,
  kind,
  COALESCE(decision, CASE WHEN kind = 'hook_blocking_error' THEN 'block' END) AS decision,
  reason
FROM hook_events
WHERE blocked OR decision IN ('ask', 'deny');

-- LSP / type-checker / linter diagnostics surfaced in-session, one row per diagnostic.
-- The richest signal for "what errors do I keep introducing": group by code/source to
-- find recurring failure classes, or by file to find trouble spots.
CREATE OR REPLACE VIEW diagnostics AS
SELECT
  a.host,
  a.session_id,
  a.project_path,
  a.timestamp,
  (f.value->>'$.uri')        AS file,
  (dg.value->>'$.severity')  AS severity,
  (dg.value->>'$.source')    AS source,
  (dg.value->>'$.code')      AS code,
  (dg.value->>'$.message')   AS message
FROM attachments a,
LATERAL (SELECT unnest(json_extract(a.attachment, '$.files[*]')) AS value) f,
LATERAL (SELECT unnest(json_extract(f.value, '$.diagnostics[*]')) AS value) dg
WHERE a.kind = 'diagnostics'
  AND json_type(a.attachment->'$.files') = 'ARRAY';

-- File activity: every Read/Write/Edit/NotebookEdit, with the operation, target path,
-- and the skill/plugin/agent it was attributed to. "What do I work on, and under what."
CREATE OR REPLACE VIEW file_operations AS
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  tool_name AS operation,
  file_path,
  attribution_skill,
  attribution_plugin,
  attribution_agent
FROM tool_calls
WHERE tool_name IN ('Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit')
  AND file_path IS NOT NULL;

-- Pull requests opened from a session, linking session_id to the PR it produced.
-- The outcome side of the loop: join back to sessions to see what work shipped.
CREATE OR REPLACE VIEW pr_links AS
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  TRY_CAST(data->>'$.prNumber' AS BIGINT) AS pr_number,
  (data->>'$.prRepository')               AS repository,
  (data->>'$.prUrl')                      AS url
FROM raw
WHERE type = 'pr-link';

-- Plan-mode calls: one row per ExitPlanMode tool_use, joined with its tool_result to
-- classify the outcome. `plan_seq` is 1-based within the session ordered by timestamp.
-- Outcome classification: 'approved' when the result contains "approved your plan";
-- 'handoff' when the session's last plan was rejected and no file edits follow it in
-- that session (the user deliberately ends the session on the plan and implements
-- from the plan file in a fresh one); 'redirected' for any other rejection (the user
-- typed feedback instead of clicking approve, mid-session churn); 'unknown' for
-- anything else (cancelled, null, etc.). Full plan text is in `data->'$.input.plan'`;
-- not materialized here because plans can be several KB each.
CREATE OR REPLACE VIEW plan_calls AS
WITH calls AS (
  SELECT
    ci.host,
    ci.session_id,
    ci.project_path,
    ci.timestamp,
    ci.id AS tool_use_id,
    (ci.data->>'$.input.planFilePath') AS plan_file,
    length(json_extract_string(ci.data, '$.input.plan')) AS plan_chars,
    r.content AS result_content
  FROM content_items ci
  LEFT JOIN content_items r
    ON r.tool_use_id = ci.id
   AND r.host = ci.host
   AND r.type = 'tool_result'
  WHERE ci.type = 'tool_use'
    AND ci.name = 'ExitPlanMode'
),
seq AS (
  SELECT
    calls.*,
    ROW_NUMBER() OVER (
      PARTITION BY host, session_id
      ORDER BY timestamp
    ) AS plan_seq,
    ROW_NUMBER() OVER (
      PARTITION BY host, session_id
      ORDER BY timestamp DESC
    ) = 1 AS is_terminal
  FROM calls
)
SELECT
  host,
  session_id,
  project_path,
  timestamp,
  tool_use_id,
  plan_file,
  plan_chars,
  CASE
    WHEN (result_content) LIKE '%approved your plan%'              THEN 'approved'
    WHEN (result_content) LIKE '%want to proceed%'
      OR (result_content) LIKE '%was rejected%'                    THEN
      CASE
        WHEN is_terminal AND NOT EXISTS (
          SELECT 1
          FROM tool_calls tc
          WHERE tc.host = seq.host
            AND tc.session_id = seq.session_id
            AND tc.tool_name IN ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
            AND tc.file_path IS NOT NULL
            AND tc.timestamp > seq.timestamp
        ) THEN 'handoff'
        ELSE 'redirected'
      END
    ELSE 'unknown'
  END AS outcome,
  plan_seq
FROM seq;

-- Session-level plan aggregates: one row per session that used plan mode, with counts
-- broken down by outcome. `redirect_count` is mid-session churn only; a terminal
-- rejection with no edits afterward lands in `handoff_count` (see plan_calls).
CREATE OR REPLACE VIEW plan_sessions AS
SELECT
  host,
  session_id,
  ANY_VALUE(project_path)                                AS project_path,
  COUNT(*)                                               AS plan_count,
  COUNT(*) FILTER (WHERE outcome = 'redirected')         AS redirect_count,
  COUNT(*) FILTER (WHERE outcome = 'approved')           AS approved_count,
  COUNT(*) FILTER (WHERE outcome = 'handoff')            AS handoff_count,
  COUNT(*) FILTER (WHERE outcome = 'unknown')            AS unknown_count,
  MIN(timestamp)                                         AS first_plan_ts,
  MAX(timestamp)                                         AS last_plan_ts
FROM plan_calls
GROUP BY host, session_id;
