---
name: things:url
description: Write to Things 3 from this machine's CLI, including quick inbox captures. Prefer the things MCP tools, which reach the same writes from any machine. Use this skill for a raw json data= payload, or when that server is unreachable.
argument-hint: "<add | update | show | search | json | capture> [key=value ...]"
effort: low
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts:*)"
  - Read
---

# Things URL Scheme

Write to Things 3 through the `things:///` URL scheme. A write is done when the script prints its confirmation or link, or, on a silent run, when a `things:jxa` query shows the change.

## Arguments

`$0` is the command (`add`, `add-project`, `update`, `update-project`, `show`, `search`, `json`). The rest are its `key=value` params. Pass both straight to `url.ts`. With no command, infer the operation from the request. `capture` routes to `inbox.ts` instead (see [Inbox Capture](#inbox-capture)).

## Usage

`url.ts` handles the auth token ([1password.md](1password.md)) and URL encoding. Multiple `id=` params batch into one JSON command, which keeps 3+ items under the rate limit of 250 operations per 10 seconds.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts --link-base "${user_config.link_base}" <command> [key=value ...]
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts --link-base "${user_config.link_base}" update id=X id=Y id=Z when=tomorrow
```

For raw access, `open -g "things:///add?title=Buy%20milk&when=today"`. Use `-g` for data commands so Things stays in the background, and omit it for `show`/`search`.

Parameters, the JSON payload schema, built-in list IDs, and limits: [url-scheme.md](url-scheme.md).

## Tags

`url.ts` resolves `tags` and `add-tags` against the stored tags, case-insensitively, and fails naming any unknown tag, since Things silently drops tags it does not hold. Pass `--create-tags` to create the missing ones:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/url.ts --link-base "${user_config.link_base}" add title="Fix login" tags=bug --create-tags
```

An empty `tags=` clears a todo's tags. Tags inside a raw `json data=...` payload go through unchecked.

## Reorder Items

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/reorder.ts [--list today|anytime|someday] <id1> <id2> <id3> ...
```

Items land at the top of the list in the given order. `--list` defaults to `today`. Pass the list matching the items' current scheduling state.

`reorder.ts` reschedules each item out of the list and back, so an item with a specific date has that date replaced by the list. Order within a project is unaffected.

## Inbox Capture

Use `inbox.ts` for quick captures and for delegating a task mid-session. It tags each todo `Claude` and appends session attribution.

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/inbox.ts --link-base "${user_config.link_base}" --session-id ${CLAUDE_SESSION_ID} title="Buy milk"
```

`title` captures one todo, `titles` (newline-separated) several. Other params: `--tag` (repeatable), `notes` (max 10,000 chars), `tags` (comma-separated), `checklist-items` (newline-separated, max 100).

## Output

With the `x-callback-url` plugin installed, the scripts read Things' response through xcall:

- `add`, `update`, and `inbox.ts`: a link to the todo. Present it.
- `json`: `x-things-ids=["id1","id2"]`. Present a bulleted list of each todo's title linked as `${user_config.link_base}<id>`.

`--callback=false` switches `url.ts` to fire-and-forget `open -g`. Without xcall it falls back to that silently.

On the fallback path `url.ts` exits 0 with empty stdout after a successful write. Judge failure by a non-zero exit and stderr. Confirm a silent write with `things:jxa` before retrying, since a repeated `add` creates duplicates. `inbox.ts` (`captured: <title>`) and `reorder.ts` always print on success, so silence from them is a failure.

When stderr mentions `procNotFound`, `-10810`, or `LSOpenURLsWithRole`, the sandbox blocked the handoff to Things. `url.ts` and `inbox.ts` carry the `claude:dangerouslyDisableSandbox` marker that the `mac` plugin's sandbox hook acts on, so check that the `mac` plugin is installed.

## Things Behavior

- `list` takes project names only. File a todo under an area with `list-id` and the area UUID (from `things:jxa`).
- `when=anytime` moves a todo out of the inbox without assigning an area.
- `when` and `deadline` cannot be updated on repeating todos.
- Notes support [Markdown](https://culturedcode.com/things/support/articles/4651820/) plus `::highlight::`.
