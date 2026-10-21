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
  (r.data->>'$.promptSource')         AS prompt_source,
  (r.data->>'$.interruptedMessageId') AS interrupted_message_id,
  (r.data->>'$.attributionMcpServer') AS attribution_mcp_server,
  (r.data->>'$.attributionMcpTool')   AS attribution_mcp_tool
FROM raw r
WHERE r.type IN ('user', 'assistant');

-- Typed slash commands, one row per invocation. The harness expands `/name` into a user
-- message carrying a `<command-name>` marker and emits no Skill tool_use, so this is the
-- only trace a typed invocation leaves and `skill_calls` never sees one. Scoped to a user
-- message that opens with the marker block: a transcript quoted in prose or dumped into a
-- tool result is text about an invocation, not one. Replayed lines (rewind and resume
-- repeat a uuid) are deduped, as `content_items` does for tool calls. `command` is the name
-- as typed, namespaced (`plugin:skill`) or bare, and callers resolve it to a skill.
CREATE OR REPLACE VIEW command_markers AS
WITH typed AS (
  SELECT
    m.host,
    m.session_id,
    m.timestamp,
    m.project_path,
    ltrim(trim(regexp_extract(m.content_text, '<command-name>([^<]*)</command-name>', 1)), '/') AS command,
    m.source_file,
    m.source_line
  FROM messages m
  WHERE m.type = 'user'
    AND m.content_text LIKE '%<command-name>%'
    AND (m.content_text LIKE '<command-name>%' OR m.content_text LIKE '<command-message>%')
  QUALIFY m.uuid IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY m.host, m.session_id, m.uuid
         ORDER BY m.source_line DESC, m.source_file DESC
       ) = 1
)
SELECT * FROM typed WHERE command <> '';

-- One label per session, from the sidecar title records the harness writes beside the
-- transcript. A session can accumulate several as the title is regenerated or renamed, so
-- a user-set `custom-title` wins over a generated `ai-title`, which wins over the
-- `agent-name` a named agent session carries; within a kind the last one written wins.
-- These records carry `sessionId` but no timestamp, so recency is source order.
CREATE OR REPLACE VIEW session_labels AS
SELECT
  host,
  session_id,
  title AS label,
  type AS label_source
FROM raw
WHERE type IN ('custom-title', 'ai-title', 'agent-name')
  AND length(trim(title)) > 0
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
  message_id,
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
  -- Cache writes bill by TTL: 1h at 2x the input rate, 5m at 1.25x; both are subsets of
  -- cache_creation_tokens.
  MAX(cache_1h_tokens)        AS cache_1h_tokens,
  MAX(cache_5m_tokens)        AS cache_5m_tokens,
  COUNT(*)                    AS content_rows,
  -- Public per-MTok rates, cache reads at 0.1x input. A message with no 5m split bills its
  -- non-1h writes at the 5m rate.
  (COALESCE(MAX(input_tokens), 0) * model_input_rate(ANY_VALUE(model))
   + COALESCE(MAX(cache_5m_tokens), COALESCE(MAX(cache_creation_tokens), 0)
       - COALESCE(MAX(cache_1h_tokens), 0)) * 1.25 * model_input_rate(ANY_VALUE(model))
   + COALESCE(MAX(cache_1h_tokens), 0) * 2.0 * model_input_rate(ANY_VALUE(model))
   + COALESCE(MAX(cache_read_tokens), 0) * 0.1 * model_input_rate(ANY_VALUE(model))
   + COALESCE(MAX(output_tokens), 0) * model_output_rate(ANY_VALUE(model))) / 1e6
                              AS est_cost_usd
FROM messages
WHERE type = 'assistant'
GROUP BY host, session_id, message_id;

