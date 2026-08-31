-- `prompt_source` labels how a user turn arrived (typed, system, queued, sdk,
-- suggestion_accepted) and is the harness's own answer to human-vs-automated; it starts
-- 2026-06-03, so it is NULL on every earlier row. `interrupted_message_id` names the
-- assistant message an interruption cut off, but the harness sets it on well under half
-- the turns that carry the `[Request interrupted` marker text, so it identifies the
-- interrupted message rather than counting interruptions.
CREATE OR REPLACE VIEW messages AS
SELECT
  r.* EXCLUDE (data),
  r.data,
  CASE
    WHEN json_type(r.data->'$.message.content') = 'VARCHAR'
    THEN r.data->>'$.message.content'
  END AS content_text,
  (r.data->>'$.message.model') AS model,
  TRY_CAST(r.data->>'$.message.usage.cache_read_input_tokens'     AS BIGINT) AS cache_read_tokens,
  TRY_CAST(r.data->>'$.message.usage.cache_creation_input_tokens' AS BIGINT) AS cache_creation_tokens,
  (r.data->>'$.promptSource')         AS prompt_source,
  (r.data->>'$.interruptedMessageId') AS interrupted_message_id,
  (r.data->>'$.attributionSkill')     AS attribution_skill,
  (r.data->>'$.attributionPlugin')    AS attribution_plugin,
  (r.data->>'$.attributionAgent')     AS attribution_agent,
  (r.data->>'$.attributionMcpServer') AS attribution_mcp_server,
  (r.data->>'$.attributionMcpTool')   AS attribution_mcp_tool
FROM raw r
WHERE r.type IN ('user', 'assistant');

-- One label per session, from the sidecar title records the harness writes beside the
-- transcript. A session can accumulate several as the title is regenerated or renamed, so
-- a user-set `custom-title` wins over a generated `ai-title`, which wins over the
-- `agent-name` a named agent session carries; within a kind the last one written wins.
-- These records carry `sessionId` but no timestamp, so recency is source order.
CREATE OR REPLACE VIEW session_labels AS
SELECT
  host,
  session_id,
  COALESCE(
    data->>'$.customTitle',
    data->>'$.aiTitle',
    data->>'$.agentName'
  ) AS label,
  type AS label_source
FROM raw
WHERE type IN ('custom-title', 'ai-title', 'agent-name')
  AND length(trim(COALESCE(
    data->>'$.customTitle',
    data->>'$.aiTitle',
    data->>'$.agentName',
    ''
  ))) > 0
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY host, session_id
  ORDER BY
    CASE type WHEN 'custom-title' THEN 1 WHEN 'ai-title' THEN 2 ELSE 3 END,
    source_line DESC,
    source_file DESC
) = 1;

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
  BOOL_OR(COALESCE(is_sidechain, FALSE)) AS is_sidechain,
  ANY_VALUE(source_file)      AS source_file,
  MAX(input_tokens)           AS input_tokens,
  MAX(output_tokens)          AS output_tokens,
  MAX(cache_read_tokens)      AS cache_read_tokens,
  MAX(cache_creation_tokens)  AS cache_creation_tokens,
  -- Cache writes bill by TTL: 1h at 2x the input rate, 5m at 1.25x. Split them so cost
  -- estimates can weight each tier; both are subsets of cache_creation_tokens.
  MAX(TRY_CAST(data->>'$.message.usage.cache_creation.ephemeral_1h_input_tokens' AS BIGINT)) AS cache_1h_tokens,
  MAX(TRY_CAST(data->>'$.message.usage.cache_creation.ephemeral_5m_input_tokens' AS BIGINT)) AS cache_5m_tokens,
  COUNT(*)                    AS content_rows
FROM messages
WHERE type = 'assistant'
GROUP BY host, session_id, message_id;

