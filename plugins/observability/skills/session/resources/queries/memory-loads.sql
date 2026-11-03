-- ---
-- name: memory-loads
-- dimensions: [context-tax]
-- summary: >-
--   Rules and nested `CLAUDE.md` files ranked by the context they cost: loads times the
--   words injected per load, one row per repo and repo-relative path.
-- description: >-
--   Reads `nested_memory` attachments, the record Claude Code writes each time it injects a
--   path-scoped rule or a nested `CLAUDE.md`. Memory loaded into the system prompt at
--   startup (the root `CLAUDE.md`, unscoped rules) leaves no such record and is not counted.
--   Size is the injected body (`$.content.content`), not the raw attachment, which carries
--   the file a second time as `rawContent`.
--
--   A file's repo root is the deepest directory it shares with the session's working
--   directory. Worktree layouts fold back to the repo: `<repo>/.worktrees/<branch>`,
--   `<repo>/.claude/worktrees/<branch>`, and a container such as
--   `<dir>/.worktrees/<owner>/<repo>/<branch>` or `~/.herdr/worktrees/<repo>/<branch>`.
--   `repo` is the folded root's last component, so one file counts once across its
--   worktrees, and two repos of the same name share rows. A session started in a
--   subdirectory that loads that subdirectory's own `CLAUDE.md` roots it there. User-scope
--   memory reports `repo` as `~` with a home-relative `path`.
--
--   `total_words` sums each load's own size, so it stays exact when a file changed over
--   the window. `project` matches the folded repo name.
-- params:
--   - name: limit
--     default: 30
--     meaning: reserved word, so quote the name as SET VARIABLE with double quotes
--   - after_date
--   - before_date
--   - project
--   - host
-- ---
WITH loads AS (
  SELECT
    a.host,
    a.session_id,
    a.project_path,
    a.attachment->>'$.path' AS file,
    a.attachment->'$.content'->>'$.type' AS scope,
    a.attachment->'$.content'->>'$.content' AS body,
    regexp_extract(a.attachment->>'$.path', '^(.*)/\.claude/(rules/.*|CLAUDE\.md)$', 1) AS rule_root
  FROM attachments a
  WHERE a.kind = 'nested_memory'
    AND date_filter(a.timestamp, getvariable('after_date'), getvariable('before_date'))
    AND host_filter(a.host, getvariable('host'))
),
session_roots AS (
  SELECT
    host,
    session_id,
    rtrim(arg_min(project_path, length(project_path)), '/') AS start_dir
  FROM loads
  GROUP BY host, session_id
),
session_checkouts AS (
  SELECT
    s.host,
    s.session_id,
    COALESCE(
      (SELECT arg_min(l.rule_root, length(l.rule_root))
       FROM loads l
       WHERE l.host = s.host AND l.session_id = s.session_id AND l.rule_root <> ''
         AND (s.start_dir = l.rule_root OR starts_with(s.start_dir, l.rule_root || '/'))),
      s.start_dir
    ) AS checkout
  FROM session_roots s
),
split AS (
  SELECT
    l.*,
    c.checkout,
    string_split(regexp_replace(l.file, '/[^/]*$', ''), '/') AS file_dirs,
    string_split(c.checkout, '/') AS checkout_dirs
  FROM loads l
  JOIN session_checkouts c USING (host, session_id)
),
rooted AS (
  SELECT
    *,
    CASE
      WHEN rule_root <> '' THEN rule_root
      WHEN starts_with(file, checkout || '/') THEN checkout
      ELSE array_to_string(
        file_dirs[1:COALESCE(
          list_position(
            list_transform(
              range(1, LEAST(len(file_dirs), len(checkout_dirs)) + 1),
              lambda i: file_dirs[i] = checkout_dirs[i]
            ),
            false
          ) - 1,
          LEAST(len(file_dirs), len(checkout_dirs))
        )],
        '/'
      )
    END AS root
  FROM split
),
folded AS (
  SELECT
    *,
    CASE
      WHEN scope = 'User' THEN '~'
      WHEN regexp_matches(root, '/\.claude/worktrees/[^/]+$')
        THEN regexp_extract(root, '([^/]+)/\.claude/worktrees/[^/]+$', 1)
      WHEN regexp_matches(root, '/\.worktrees/[^/]+$')
        THEN regexp_extract(root, '([^/]+)/\.worktrees/[^/]+$', 1)
      WHEN regexp_matches(root, '/\.?[a-z]*worktrees/(.+/)?[^/]+/[^/]+$')
        THEN regexp_extract(root, '([^/]+)/[^/]+$', 1)
      ELSE regexp_extract(root, '[^/]+$')
    END AS label,
    CASE
      WHEN scope = 'User' THEN regexp_replace(file, '^/(Users|home)/[^/]+/', '~/')
      ELSE substr(file, length(root) + 2)
    END AS path
  FROM rooted
),
labels AS (
  SELECT DISTINCT label FROM folded
),
labeled AS (
  SELECT
    f.host,
    f.session_id,
    f.project_path,
    f.body,
    f.path,
    COALESCE(base.label, f.label) AS repo
  FROM folded f
  LEFT JOIN labels base ON base.label = regexp_extract(f.label, '^([^.]+)\.', 1)
)
SELECT
  repo,
  path,
  COUNT(*) AS loads,
  COUNT(DISTINCT (host, session_id)) AS sessions,
  COUNT(DISTINCT project_path) AS project_dirs,
  ROUND(AVG(len(string_split_regex(trim(body), '\s+')))) AS words_per_load,
  ROUND(AVG(strlen(body))) AS bytes_per_load,
  SUM(len(string_split_regex(trim(body), '\s+'))) AS total_words,
  SUM(strlen(body)) AS total_bytes
FROM labeled
WHERE repo = '~' OR project_filter(repo, getvariable('project'))
GROUP BY repo, path
ORDER BY total_words DESC, repo, path
LIMIT COALESCE(getvariable('limit'), 30);