-- Session rewind/resume replays JSONL lines verbatim (same uuid, usually later in the
-- same file), so tool_use/tool_result rows would double-count without dedupe. Two
-- passes: drop replayed source lines (same record uuid), then drop residual duplicate
-- tool ids that arrive under fresh uuids (e.g. an Agent tool_use echoed into its
-- subagent transcript).
--
-- Both passes keep the main-thread copy when one exists, then the latest. The copies
-- that span two files are a parent's lines echoed into the transcript of the subagent it
-- spawned, and the parent's copy is the original. Ordering on source_line alone let the
-- echo win for about one spawn in twelve, which hands `agent_id` the spawned agent's
-- label for a call the parent made.
--
-- Both passes partition within (host, session_id), and a subagent's transcript carries
-- its parent's session_id, so one session's rows depend only on that session's lines.
-- That makes the session the unit of an incremental rebuild: `scoped` limits the scan
-- to the sessions db.ts lists in content_item_scope, and the result equals what a full
-- rebuild produces for them. `->` is spelled json_extract because a macro body parses
-- it as a lambda.
CREATE OR REPLACE MACRO content_item_rows(scoped) AS TABLE
WITH src AS (
  SELECT
    r.host,
    r.session_id,
    r.timestamp,
    r.project_path,
    r.source_file,
    r.source_line,
    json_extract(r.data, '$.message.content')    AS message_content,
    json_extract(r.data, '$.toolUseResult')      AS tool_use_result,
    r.data->>'$.toolDenialKind'                  AS tool_denial_kind,
    json_extract(r.data, '$.permissionDecision') AS permission_decision,
    r.attribution_skill,
    r.attribution_plugin,
    r.attribution_agent,
    r.type AS role,
    r.model,
    r.is_meta
  FROM raw r
  WHERE r.type IN ('user', 'assistant')
    AND (NOT scoped OR EXISTS (
      SELECT 1 FROM content_item_scope c
      WHERE c.host = r.host AND c.session_id IS NOT DISTINCT FROM r.session_id
    ))
  QUALIFY r.uuid IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY r.host, r.session_id, r.uuid
         ORDER BY (r.source_file LIKE '%/subagents/%'), r.source_line DESC, r.source_file DESC
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
  s.permission_decision,
  s.attribution_skill,
  s.attribution_plugin,
  s.attribution_agent,
  s.role,
  s.model,
  s.is_meta
FROM src s,
LATERAL (SELECT unnest(json_extract(s.message_content, '$[*]')) AS item) t
WHERE json_type(s.message_content) = 'ARRAY'
QUALIFY COALESCE(id, tool_use_id) IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY s.host, s.session_id, type, COALESCE(id, tool_use_id)
       ORDER BY (s.source_file LIKE '%/subagents/%'), s.source_line DESC, s.source_file DESC
     ) = 1

UNION ALL

-- A typed prompt is a bare string rather than a block array, so it becomes one `prompt`
-- item. The distinct type keeps counts over `text` blocks meaning what they did. It reads
-- `raw` rather than `src`: a second reader makes DuckDB materialize `src`, every
-- message's content at once. A replayed line repeats its prompt verbatim, so deduping
-- among prompt lines alone keeps the line `src` would.
SELECT
  r.host,
  r.session_id,
  r.timestamp,
  r.project_path,
  r.source_file,
  r.source_line,
  'prompt' AS type,
  NULL AS name,
  NULL AS id,
  NULL AS tool_use_id,
  r.content_text AS text,
  NULL AS content,
  NULL AS is_error,
  json_extract(r.data, '$.message.content')    AS data,
  json_extract(r.data, '$.toolUseResult')      AS tool_use_result,
  r.data->>'$.toolDenialKind'                  AS tool_denial_kind,
  json_extract(r.data, '$.permissionDecision') AS permission_decision,
  r.attribution_skill,
  r.attribution_plugin,
  r.attribution_agent,
  r.type AS role,
  r.model,
  r.is_meta
FROM raw r
WHERE r.type = 'user' AND r.content_text IS NOT NULL
  AND (NOT scoped OR EXISTS (
    SELECT 1 FROM content_item_scope c
    WHERE c.host = r.host AND c.session_id IS NOT DISTINCT FROM r.session_id
  ))
QUALIFY r.uuid IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY r.host, r.session_id, r.uuid
       ORDER BY (r.source_file LIKE '%/subagents/%'), r.source_line DESC, r.source_file DESC
     ) = 1;

CREATE OR REPLACE TABLE content_items AS SELECT * FROM content_item_rows(false);

