# Saving a Structured Issue File

Several skills hand off a Markdown file with YAML frontmatter for issue metadata and a body below the closing `---`. Issue refinement emits one, project planning emits a similar file, and others will follow. This document maps that shape to a Linear issue. The schema varies by producer, so read the file's frontmatter to see which keys it actually carries, extract them with whatever fits that file, and write the body to its own file so it passes by path and stays out of context.

Map the metadata keys these files tend to carry onto the connector `save_issue` params:

| Frontmatter | `save_issue` param |
|-------------|--------------------|
| `title` | `title` |
| body (below the closing `---`) | `description` |
| `labels` | `labels` (array of names) |
| `priority` (`urgent`, `high`, `medium`, `low`) | `priority` `1`..`4` |
| `relations.blocks` | `blocks` (array of identifiers) |
| `relations.blocked-by` | `blockedBy` |
| `relations.related` | `relatedTo` |
| `relations.duplicate-of` | `duplicateOf` |

Relation params take the issue identifier from each entry's tracker URL. `blocks`, `blockedBy`, and `relatedTo` accept arrays. `duplicateOf` takes a single identifier. Each is append-only. A save never removes relations you did not name. For keys the file omits, or ones this table does not name, map them when Linear has a matching field and ask when the mapping is unclear.

When the body ends in a `## 🤖 Agent Context` heading, rewrite it as a collapsible before saving, per [Collapsible Sections](conventions.md#collapsible-sections).

Routing fields (team, assignee, state) are not in the file. Take them from the user at save time. Default the state from assignment as in [Issue Status](conventions.md#issue-status). `getDefaultState` in `hooks/save-issue.ts` encodes that rule.

## Saving

The connector `save_issue` handles the whole file in one call, relations included. Pass the title, the body as `description`, the labels, the routing fields, and the relation params from the table above, per [Creating vs Updating](../SKILL.md#creating-vs-updating). This is the default.

```json
{
  "team": "ENG",
  "title": "Fix authentication bug",
  "description": "…",
  "state": "Todo",
  "blockedBy": ["ENG-100"],
  "relatedTo": ["ENG-42"]
}
```

## CLI Fallback

When the connector is unavailable and the Environment block shows the `linear` CLI installed, fall back to it: create the issue with the body by file, then add one relation per entry from the parsed frontmatter.

```bash
new_id=$(linear issue create --title "$title" --description-file "$body_file" \
  --team "$team" --state "$state" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
linear issue relation add "$new_id" blocked-by ENG-100
```

The CLI relation `type` is the frontmatter key, except `duplicate-of` maps to `duplicate`. Add `--label`, `--assignee`, and `--priority` when the file carries them. If neither path can set relations, save the issue and report the relation targets you skipped so the user can add them by hand. The `linear-cli:linear-cli` skill documents the full CLI surface.
