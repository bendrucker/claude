# Saving a Structured Issue File

The file carries issue metadata in YAML frontmatter and the body below the closing `---`. Keys vary by producer, so read the frontmatter for the keys it carries. Write the body to its own file so it passes by path and stays out of context.

Map the keys onto connector `save_issue` params:

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

Relation params take the identifier from each entry's tracker URL. `duplicateOf` takes a single identifier, the others arrays. Map keys this table does not name when Linear has a matching field, and ask when the mapping is unclear.

When the body ends with a `## 🤖 Agent Context` section, rewrite its heading as a collapsible before saving, per [Collapsible Sections](conventions.md#collapsible-sections).

Take routing fields (team, assignee, state) from the user at save time, defaulting state per [Issue Status](conventions.md#issue-status).

## Saving

Save the whole file in one connector `save_issue` call, relations included:

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

When the connector is unavailable and `linear --version` succeeds, create the issue with the body by file, then add one relation per entry.

```bash
new_id=$(linear issue create --title "$title" --description-file "$body_file" \
  --team "$team" --state "$state" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -1)
linear issue relation add "$new_id" blocked-by ENG-100
```

The CLI relation `type` is the frontmatter key, except `duplicate-of` maps to `duplicate`. Add `--label`, `--assignee`, and `--priority` when the file carries them. If neither path can set relations, save the issue and report the skipped relation targets to the user.
