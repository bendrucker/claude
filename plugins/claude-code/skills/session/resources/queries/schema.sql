-- ---
-- name: schema
-- tier: 1
-- summary: Every column in every table and view.
-- description: >-
--   Run it first when you do not know what is available. `meta` is excluded, since it holds
--   display metadata rather than session data.
-- ---
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'main'
  AND table_name != 'meta'
ORDER BY table_name, ordinal_position;
