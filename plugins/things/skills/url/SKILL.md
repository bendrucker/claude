---
name: things:url
description: Create, update, and manage Things 3 tasks and projects, including quick inbox captures. Not for reads. Use things:jxa to query data.
argument-hint: "<add | update | show | search | json | capture> [key=value ...]"
effort: low
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts:*)"
  - Read
---

# Things URL Scheme

Write operations for Things 3 via the `things:///` URL scheme.

## Arguments

`$0` is the command (`add`, `add-project`, `update`, `update-project`, `show`, `search`, `json`); the rest are its `key=value` params. Pass both straight to `url.ts`. A command is required. With none, infer the operation from the request. `capture` routes to `inbox.ts` instead (see [Inbox Capture](#inbox-capture)).

## Quick Start

Use `url.ts` for most operations. It handles auth tokens and URL encoding.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts <command> [key=value ...]

# Bulk update: pass multiple id= params to batch via JSON command
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts update id=X id=Y id=Z when=tomorrow
```

For raw URL scheme access: `open -g "things:///add?title=Buy%20milk&when=today"`. Use `-g` for data commands to run in background. Omit it for `show`/`search` to foreground Things.

## Commands

| Command | Description | Auth required |
|---------|-------------|:---:|
| `add` | Create a todo | No |
| `add-project` | Create a project with optional todos | No |
| `update` | Modify a todo's properties | Yes |
| `update-project` | Modify a project's properties | Yes |
| `show` | Navigate to a list, todo, or project | No |
| `search` | Open search with optional query | No |
| `json` | Batch create/update via JSON payload | Yes (for updates) |

Full parameters, JSON payload schema, and limits: [url-scheme.md](url-scheme.md). `url.ts` fetches the auth token automatically ([1password.md](1password.md)).

`show` accepts built-in list IDs: `inbox`, `today`, `anytime`, `upcoming`, `someday`, `logbook`, `tomorrow`, `deadlines`, `repeating`, `all-projects`, `logged-projects`.

## Tags

Things drops a tag it does not already hold and still reports success. `url.ts` resolves `tags` and `add-tags` against the stored tags first, so an unknown tag fails the call and names itself instead of vanishing from the write. Pass `--create-tags` to create the missing ones:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts add title="Fix login" tags=bug --create-tags
```

Matching folds case, so `Bug` resolves to a stored `bug`. An empty `tags=` still clears a todo's tags. Tags inside a raw `json data=...` payload go through unchecked.

## Reorder Items

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts [--list today|anytime|someday] <id1> <id2> <id3> ...
```

Items appear at the top of the list in the order specified. Default list is `today`. Use the `--list` value matching the items' current scheduling state. Reordering reschedules each item out of the list and back, so an item carrying a specific date loses it, and order within a project is untouched.

## Inbox Capture

For quick captures to the inbox, use `inbox.ts`. It tags each todo `Claude` and appends session attribution, so prefer it over `url.ts add` when delegating a task mid-session.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --session-id ${CLAUDE_SESSION_ID} title="Buy milk"
```

`title` captures one todo. `titles` (newline-separated) captures several at once. Add tags with `--tag` (repeatable). Other params: `notes` (max 10,000 chars), `tags` (comma-separated), `checklist-items` (newline-separated, max 100).

On success it prints a confirmation. With the `x-callback-url` plugin, xcall returns the todo ID and the script prints `https://things.bendrucker.me/show?id=...`. Present that link to the user. Without xcall it prints `captured: <title>`.

## Callback

When the `x-callback-url` plugin is installed, `url.ts` uses xcall to get a response from Things on stdout. Present the result as clickable `https://things.bendrucker.me/show?id=<id>` links:

- **Single todo** (`add`, `update`): returns `x-things-id=<id>` — present one link
- **Batch** (`json`): returns `x-things-ids=["id1","id2"]` — present a bulleted list with each todo's title and link

Callback is enabled by default. Disable with `--callback=false` to fall back to fire-and-forget via `open -g`. If xcall is unavailable, the script falls back silently.

## Areas

The `list` parameter only works with project names. To file a todo under an area (on create or move), use `list-id` with the area UUID, not `area-id`. Query area IDs via the `things:jxa` skill.

## Notes Formatting

Things notes support [Markdown](https://culturedcode.com/things/support/articles/4651820/) plus Things-specific `::highlight::` syntax.

## Gotchas

#### Silent Success

`url.ts` prints only when xcall returns a result. On the fallback path it exits 0 with empty stdout after a successful write, so empty output says nothing about whether the change landed.

Judge failure by a non-zero exit and read stderr for the cause. To confirm a write that printed nothing, query the todo with the `things:jxa` skill. Never retry blind: a repeated `add` creates duplicate todos.

`inbox.ts` and `reorder.ts` do print on success regardless of xcall, so silence from those is a genuine failure.

#### Sandbox-blocked URL handoff

If stderr mentions `procNotFound`, `-10810`, or `LSOpenURLsWithRole`, the macOS sandbox blocked the URL handoff to Things. `url.ts` and `inbox.ts` carry the `claude:dangerouslyDisableSandbox` marker so the `mac` plugin's sandbox hook runs them outside the sandbox. If it still happens, verify the `mac` plugin is installed so that hook is active.

## Tips

- **Moving out of inbox**: Set `when=anytime` to move a todo out of inbox without assigning an area
- **Rate limiting**: Max 250 operations per 10 seconds. For 3+ items, use multi-ID syntax (`id=X id=Y id=Z`) to batch into a single JSON command instead of individual calls.
- **Repeating todos**: Cannot update `when` or `deadline` on repeating to-dos