-- Session rewind/resume replays JSONL lines verbatim (same uuid, usually later in the
-- same file), so tool_use/tool_result rows would double-count without dedupe. Two
-- passes: drop replayed source lines (same record uuid, keep the latest copy), then
-- drop residual duplicate tool ids that arrive under fresh uuids (e.g. an Agent
-- tool_use echoed into its subagent transcript).
--
-- The cross-file pass keeps the main-thread copy when one exists. The only tool ids that
-- span two files are a parent's Agent call echoed into the transcript of the subagent it
-- spawned, and the parent's copy is the original. Ordering on source_line alone let the
-- echo win for about one spawn in twelve, which hands `agent_id` the spawned agent's
-- label for a call the parent made.
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
    r.data->>'$.toolDenialKind' AS tool_denial_kind,
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
  s.tool_denial_kind,
  s.attribution_skill,
  s.attribution_plugin,
  s.attribution_agent
FROM src s,
LATERAL (SELECT unnest(json_extract(s.message_content, '$[*]')) AS item) t
WHERE json_type(s.message_content) = 'ARRAY'
QUALIFY COALESCE(id, tool_use_id) IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY s.host, type, COALESCE(id, tool_use_id)
       ORDER BY (s.source_file LIKE '%/subagents/%'), s.source_line DESC, s.source_file DESC
     ) = 1;

-- `session_id` is the transcript's session id, which a subagent line inherits from its
-- parent. `agent_id` names the subagent that actually made the call and is NULL on the
-- main thread. Group by it alongside session_id wherever a per-session count would
-- otherwise credit a whole fan-out to its parent.
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
  attribution_agent,
  subagent_id(source_file) AS agent_id
FROM content_items
WHERE type = 'tool_use' AND name IS NOT NULL;

-- `agent_id` comes from the tool_result row, so it names the context that hit the error
-- even when the originating call did not resolve.
--
-- `error_type` splits the surface a person can act on from the one a setting can: only a
-- denial the user made by hand is a 'rejection'. A `permission-rule` denial is the
-- configuration working, and it stays 'failure' so `hook_denies` still sees the hook
-- denies it recovers from error text. `denial_kind` carries the full four-value answer.
CREATE OR REPLACE VIEW tool_errors AS
SELECT
  er.tool_use_id   AS tool_id,
  er.content       AS error_content,
  COALESCE(tc.tool_name, 'unknown') AS tool_name,
  er.host,
  er.session_id,
  tc.project_path,
  er.timestamp,
  CASE WHEN denial_kind(er.tool_denial_kind, er.tool_use_result) = 'user-rejected'
       THEN 'rejection' ELSE 'failure' END AS error_type,
  denial_kind(er.tool_denial_kind, er.tool_use_result) AS denial_kind,
  subagent_id(er.source_file) AS agent_id
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

-- Every denied tool call, with the reason it was denied. `denial_kind` separates the four
-- surfaces that used to be indistinguishable: a hand rejection (`user-rejected`), a
-- permission rule or PreToolUse hook (`permission-rule`), and the two auto-mode refusals.
-- `kind_source` says whether the kind came from the record or was inferred from the
-- result string on a row predating the field, so a window spanning 2026-07-02 reads as
-- coverage rather than as a change in what a denial is.
CREATE OR REPLACE VIEW permission_requests AS
SELECT
  tc.name AS tool_name,
  tc.id   AS tool_id,
  (tc.data->>'$.input.command')     AS command,
  (tc.data->>'$.input.file_path')   AS file_path,
  (tc.data->>'$.input.description') AS description,
  denial_kind(er.tool_denial_kind, er.tool_use_result)        AS denial_kind,
  denial_kind_source(er.tool_denial_kind, er.tool_use_result) AS kind_source,
  tc.host,
  tc.session_id,
  tc.project_path,
  tc.timestamp,
  subagent_id(er.source_file) AS agent_id
FROM content_items er
JOIN content_items tc ON er.tool_use_id = tc.id AND er.host = tc.host
WHERE er.type = 'tool_result'
  AND denial_kind(er.tool_denial_kind, er.tool_use_result) IS NOT NULL;

