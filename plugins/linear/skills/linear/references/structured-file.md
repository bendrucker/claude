# Saving a Structured Issue File

Several skills hand off a Markdown file with YAML frontmatter for issue metadata and a body below the closing `---`. Issue refinement emits one, project planning emits a similar file, and others will follow. This document maps that shape to a Linear issue. The schema varies by producer, so read the file's frontmatter to see which keys it actually carries, extract them with whatever fits that file, and write the body to its own file so it passes by path and stays out of context.

Map the metadata keys these files tend to carry onto the `linear` CLI:

| Frontmatter | Linear |
|-------------|--------|
| `title` | `--title` |
| body (below the closing `---`) | `--description-file <path>` |
| `labels` | one `--label` per entry |
| `priority` (`urgent`, `high`, `medium`, `low`) | `--priority` `1`..`4` |
| `relations` (`blocks`, `blocked-by`, `related`, `duplicate-of`) | `linear issue relation add <id> <type> <relatedId>` |

A relation's `type` is the frontmatter key, except `duplicate-of` maps to `duplicate`. Its `relatedId` is the issue identifier in the relation's tracker URL. For keys the file omits, or ones this table does not name, map them when Linear has a matching field and ask when the mapping is unclear.

Routing fields (team, assignee, state) are not in the file. Take them from the user at save time. Default the state from assignment as in [Issue Status](conventions.md#issue-status). `getDefaultState` in `hooks/save-issue.ts` encodes that rule.

## Simple Saves

When the file declares no relations, the connector `save_issue` is enough: pass the title, the body as `description`, the labels, and the routing fields, per [Creating vs Updating](../SKILL.md#creating-vs-updating). This is the default.

## Relations

The connector and MCP tools cannot set relations, so a file that declares any needs the `linear` CLI. When the Environment block shows it is not installed, save through the connector and report the relation targets you skipped so the user can add them by hand.

With the CLI present, create the issue with the body by file, then add one relation per entry from the parsed frontmatter:

```bash
new_id=$(linear issue create --title "$title" --description-file "$body_file" \
  --team "$team" --state "$state" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
linear issue relation add "$new_id" blocked-by ENG-100
```

Add `--label`, `--assignee`, and `--priority` when the file carries them. The `linear-cli:linear-cli` skill documents the full CLI surface.
