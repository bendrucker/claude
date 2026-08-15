CREATE OR REPLACE MACRO date_filter(ts, after_val, before_val) AS
  (after_val IS NULL OR ts >= after_val::TIMESTAMP)
  AND (before_val IS NULL OR ts <= before_val::TIMESTAMP);

CREATE OR REPLACE MACRO project_filter(path, project_val) AS
  (project_val IS NULL OR SPLIT_PART(path, '/', -1) GLOB project_val::VARCHAR);

CREATE OR REPLACE MACRO host_filter(host_col, host_val) AS
  (host_val IS NULL OR host_col = host_val::VARCHAR);

CREATE OR REPLACE MACRO project_id(host, path) AS host || ':' || path;

-- A subagent writes its own transcript under the session's `subagents/` directory, but
-- every line in it carries the PARENT session's `sessionId`. Session id alone therefore
-- cannot tell a parent's own tool call from a subagent's, and any per-session count over
-- content-derived rows attributes the whole fan-out to the parent. Returns the file's
-- agent label for a subagent line and NULL for a main-thread line, so `(host,
-- session_id, agent_id)` is the real per-context key and `agent_id IS NOT NULL` is the
-- subagent test.
--
-- The path is the discriminator rather than `isSidechain` or `attributionAgent`, which
-- disagree with it on thousands of rows and are NULL on a large minority of subagent
-- rows respectively. Workflow spawns nest a level deeper
-- (`subagents/workflows/wf_<id>/agent-<label>.jsonl`) and account for roughly 40% of
-- subagent files, so the directory is matched separately from the basename. Anchoring
-- the whole tail instead silently reclassifies every nested file as main-thread.
CREATE OR REPLACE MACRO subagent_id(source_file) AS
  CASE
    WHEN source_file LIKE '%/subagents/%'
    THEN NULLIF(regexp_extract(source_file, '([^/]+)\.jsonl$', 1), '')
  END;

-- Cost-rate table for token spend estimates, per-MTok USD from published API rates as of
-- 2026-07-24. Rates are keyed by family, so a family arm can drift from a specific model's
-- current rate. Kept here so every cost query shares one source. The per-tier weighting
-- (cache read 0.1x input, cache write 1.25x for 5m / 2x for 1h) lives in the queries that
-- call these.
CREATE OR REPLACE MACRO model_input_rate(model) AS
  CASE
    WHEN model ILIKE '%fable%' OR model ILIKE '%mythos%' THEN 10.0
    WHEN model ILIKE '%opus%'   THEN 5.0
    WHEN model ILIKE '%sonnet%' THEN 3.0
    WHEN model ILIKE '%haiku%'  THEN 1.0
    ELSE 5.0
  END;

CREATE OR REPLACE MACRO model_output_rate(model) AS
  CASE
    WHEN model ILIKE '%fable%' OR model ILIKE '%mythos%' THEN 50.0
    WHEN model ILIKE '%opus%'   THEN 25.0
    WHEN model ILIKE '%sonnet%' THEN 15.0
    WHEN model ILIKE '%haiku%'  THEN 5.0
    ELSE 25.0
  END;

-- Collapses a concrete model id or a Task-tool `model` override (both full ids like
-- `claude-opus-4-8[1m]` and short names like `opus`) to a family label. Shares the
-- same ILIKE patterns as the rate macros above so family and cost stay consistent.
CREATE OR REPLACE MACRO model_family(model) AS
  CASE
    WHEN model IS NULL THEN NULL
    WHEN model ILIKE '%fable%' OR model ILIKE '%mythos%' THEN 'fable'
    WHEN model ILIKE '%opus%'   THEN 'opus'
    WHEN model ILIKE '%sonnet%' THEN 'sonnet'
    WHEN model ILIKE '%haiku%'  THEN 'haiku'
    ELSE 'other'
  END;