CREATE OR REPLACE VIEW sandbox_bypasses AS
WITH bypass AS (
  SELECT
    (data->>'$.input.command')     AS command,
    (data->>'$.input.description') AS description,
    id AS tool_id,
    host,
    session_id,
    project_path,
    timestamp,
    subagent_id(source_file) AS agent_id
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
  b.agent_id,
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
    -- Sibling subagents share the parent's session id, so matching on session alone
    -- pairs one agent's bypass with an unrelated agent's failure of the same command.
    AND subagent_id(tc.source_file) IS NOT DISTINCT FROM b.agent_id
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
    subagent_id(ci.source_file) IS NOT NULL AS is_subagent,
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
    subagent_id(m.source_file) IS NOT NULL AS is_subagent,
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

-- `label` is the session's human-readable name, from session_labels. It replaces the
-- `summary` this view used to carry: `summary` records are no longer written, so that
-- column had gone NULL corpus-wide.
CREATE OR REPLACE VIEW sessions AS
SELECT
  m.*,
  l.label,
  l.label_source
FROM (
  SELECT
    host,
    session_id,
    project_id(host, ANY_VALUE(project_path)) AS project_id,
    MIN(timestamp) AS start_time,
    MAX(timestamp) AS end_time,
    MAX(timestamp) - MIN(timestamp) AS duration,
    ANY_VALUE(project_path) AS project_path,
    ANY_VALUE(git_branch)   AS git_branch,
    COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) AS user_messages,
    COUNT(*) FILTER (WHERE type = 'assistant')            AS assistant_messages
  FROM messages
  GROUP BY host, session_id
  HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0
) m
LEFT JOIN session_labels l USING (host, session_id);

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
  is_sidechain,
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
  (data->>'$.uuid')    AS uuid,
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
  (data->'$.hookInfos') AS hook_infos,
  data
FROM raw
WHERE type = 'system';

-- One row per Stop hook execution, from the `hookInfos` roster the harness writes into
-- every `stop_hook_summary`. This is the complete ledger: `hook_events` is built from
-- attachment records, which a hook producing no output never writes, so a silent hook is
-- invisible there and present here. `hookInfos` appears under no other subtype, so this
-- covers Stop hooks only and does not generalize to the other hook events.
--
-- `prompt_text` is set when the entry is a queued prompt the harness re-injected at Stop
-- rather than a configured hook; those rows duplicate the prompt into `command` and are
-- not automations anyone can remove.
CREATE OR REPLACE VIEW stop_hook_runs AS
WITH summaries AS (
  SELECT host, session_id, project_path, timestamp, source_file, source_line, hook_infos,
         -- The Stop's own id, shared with every hook attachment it produced. It is the
         -- only key tying a roster to a blocking error, which names no command.
         (data->>'$.toolUseID') AS tool_use_id
  FROM system_events
  WHERE subtype = 'stop_hook_summary'
    AND json_type(hook_infos) = 'ARRAY'
  QUALIFY uuid IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY host, session_id, uuid
         ORDER BY source_line DESC, source_file DESC
       ) = 1
)
SELECT
  s.host,
  s.session_id,
  s.project_path,
  s.timestamp,
  s.source_file,
  s.source_line,
  s.tool_use_id,
  (info->>'$.command')                      AS command,
  TRY_CAST(info->>'$.durationMs' AS BIGINT) AS duration_ms,
  (info->>'$.promptText')                   AS prompt_text
FROM summaries s,
LATERAL (SELECT unnest(json_extract(s.hook_infos, '$[*]')) AS info) h;

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
-- `agent_id` marks which context was blocked, so this unions cleanly with `hook_denies`,
-- where subagent rows are common. The harness writes hook records only to the main
-- transcript, so it is NULL on every row today.
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
  reason,
  subagent_id(source_file) AS agent_id
FROM hook_events
WHERE blocked OR decision IN ('ask', 'deny');