-- The text `search` ranks, lowercased once here so a query scans a few rows per session
-- instead of every content block. Every main-thread content block is classified into a
-- `surface` by its type, and `policy` sets each surface's weight and per-item cap, so a
-- new tool or MCP server is searchable without naming it. Read output and the bulk fields
-- of Write and Edit input are left out because they hold file contents rather than what
-- the session did. Skill bodies and harness `<...>` text repeat across sessions. A
-- subagent's brief and report already reach the parent as Agent input and output, so its
-- own turns are left out too. Rows are per session, so db.ts rebuilds the scoped sessions' rows beside
-- content_items. BM25's document frequencies come from this table at query time and need
-- no refresh of their own.
CREATE OR REPLACE MACRO search_item_rows(scoped) AS TABLE
-- Tool text runs about five times the volume of prose, and at full weight a common term
-- in it ranks every session alike, so it counts a quarter as much as prose.
WITH policy(surface, weight, cap) AS (
  VALUES
    ('label', 3.0, NULL),
    ('prompt', 1.0, NULL),
    ('queued_prompt', 1.0, NULL),
    ('assistant', 1.0, NULL),
    ('thinking', 1.0, NULL),
    ('tool_input', 0.25, 2000),
    ('tool_output', 0.25, 2000)
),
blocks AS (
  SELECT
    ci.host,
    ci.session_id,
    CASE
      WHEN ci.type = 'prompt' AND NOT ci.is_meta THEN 'prompt'
      WHEN ci.type = 'text' AND ci.role = 'assistant' THEN 'assistant'
      WHEN ci.type = 'thinking' THEN 'thinking'
      WHEN ci.type = 'tool_use' THEN 'tool_input'
      WHEN ci.type = 'tool_result' THEN 'tool_output'
    END AS surface,
    CASE ci.type
      WHEN 'thinking' THEN ci.data->>'$.thinking'
      WHEN 'tool_use' THEN concat_ws(' ', ci.name, array_to_string(
        [json_extract_string(ci.data, '$.input."' || k || '"')
          FOR k IN json_keys(ci.data, '$.input')
          IF k NOT IN ('content', 'old_string', 'new_string', 'edits', 'new_source', 'script')],
        ' '))
      WHEN 'tool_result' THEN CASE json_type(json_extract(ci.data, '$.content'))
        WHEN 'ARRAY' THEN array_to_string(json_extract_string(ci.data, '$.content[*].text'), ' ')
        ELSE ci.content END
      ELSE ci.text
    END AS text
  FROM content_items ci
  WHERE ci.source_file NOT LIKE '%/subagents/%'
    AND NOT (ci.type = 'tool_result' AND EXISTS (
      SELECT 1 FROM content_items u
      WHERE u.host = ci.host AND u.session_id = ci.session_id
        AND u.type = 'tool_use' AND u.id = ci.tool_use_id AND u.name = 'Read'
    ))
    AND (NOT scoped OR EXISTS (
      SELECT 1 FROM content_item_scope c
      WHERE c.host = ci.host AND c.session_id IS NOT DISTINCT FROM ci.session_id
    ))
),
surfaced AS (
  SELECT * FROM blocks
  WHERE surface NOT IN ('prompt', 'assistant')
    OR (text NOT LIKE '<%'
      AND text NOT LIKE 'This session is being continued%'
      AND text NOT LIKE 'Base directory for this skill:%')
  UNION ALL
  -- A message typed while a turn runs lands as a queued_command attachment, never as a
  -- prompt row.
  SELECT r.host, r.session_id, 'queued_prompt', r.data->>'$.attachment.prompt'
  FROM raw r
  WHERE r.type = 'attachment'
    AND (r.data->>'$.attachment.type') = 'queued_command'
    AND coalesce(r.data->>'$.attachment.commandMode', 'prompt') = 'prompt'
    AND json_type(json_extract(r.data, '$.attachment.prompt')) = 'VARCHAR'
    AND (r.data->>'$.attachment.prompt') NOT LIKE '<%'
    AND r.source_file NOT LIKE '%/subagents/%'
    AND (NOT scoped OR EXISTS (
      SELECT 1 FROM content_item_scope c
      WHERE c.host = r.host AND c.session_id IS NOT DISTINCT FROM r.session_id
    ))
  QUALIFY r.uuid IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY r.host, r.session_id, r.uuid
         ORDER BY r.source_line DESC, r.source_file DESC
       ) = 1
  UNION ALL
  SELECT l.host, l.session_id, 'label', l.label
  FROM session_labels l
  WHERE NOT scoped OR EXISTS (
    SELECT 1 FROM content_item_scope c
    WHERE c.host = l.host AND c.session_id IS NOT DISTINCT FROM l.session_id
  )
)
SELECT s.host, s.session_id, s.surface,
  lower(CASE WHEN p.cap IS NULL THEN s.text ELSE left(s.text, p.cap) END) AS text,
  CAST(p.weight AS DOUBLE) AS weight
