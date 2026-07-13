CREATE OR REPLACE MACRO date_filter(ts, after_val, before_val) AS
  (after_val IS NULL OR ts >= after_val::TIMESTAMP)
  AND (before_val IS NULL OR ts <= before_val::TIMESTAMP);

CREATE OR REPLACE MACRO project_filter(path, project_val) AS
  (project_val IS NULL OR SPLIT_PART(path, '/', -1) GLOB project_val::VARCHAR);

CREATE OR REPLACE MACRO host_filter(host_col, host_val) AS
  (host_val IS NULL OR host_col = host_val::VARCHAR);

CREATE OR REPLACE MACRO project_id(host, path) AS host || ':' || path;

-- Cost-rate table for token spend estimates, per-MTok USD from public API rates. Kept
-- here so every cost query shares one source; the per-tier weighting (cache read 0.1x
-- input, cache write 1.25x for 5m / 2x for 1h) lives in the queries that call these.
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
