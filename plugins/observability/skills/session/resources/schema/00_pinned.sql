-- The projection from one JSONL line to `raw`'s derived columns, and the single source
-- of truth for their names, order and types: `01_tables.sql` builds the empty table from
-- it, `import.sql` inserts through it, and `db.ts` re-derives the rows already in the
-- database through it whenever this file's fingerprint changes.
--
-- Everything here is recomputable from `raw.data`, which holds the verbatim line, so
-- changing a column never requires re-reading the source file. That matters because the
-- file may be gone: for a deleted session the index is the only surviving copy. The
-- columns outside this struct (`host`, `source_file`, `source_line`) come from the scan
-- rather than the line and are the only part of a row that a file re-read could restore.
--
-- Numerics and booleans use TRY_CAST so a divergent value type degrades to NULL instead
-- of failing the whole import.
--
-- One json_extract pulls every path, so each line is parsed once. A `->>` per column
-- parses the line once per column, and over a vector of large lines (tool results run to
-- megabytes) that outgrew the writer's memory when re-deriving the whole table. The
-- lambda binds the extracted list once: a macro parameter is substituted at every use,
-- which would plan the extraction once per column for every statement.
CREATE OR REPLACE MACRO pinned_columns(line) AS list_transform(
  [json_extract(line, [
    '$.sessionId', '$.type', '$.cwd', '$.gitBranch', '$.isMeta', '$.isSidechain',
    '$.durationMs', '$.timestamp',
    '$.message.usage.input_tokens', '$.message.usage.output_tokens',
    '$.message.usage.cache_read_input_tokens', '$.message.usage.cache_creation_input_tokens',
    '$.message.usage.cache_creation.ephemeral_1h_input_tokens',
    '$.message.usage.cache_creation.ephemeral_5m_input_tokens',
    '$.uuid', '$.message.id', '$.message.model', '$.entrypoint',
    '$.attributionSkill', '$.attributionPlugin', '$.attributionAgent',
    '$.customTitle', '$.aiTitle', '$.agentName', '$.message.content'
  ])],
  lambda v: {
    'session_id':    v[1]->>'$',
    'type':          v[2]->>'$',
    'project_path':  v[3]->>'$',
    'git_branch':    v[4]->>'$',
    'is_meta':       COALESCE(TRY_CAST(v[5]->>'$' AS BOOLEAN), false),
    'is_sidechain':  COALESCE(TRY_CAST(v[6]->>'$' AS BOOLEAN), false),
    'duration_ms':   TRY_CAST(v[7]->>'$' AS BIGINT),
    'timestamp':     TRY_CAST(v[8]->>'$' AS TIMESTAMP),
    'input_tokens':  TRY_CAST(v[9]->>'$'  AS BIGINT),
    'output_tokens': TRY_CAST(v[10]->>'$' AS BIGINT),
    'cache_read_tokens':     TRY_CAST(v[11]->>'$' AS BIGINT),
    'cache_creation_tokens': TRY_CAST(v[12]->>'$' AS BIGINT),
    'cache_1h_tokens': TRY_CAST(v[13]->>'$' AS BIGINT),
    'cache_5m_tokens': TRY_CAST(v[14]->>'$' AS BIGINT),
    'uuid':          v[15]->>'$',
    'message_id':    COALESCE(v[16]->>'$', v[15]->>'$'),
    'model':         v[17]->>'$',
    'entrypoint':    v[18]->>'$',
    'attribution_skill':  v[19]->>'$',
    'attribution_plugin': v[20]->>'$',
    'attribution_agent':  v[21]->>'$',
    -- The display name a custom-title, ai-title or agent-name record carries.
    'title':         COALESCE(v[22]->>'$', v[23]->>'$', v[24]->>'$'),
    -- A typed prompt is a string; tool results and assistant turns are block arrays.
    'content_text':  CASE WHEN json_type(v[25]) = 'VARCHAR' THEN v[25]->>'$' END
  }
)[1];