FROM surfaced s
JOIN policy p USING (surface)
WHERE s.text IS NOT NULL AND s.text <> '';

CREATE OR REPLACE TABLE search_items AS SELECT * FROM search_item_rows(false);

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
--
-- Since 2026-10-07 the harness also records `permissionDecision` on the result, so
-- `decision`, `decision_source`, and `reason_type` carry it, and a prompt the user approved
-- (`user_temporary`, `user_permanent`) lands here with a NULL `denial_kind`.
CREATE OR REPLACE VIEW permission_requests AS
SELECT
  tc.name AS tool_name,
  tc.id   AS tool_id,
  (tc.data->>'$.input.command')     AS command,
  (tc.data->>'$.input.file_path')   AS file_path,
  (tc.data->>'$.input.description') AS description,
  denial_kind(er.tool_denial_kind, er.tool_use_result)        AS denial_kind,
  denial_kind_source(er.tool_denial_kind, er.tool_use_result) AS kind_source,
  (er.permission_decision->>'$.decision')   AS decision,
  (er.permission_decision->>'$.source')     AS decision_source,
  (er.permission_decision->>'$.reasonType') AS reason_type,
  tc.host,
  tc.session_id,
  tc.project_path,
  tc.timestamp,
  subagent_id(er.source_file) AS agent_id
FROM content_items er
JOIN content_items tc ON er.tool_use_id = tc.id AND er.host = tc.host
WHERE er.type = 'tool_result'
  AND (denial_kind(er.tool_denial_kind, er.tool_use_result) IS NOT NULL
    OR (er.permission_decision->>'$.source') IN ('user_temporary', 'user_permanent'));

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
),
-- Sandboxed Bash calls that failed. Materializing them keeps the planner from pairing every
-- error result with every bypass on host alone before the other conditions apply, a plan it
-- picked whenever an index's sampled statistics shifted, costing several GB and seconds.
failed AS MATERIALIZED (
  SELECT
    tc.id AS tool_id,
    er.content AS error,
    tc.host,
    tc.session_id,
    tc.timestamp,
    subagent_id(tc.source_file) AS agent_id,
    (tc.data->>'$.input.command') AS command
  FROM content_items tc
  JOIN content_items er
    ON er.tool_use_id = tc.id AND er.host = tc.host
       AND er.type = 'tool_result' AND er.is_error
  WHERE tc.type = 'tool_use'
    AND tc.name = 'Bash'
    AND COALESCE((tc.data->>'$.input.dangerouslyDisableSandbox'), 'false') = 'false'
)
SELECT
  b.command,
  -- The tool that needs the bypass: leading `cd`/`echo` wrappers and (exported) env
  -- assignments stripped, then the first word. NULL when nothing is left.
  NULLIF(regexp_extract(trim(regexp_replace(
    trim(b.command),
    '^('
      || '(cd [^&;\n]*|echo [^&;\n]*)(&&|;|\n)\s*'
      || '|(export )?[A-Za-z_][A-Za-z0-9_]*='
      || '(\$\([^)]*\)|"[^"]*"|''[^'']*''|[^\s;&|]*)'
      || '\s*(&&|;)?\s*'
    || ')+',
    ''
  )), '^[A-Za-z0-9_./-]+', 0), '') AS verb,
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
-- The latest earlier failure of the same command by the same agent.
LEFT JOIN failed prior
  ON prior.host = b.host
  AND prior.session_id = b.session_id
  -- Sibling subagents share the parent's session id, so matching on session alone
  -- pairs one agent's bypass with an unrelated agent's failure of the same command.
  AND prior.agent_id IS NOT DISTINCT FROM b.agent_id
  AND prior.timestamp < b.timestamp
  AND prior.command = b.command
