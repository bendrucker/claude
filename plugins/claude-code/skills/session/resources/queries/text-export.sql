-- ---
-- name: text-export
-- tier: 1
-- summary: Dump cleaned prose from `text_content`, one row per text item, TSV-friendly.
-- description: >-
--   Fenced and inline-backtick code is stripped from `text`, with `raw_text` alongside for
--   the original. Ordered by timestamp then source position, so an export reads in
--   transcript order.
-- params:
--   - name: role
--     meaning: user or assistant, or both when unset
--   - name: model
--     meaning: GLOB on the model id
--   - name: min_chars
--     meaning: floor on the cleaned text length
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
SELECT
  tc.session_id,
  tc.timestamp,
  tc.role,
  tc.model,
  s.project_path,
  tc.text,
  tc.raw_text,
  tc.source_file,
  tc.source_line
FROM text_content tc
JOIN sessions s USING (host, session_id)
WHERE (getvariable('role') IS NULL OR tc.role = getvariable('role'))
  AND (getvariable('model') IS NULL OR (tc.model IS NOT NULL AND tc.model GLOB getvariable('model')::VARCHAR))
  AND date_filter(tc.timestamp, getvariable('after_date'), getvariable('before_date'))
  AND project_filter(s.project_path, getvariable('project'))
  AND host_filter(tc.host, getvariable('host'))
  AND (getvariable('min_chars') IS NULL OR length(tc.text) >= getvariable('min_chars')::BIGINT)
ORDER BY tc.timestamp, tc.source_file, tc.source_line;