-- Hook denies recovered from the denied call's tool_result, because hook_blocks cannot
-- see them. A PreToolUse hook returning permissionDecision "deny" writes no hook record
-- at all: the surviving trace is a tool_result with is_error set and the
-- permissionDecisionReason as its entire content. `ask` decisions and exit-2 blocks are
-- recorded normally, so this view covers denies only and hook_blocks stays authoritative
-- for the rest.
--
-- A denied tool_result is structurally identical to any other failed call, so recovery is
-- text matching and `patterns` is MAINTAINED BY HAND. Hook scripts build their reason at
-- runtime (`permissionDecisionReason: reason`), so the strings cannot be extracted from
-- source, and they drift as hooks are reworded. To extend the map, group `tool_errors` by
-- the head of `error_content` and look for messages that read as guidance rather than tool
-- output (a genuine failure carries an `Exit code N` or `<tool_use_error>` prefix), then
-- confirm the string against the hook script that emits it. Patterns anchor at the start
-- of the message, so a scanner printing the same phrase inside its own output does not
-- register as a deny. Rows whose tool_use_id already appears in hook_blocks are dropped:
-- an `ask` the user declined leaves both a hook record and an error, and counting both
-- would inflate every hook that asks. `hook_name` is the map's label rather than a command
-- string, since the deny path records no command.
--
-- Denies recovered this way are the one blocking channel a subagent contributes to,
-- because a subagent's tool_results land in its own transcript while carrying the parent
-- session's id. `agent_id` says which context was denied, so a burst count can key on
-- the agent instead of crediting a whole fan-out's denies to the parent. Rows are kept
-- rather than filtered, so a caller wanting every deny ignores the column.
CREATE OR REPLACE VIEW hook_denies AS
WITH patterns(hook_name, pattern) AS (
  VALUES
    ('git:block-default-branch-commit', 'Cannot commit directly to %'),
    ('user:worktree',                   'Use the worktrunk skill%'),
    ('writing:check-tropes',            'Spaced em dashes%'),
    ('gitlab:lint',                     'This repository''s origin remote is GitLab%'),
    ('pull-request:validate-body',      'Fix the PR body before retrying%'),
    ('linear:cli-create',               '`linear issue create` without%')
)
SELECT
  te.host,
  te.session_id,
  te.project_path,
  te.timestamp,
  'PreToolUse'     AS hook_event,
  p.hook_name,
  te.tool_id       AS tool_use_id,
  tc.tool_name     AS denied_tool,
  tc.command       AS denied_command,
  te.error_content AS reason,
  te.agent_id
FROM tool_errors te
JOIN patterns p ON te.error_content LIKE p.pattern
JOIN tool_calls tc ON tc.host = te.host AND tc.tool_id = te.tool_id
WHERE te.error_type = 'failure'
  AND NOT EXISTS (
    SELECT 1 FROM hook_blocks hb
    WHERE hb.host = te.host AND hb.tool_use_id = te.tool_id
  );

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
  attribution_agent,
  agent_id
FROM tool_calls
WHERE tool_name IN ('Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit')
  AND file_path IS NOT NULL;

-- Pull requests opened from a session, linking session_id to the PR it produced.
-- The outcome side of the loop: join back to sessions to see what work shipped.
-- The harness re-emits the pr-link record on later turns of the same session, so the
-- raw rows repeat each link many times; group to one row per distinct link, keeping
-- the first emission's timestamp.
CREATE OR REPLACE VIEW pr_links AS
SELECT
  host,
  session_id,
  arg_min(project_path, timestamp)        AS project_path,
  MIN(timestamp)                          AS timestamp,
  TRY_CAST(data->>'$.prNumber' AS BIGINT) AS pr_number,
  (data->>'$.prRepository')               AS repository,
  (data->>'$.prUrl')                      AS url
FROM raw
WHERE type = 'pr-link'
GROUP BY host, session_id, pr_number, repository, url;

-- Plan-mode calls: one row per ExitPlanMode tool_use, joined with its tool_result to
-- classify the outcome. `plan_seq` is 1-based within the session ordered by timestamp.
-- Outcome classification: 'approved' when the result contains "approved your plan" or
-- "approved exiting plan mode" (the harness has shipped both wordings, and matching only
-- the first drops the second into 'unknown', reading as an unapproved plan);
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
    WHEN (result_content) LIKE '%approved your plan%'
      OR (result_content) LIKE '%approved exiting plan mode%'      THEN 'approved'
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