-- content_items keeps one row per tool id per host, so this keeps one row per bypass.
QUALIFY ROW_NUMBER() OVER (PARTITION BY b.host, b.tool_id ORDER BY prior.timestamp DESC) = 1;

CREATE OR REPLACE VIEW text_content AS
SELECT
  host,
  session_id,
  timestamp,
  project_path,
  role,
  CASE WHEN role = 'assistant' THEN model END AS model,
  regexp_replace(
    regexp_replace(text, '```.*?```', '', 'gs'),
    '`[^`\n]*`', '', 'g'
  ) AS text,
  text AS raw_text,
  source_file,
  source_line,
  subagent_id(source_file) IS NOT NULL AS is_subagent,
  text LIKE '<%'
    OR text LIKE '[Request interrupted%'
    OR text LIKE 'Another Claude session sent a message:%'
    OR (type = 'prompt' AND (
      text LIKE 'Implement the following plan:%'
      OR text LIKE 'This session is being continued from a previous conversation%'
      OR text LIKE 'Goal set:%'
      OR text LIKE 'Ultraplan %'
      OR text LIKE '◇ %'
      OR text LIKE '◆ %'
    ))
  AS is_system
FROM content_items
WHERE type IN ('text', 'prompt')
  AND text IS NOT NULL
  AND length(trim(text)) > 0
  AND NOT is_meta;

-- `label` is the session's human-readable name, from session_labels. It replaces the
-- `summary` this view used to carry: `summary` records are no longer written, so that
-- column had gone NULL corpus-wide.
--
-- `entrypoint` is the harness surface the session started from (`cli`, `claude-desktop`,
-- `sdk-ts`, ...), the first one its messages carry. A session resumed from another
-- surface writes the new value on later lines, so the earliest wins rather than any.
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
    arg_min(entrypoint, timestamp) FILTER (WHERE entrypoint IS NOT NULL) AS entrypoint,
    COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) AS user_messages,
    COUNT(*) FILTER (WHERE type = 'assistant')            AS assistant_messages
  FROM messages
  GROUP BY host, session_id
  HAVING COUNT(*) FILTER (WHERE type = 'user' AND NOT is_meta) > 0
) m
LEFT JOIN session_labels l USING (host, session_id);

