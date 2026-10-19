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
CREATE OR REPLACE MACRO pinned_columns(line) AS {
  'session_id':    line->>'$.sessionId',
  'type':          line->>'$.type',
  'project_path':  line->>'$.cwd',
  'git_branch':    line->>'$.gitBranch',
  'is_meta':       COALESCE(TRY_CAST(line->>'$.isMeta'      AS BOOLEAN), false),
  'is_sidechain':  COALESCE(TRY_CAST(line->>'$.isSidechain' AS BOOLEAN), false),
  'duration_ms':   TRY_CAST(line->>'$.durationMs' AS BIGINT),
  'timestamp':     TRY_CAST(line->>'$.timestamp'  AS TIMESTAMP),
  'input_tokens':  TRY_CAST(line->>'$.message.usage.input_tokens'  AS BIGINT),
  'output_tokens': TRY_CAST(line->>'$.message.usage.output_tokens' AS BIGINT),
  'cache_read_tokens':     TRY_CAST(line->>'$.message.usage.cache_read_input_tokens'     AS BIGINT),
  'cache_creation_tokens': TRY_CAST(line->>'$.message.usage.cache_creation_input_tokens' AS BIGINT),
  'cache_1h_tokens': TRY_CAST(line->>'$.message.usage.cache_creation.ephemeral_1h_input_tokens' AS BIGINT),
  'cache_5m_tokens': TRY_CAST(line->>'$.message.usage.cache_creation.ephemeral_5m_input_tokens' AS BIGINT),
  'uuid':          line->>'$.uuid',
  'message_id':    COALESCE(line->>'$.message.id', line->>'$.uuid'),
  'model':         line->>'$.message.model',
  'entrypoint':    line->>'$.entrypoint',
  'attribution_skill':  line->>'$.attributionSkill',
  'attribution_plugin': line->>'$.attributionPlugin',
  'attribution_agent':  line->>'$.attributionAgent',
  -- The display name a custom-title, ai-title or agent-name record carries.
  'title':         COALESCE(line->>'$.customTitle', line->>'$.aiTitle', line->>'$.agentName'),
  -- A typed prompt is a string; tool results and assistant turns are block arrays.
  'content_text':  CASE WHEN json_type(line, '$.message.content') = 'VARCHAR'
                        THEN line->>'$.message.content' END
};
