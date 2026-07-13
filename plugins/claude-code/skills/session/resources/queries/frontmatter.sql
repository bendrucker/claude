-- Frontmatter: one row per markdown file with YAML frontmatter, parsed with the
-- `yaml` community extension (load it via `-init resources/extensions.sql`). Returns
-- the typed `name`/`description` fields plus the body in one shot, replacing a
-- regex `^---...---$` split. The glob self-defaults to the memory corpus (the clean,
-- frontmatter-native set under ~/.claude) and accepts an optional `frontmatter_glob`
-- override. On memory files the nested `metadata` frontmatter auto-expands into a
-- typed struct; select `metadata` directly when querying that corpus.
--
-- Override the glob for skills, which live under ~/.claude/plugins (not the personal
-- ~/.claude/skills dir) and are duplicated across cache version-hashes, so a path that
-- pins one copy reads cleaner:
--   SET VARIABLE frontmatter_glob = 'plugins/*/skills/*/SKILL.md';                  -- repo skills
--   SET VARIABLE frontmatter_glob = '~/.claude/plugins/marketplaces/*/*/skills/*/SKILL.md';
--
-- Params: frontmatter_glob (override the default memory dir).
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