-- Sessions inside the caller's after_date, before_date, project and host variables, by
-- session start. getvariable binds at call time, so a query joins this instead of
-- repeating the three filters. It lives here, not in 03_macros.sql, because a table
-- macro binds `sessions` when it is created.
CREATE OR REPLACE MACRO scoped_sessions() AS TABLE
  SELECT * FROM sessions
  WHERE date_filter(start_time, getvariable('after_date'), getvariable('before_date'))
    AND project_filter(project_path, getvariable('project'))
    AND host_filter(host, getvariable('host'));

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
  uuid,
  (data->>'$.parentUuid')      AS parent_uuid,
  (data->>'$.permissionMode')  AS permission_mode,
  (data->>'$.version')         AS version,
  (data->>'$.slug')            AS slug,
  entrypoint,
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
QUALIFY uuid IS NULL
  OR ROW_NUMBER() OVER (
       PARTITION BY host, session_id, uuid
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
  uuid,
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
  COALESCE((data->>'$.error.status'), (data->>'$.error.connection.code')) AS error_code,
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
-- parsed from there; exit-2 and `decision: block` stops arrive as hook_blocking_error,
-- whose `command` sits inside the `blockingError` payload. `command` names the exact
-- hook script (NULL for permission_decision records).
CREATE OR REPLACE VIEW hook_events AS
WITH att AS (
  -- Dedupe replayed lines (rewind/resume, same uuid) so a block never counts twice.
  SELECT
    host, session_id, project_path, timestamp, source_file, source_line,
    (data->'$.attachment') AS a
  FROM raw
  WHERE type = 'attachment'
    AND (data->>'$.attachment.type') LIKE 'hook%'
  QUALIFY uuid IS NULL
    OR ROW_NUMBER() OVER (
         PARTITION BY host, session_id, uuid
         ORDER BY source_line DESC, source_file DESC
       ) = 1
),
parsed AS (
  SELECT
    att.*,
    (a->>'$.type') AS kind,
    -- Pretty-printed JSON spans lines, so a whole-stdout cast comes first and the `(?s)`
    -- extract only catches JSON with log lines around it.
    COALESCE(
      TRY_CAST(trim(a->>'$.stdout') AS JSON),
      TRY_CAST(regexp_extract(a->>'$.stdout', '(?s)\{.*\}') AS JSON)
    ) AS sj
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
  COALESCE(
    (a->>'$.command'),
    TRY_CAST(a->>'$.blockingError' AS JSON)->>'$.command'
  ) AS command,
  -- `shared_config` travels with you (plugin, skill, and user-level hooks). A
  -- `.claude/hooks/` path under CLAUDE_PROJECT_DIR is a per-repo hook, `project_local`.
  CASE
    WHEN command IS NULL THEN NULL
    WHEN command LIKE '%CLAUDE_PLUGIN_ROOT%' OR command LIKE '%CLAUDE_SKILL_DIR%'
      OR command LIKE '%$HOME/.claude/hooks/%' OR command LIKE '%~/.claude/hooks/%'
      THEN 'shared_config'
    ELSE 'project_local'
  END AS origin,
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
  -- The harness's own record of injected context. Stdout repeats it on the hook_success
  -- row, so reading both counted every injection twice.
  CASE WHEN kind = 'hook_additional_context' THEN
    CASE json_type(a->'$.content')
      WHEN 'ARRAY' THEN array_to_string(from_json(a->'$.content', '["VARCHAR"]'), chr(10))
      ELSE (a->>'$.content')
    END
  END AS additional_context,
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
-- see them: a PreToolUse hook returning permissionDecision "deny" writes no hook record.
-- Each row is identified by the strongest signal its era carries, named in `deny_source`:
-- `field` is the harness's `permissionDecision` reject from a hook (2026-10-07 on),
-- `prefix` is the `PreToolUse:<Tool> hook error:` text it prepends (2026-09-19 on), and
-- `pattern` is the hand-kept map below, the only signal before 09-19. The map also names
-- the hook, since no native field does, and an unmatched deny reads `(unmapped)`. Rows whose
-- tool_use_id already appears in hook_blocks are dropped: a declined `ask` leaves both.
--
-- `agent_id` says which context was denied, since a subagent's tool_results carry the
-- parent session's id.
CREATE OR REPLACE VIEW hook_denies AS
WITH patterns(hook_name, pattern) AS (
  VALUES
    ('git:block-default-branch-commit', 'Cannot commit directly to %'),
    ('user:worktree',                   'Use the worktrunk skill%'),
    ('writing:check-tropes',            'Spaced em dashes%'),
    ('gitlab:lint',                     'This repository''s origin remote is GitLab%'),
    ('pull-request:validate-body',      'Fix the PR body before retrying%'),
    ('linear:cli-create',               '`linear issue create` without%')
),
results AS (
  SELECT
    er.*,
    regexp_replace(er.content, '^\s*PreToolUse:\w+ hook error:\s*', '') AS stripped_content,
    CASE
      WHEN json_extract(er.permission_decision, '$.decision') IS NOT NULL THEN 'field'
      WHEN regexp_matches(er.content, '^\s*PreToolUse:\w+ hook error:') THEN 'prefix'
      ELSE 'pattern'
    END AS deny_source
  FROM content_items er
  WHERE er.type = 'tool_result'
    AND er.is_error
    AND denial_kind(er.tool_denial_kind, er.tool_use_result) IS DISTINCT FROM 'user-rejected'
)
SELECT
  r.host,
  r.session_id,
  tc.project_path,
  r.timestamp,
  'PreToolUse'                          AS hook_event,
  COALESCE(p.hook_name, '(unmapped)')   AS hook_name,
  r.tool_use_id,
  tc.tool_name                          AS denied_tool,
  tc.command                            AS denied_command,
  r.stripped_content                    AS reason,
  r.deny_source,
  subagent_id(r.source_file)            AS agent_id
FROM results r
LEFT JOIN patterns p ON r.stripped_content LIKE p.pattern
JOIN tool_calls tc ON tc.host = r.host AND tc.tool_id = r.tool_use_id
WHERE CASE r.deny_source
        WHEN 'field' THEN (r.permission_decision->>'$.decision') = 'reject'
                      AND (r.permission_decision->>'$.source') = 'hook'
        WHEN 'prefix' THEN TRUE
        ELSE p.hook_name IS NOT NULL
      END
  AND NOT EXISTS (
    SELECT 1 FROM hook_blocks hb
    WHERE hb.host = r.host AND hb.tool_use_id = r.tool_use_id
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
    r.content AS result_content,
    te.denial_kind
  FROM content_items ci
  LEFT JOIN content_items r
    ON r.tool_use_id = ci.id
   AND r.host = ci.host
   AND r.type = 'tool_result'
  LEFT JOIN tool_errors te ON te.host = ci.host AND te.tool_id = ci.id
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
    -- A PreToolUse hook (the plan gate) refused the call before anyone saw the plan.
    WHEN denial_kind = 'permission-rule'                           THEN 'denied'
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
  COUNT(*) FILTER (WHERE outcome = 'denied')             AS denied_count,
  COUNT(*) FILTER (WHERE outcome = 'unknown')            AS unknown_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE outcome = 'redirected') >= 2 THEN 'off-rails'
    WHEN COUNT(*) FILTER (WHERE outcome = 'redirected') >= 1 THEN 'replan'
    ELSE 'single'
  END                                                    AS replan_tier,
  MIN(timestamp)                                         AS first_plan_ts,
  MAX(timestamp)                                         AS last_plan_ts
FROM plan_calls
GROUP BY host, session_id;

-- One row per tool call the auto-mode mod recorded, from its `tool.verdict` events.
-- `duration_ms` spans the decider and the tool. `interactive` marks a tool that waits
-- on the person, whose wall time is the person's.
CREATE OR REPLACE VIEW classifier_verdicts AS
SELECT
  host,
  session_id,
  attributes->>'tool_use_id'                              AS tool_use_id,
  attributes->>'agent_id'                                 AS agent_id,
  attributes->>'tool'                                     AS tool,
  TRY_CAST(attributes->>'interactive' AS BOOLEAN)         AS interactive,
  attributes->>'decision'                                 AS decision,
  attributes->>'rule'                                     AS rule,
  attributes->>'hook'                                     AS hook,
  attributes->>'setting'                                  AS setting,
  attributes->>'decider'                                  AS decider,
  attributes->>'ceiling'                                  AS ceiling,
  attributes->>'reason'                                   AS reason,
  TRY_CAST(attributes->>'read_only' AS BOOLEAN)           AS read_only,
  epoch_ms(TRY_CAST(attributes->>'started_at' AS BIGINT)) AS started_at,
  TRY_CAST(attributes->>'check_ms' AS BIGINT)             AS check_ms,
  duration_ms,
  attributes->>'outcome'                                  AS outcome
FROM mod_events
WHERE event_name = 'auto-mode.tool.verdict';

-- The field registry: which JSON paths each record type carries, when they were first and
-- last written, and by which harness version. Paths stop two levels down (`$.key`, and
-- `$.key.child` under each top-level object) plus `$.message.usage`'s children. A child that
-- is not a name, such as the tool id, model, or UUID keying a map, collapses to `*`. Rows
-- are per file, so a refresh replaces only the rows of the files listed in field_scope, and
-- a line with no timestamp of its own takes its file's earliest. Each line is parsed once
-- into a map, and each of its values once more.
CREATE OR REPLACE MACRO field_rows(scoped) AS TABLE
WITH lines AS (
  SELECT
    r.host,
    r.source_file,
    r.type,
    COALESCE(r.timestamp, MIN(r.timestamp) OVER (PARTITION BY r.host, r.source_file)) AS ts,
    from_json(r.data, '"MAP(VARCHAR, JSON)"') AS top
  FROM raw r
  -- The IN prefilter lets the scan skip row groups; the EXISTS alone reads every row's data.
  WHERE NOT scoped OR (r.source_file IN (SELECT source_file FROM field_scope) AND EXISTS (
    SELECT 1 FROM field_scope s WHERE s.host = r.host AND s.source_file = r.source_file
  ))
),
entries AS (
  SELECT host, source_file, type, ts, top['version']->>'$' AS version,
    list_transform(map_entries(top), lambda e: {
      'key': e.key, 'sub': json_keys(e.value, ['$', '$.usage'])
    }) AS entries
  FROM lines
),
paths AS (
  SELECT host, source_file, type, ts, version,
    unnest(list_distinct(flatten(list_transform(entries, lambda e:
      ['$.' || e.key]
      || list_transform(COALESCE(e.sub[1], []), lambda c: '$.' || e.key || '.' || CASE
           WHEN regexp_full_match(c, '[A-Za-z_]\w*') AND NOT regexp_matches(c, '(\d\D*){4}')
           THEN c ELSE '*' END)
      || CASE WHEN e.key = 'message'
           THEN list_transform(COALESCE(e.sub[2], []), lambda c: '$.message.usage.' || c)
           ELSE [] END
    )))) AS path
  FROM entries
)
SELECT
  host,
  source_file,
  type,
  path,
  MIN(ts)              AS first_ts,
  MAX(ts)              AS last_ts,
  arg_min(version, ts) AS first_version,
  arg_max(version, ts) AS last_version,
  COUNT(*)             AS n
FROM paths
GROUP BY ALL;

CREATE OR REPLACE TABLE file_fields AS SELECT * FROM field_rows(false);

-- `n` counts lines, so a replayed line counts again, as it does in `raw`.
CREATE OR REPLACE VIEW fields AS
SELECT
  host,
  type,
  path,
  MIN(first_ts)                    AS first_ts,
  MAX(last_ts)                     AS last_ts,
  arg_min(first_version, first_ts) AS first_version,
  arg_max(last_version, last_ts)   AS last_version,
  SUM(n)::BIGINT                   AS n
FROM file_fields
GROUP BY host, type, path;

-- Paths already judged, as GLOBs over `fields.path`, which field_drift leaves out.
CREATE OR REPLACE VIEW field_triage AS
SELECT * FROM (VALUES
  ('$.toolUseResult.*', 'one shape per tool; content_items carries it whole'),
  ('$.wireToolInputs.*', 'map keyed by tool id'),
  ('$.wireIngestContext.*', 'map keyed by tool id'),
  ('$.modelUsage.*', 'map keyed by model'),
  ('$.artifacts.*', 'map keyed by artifact id')
) t(path, note);

-- The `raw.data` paths that the views and table macros reading `raw` extract by literal.
CREATE OR REPLACE VIEW view_paths AS
SELECT DISTINCT unnest(
  regexp_extract_all(sql, '"data" ->>? ''(\$\.[^'']+)''', 1)
  || regexp_extract_all(sql, 'json_extract(?:_string)?\((?:\w+\.)?"data", ''(\$\.[^'']+)''', 1)
) AS path
FROM (
  SELECT sql FROM duckdb_views() WHERE NOT internal
  UNION ALL
  SELECT macro_definition FROM duckdb_functions() WHERE function_type = 'table_macro'
)
WHERE regexp_matches(sql, '\bFROM raw\b');

-- Fields that started or stopped at `since`, on a record type written on both sides of it:
-- `new` is absent before, `dead` is absent since while its type is not. A brand-new type is
-- index-health's `stream-new`, and a new path a view already reads is consumed, so only
-- `dead` reports one.
CREATE OR REPLACE MACRO field_drift(since, host_val) AS TABLE
WITH f AS (
  SELECT
    type,
    path,
    MIN(first_ts)                    AS first_ts,
    MAX(last_ts)                     AS last_ts,
    arg_min(first_version, first_ts) AS first_version,
    SUM(n)::BIGINT                   AS n
  FROM file_fields
  WHERE host_filter(host, host_val)
  GROUP BY type, path
),
kinds AS (
  SELECT type, MIN(first_ts) AS born, MAX(last_ts) AS seen FROM f GROUP BY type
)
SELECT CASE WHEN f.first_ts >= since THEN 'new' ELSE 'dead' END AS change, f.*
FROM f
JOIN kinds k USING (type)
WHERE k.born < since
  AND ((f.first_ts >= since AND f.path NOT IN (SELECT path FROM view_paths))
       OR (f.last_ts < since AND k.seen >= since))
  AND NOT EXISTS (SELECT 1 FROM field_triage t WHERE f.path GLOB t.path);
