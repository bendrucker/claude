-- ---
-- name: frontmatter
-- tier: 1
-- reads: disk
-- extensions: [yaml]
-- summary: >-
--   One row per markdown file with YAML frontmatter, returning the typed `name` and
--   `description` fields plus the body in one shot.
-- description: >-
--   Parsing frontmatter with the extension replaces a regex `^---...---$` split. The glob
--   self-defaults to the memory corpus (`~/.claude/projects/*/memory/*.md`), the clean
--   frontmatter-native set, where the nested `metadata` frontmatter auto-expands into a
--   typed struct: select `metadata` directly when querying it. Override the glob for
--   skills, which live under `~/.claude/plugins` (not the personal `~/.claude/skills`) and
--   are duplicated across cache version-hashes, so a path that pins one copy reads cleaner.
-- params:
--   - name: frontmatter_glob
--     meaning: override the default memory-corpus glob
-- ---
-- Globs that pin one copy of a duplicated skill:
--   SET VARIABLE frontmatter_glob = 'plugins/*/skills/*/SKILL.md';                  -- repo skills
--   SET VARIABLE frontmatter_glob = '~/.claude/plugins/marketplaces/*/*/skills/*/SKILL.md';
SELECT
  filename AS file_path,
  name,
  description,
  length(content) AS content_chars
FROM read_yaml_frontmatter(
  COALESCE(
    TRY_CAST(getvariable('frontmatter_glob') AS VARCHAR),
    '~/.claude/projects/*/memory/*.md'
  ),
  content:=true,
  filename:=true
)
ORDER BY file_path;
