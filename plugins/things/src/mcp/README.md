# Things MCP Server

An MCP server exposing Things 3 over stdio. It speaks JSON-RPC on stdin and stdout, contains no auth code, and opens no socket.

[tailgate](https://github.com/bendrucker/tailgate) supplies everything this server does not. It is an OAuth 2.0 resource server published through Tailscale Funnel, and it spawns this server as a child process, so reaching Things from a phone or a laptop goes through tailgate's OAuth flow, token introspection, audience validation, and per-identity policy.

```text
phone / laptop / claude.ai
            │ OAuth
            ▼
   Tailscale Funnel ──► tailgate ──► things stdio (child process)
                            │ introspect, audience, policy
                            ▼
                          tsidp
```

Identity comes from [tsidp](https://tailscale.com/docs/features/tsidp), so a caller's identity is their tailnet login.

## Stdout Discipline

stdout carries JSON-RPC framing and nothing else. One stray line of output desynchronizes the client, which then reports parse errors that don't identify what printed the line.

This constrains more than `stdio.ts`. The tools reuse the plugin's CLI scripts (`scripts/url.ts`, `scripts/inbox.ts`, `scripts/reorder.ts`, `scripts/ensure-running.ts`), and those scripts print for their own human callers. Four rules keep the two uses apart:

- Printing belongs under `import.meta.main`. A function called by both the CLI and a tool returns its result and lets the CLI print it.
- Diagnostics go to stderr. tailgate captures child stderr into its logs, which is where a production failure gets read.
- A spawned subprocess pipes both streams. `src/mcp/jxa.ts` and `xcall` in `scripts/url.ts` capture output rather than inheriting it.
- Bun's `$` inherits stdout unless told otherwise, so the Launch Services handoff in `scripts/url.ts` runs `.quiet()` and forwards what it captured to stderr.

`stdio.test.ts` drives a real handshake and fails on any stdout line that will not parse, which catches a new print anywhere in the import closure.

## Tools

Reads run the plugin's JXA scripts through the `mac` plugin's runner: `list_todos`, `get_todo`, `find_todos`, `search_todos`, `query_logbook`, `list_metadata`. Tag creation takes the same path, as the one write that the URL scheme cannot express.

Writes go through the `things:///` URL scheme: `add_todo`, `add_project`, `update_todos`, `update_project`, `capture_inbox`, `reorder_todos`. Cultured Code exposes no write API beyond it.

`capture_inbox` accepts an optional `session_id` and `directory`. Given a `session_id` it appends a resume command to the todo's notes. `directory` is a parameter because this process runs as tailgate's child, whose working directory has nothing to do with the session being attributed.

## Tags

Things refuses to apply a tag that does not already exist and reports success anyway, so a write naming an unknown tag lands with that tag missing and nothing said about it. Every tag-carrying write (`add_todo`, `add_project`, `update_todos`, `capture_inbox`) therefore resolves its tags against Things before dispatching:

- A tag that exists is sent under the casing Things stores, so `CLAUDE` and `claude` are one tag rather than two spellings of it.
- A tag that does not exist fails the call, naming it alongside the tags Things holds. Nothing is written.
- `create_tags: true` creates the missing ones first, which is how a caller opts into growing the tag namespace.

The tag list is fetched once per process (around two seconds) and held. A miss refetches once before it becomes a failure, so a tag created in the Things UI mid-session resolves rather than being rejected from a stale cache.

`update_todos` resolves both `tags` and `add_tags` before its first batch, because a rejection landing partway through would leave the earlier batches written.

The CLI paths share the requirer. `inbox.ts` resolves its capture tags, and `url.ts` resolves the `tags` and `add-tags` params of any command it dispatches, taking `--create-tags` where the tools take `create_tags`. A raw `json data=...` payload is the one write that skips the gate, since its tags are already inside a JSON document the CLI hands through untouched.

## Response Size

A list read returns a preview of each todo's notes rather than the whole thing. Notes are the bulk of the payload: over the logbook they measured 61% of it, median 223 characters and up to 3552, so a read that carried them in full fit a few dozen todos where the preview fits a few hundred. `get_todo` serves one todo's full notes and dates, and it reaches completed todos too, so nothing is lost by not shipping notes in every list.

`list_todos`, `find_todos`, and `query_logbook` each take a `limit`. It stops the JXA walk rather than trimming the response, which matters because every todo the walk visits costs several Apple Events.

Past that, a read that still exceeds 32KB drops items from the end and returns `{truncated, returned, total, note, items}` instead of the bare list. The `note` names an action that tool actually supports: a narrower tag or project for `find_todos`, a smaller `limit` for `list_todos`, and for `query_logbook`, re-querying with `end` set to the `completionDate` of the last item returned. A payload within budget is returned unchanged.

The cap is about framing, not about the client's context: the payload is a JSON string nested in the JSON-RPC envelope, so escaping can roughly double it, and a proxy reading the line with Go's default `bufio.Scanner` drops anything past 64KB without saying why.

## Text Search

`search_todos` matches a substring against a todo's title, its notes, or both. Matching is literal and case-sensitive, because that is what Things' own predicate does.

The predicate runs inside Things rather than as a walk here, which is what makes it affordable: a title match answered in around 570ms and a notes match in around 200ms, against roughly 3s to walk the open todos and compare in JavaScript. Title and notes go as two predicates and merge by id, because Things answers an `_or` of the two with an empty result rather than a union.

The search covers open todos only. Scoping the same predicate to the logbook list did not return in two minutes, the same wall the date predicates hit. `query_logbook` remains the way to reach completed todos.

Note that Things keeps working on a predicate whose Apple Event already timed out. A single logbook `whose` left it churning long enough to time out unrelated searches that answer in under a second on their own.

`list_todos` does not accept the logbook. It holds tens of thousands of items with no attribute to narrow by, and a probe found no predicate that pushes a date filter down to Things: `whose({completionDate: ...})` against the logbook took 49 seconds and against all todos returned nothing. `query_logbook` walks newest-first and stops at the range boundary, which is the only bounded way in. That also rules out a cursor: resuming would re-walk from the top each time.

`stdio.ts` also defaults `XCALL_TIMEOUT_SECONDS` to 10 so a write cannot spend a client's whole request budget. Both `run.sh` and `xcallBackstopMs` read it, putting the worst case around 47s. An operator's own value wins.

## Layout

- `stdio.ts`: the entry point. Constructs the server, registers the tools, connects the stdio transport.
- `tools.ts`: the tool registrations, wrapping the plugin's read scripts and write modules.
- `tags.ts`: resolves a write's tags against Things and creates missing ones on request.
- `jxa.ts`: locates the `mac` plugin's JXA runner by filesystem layout and spawns it.

## Local Development

Run from the plugin root, which is where `bun` resolves the paths below.

```bash
cd plugins/things
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bun src/mcp/stdio.ts
```

Each message needs its own trailing newline. The transport frames on newlines, so a final line without one is never answered.

`bunx @modelcontextprotocol/inspector bun src/mcp/stdio.ts` gives the same thing interactively.

## What Cannot Be Read

Checklist items are write-only. The URL scheme sets, prepends, and appends them, and `update_todos` exposes all three, but Things' scripting dictionary has no accessor for them, so no tool can read one back. `get_todo` says so in its description rather than returning a field that is always absent.

Deleting has no URL-scheme command, so no tool exposes it and `update_todos` with `canceled` is as close as a caller gets. Things' scripting dictionary does offer `delete`, which moves an item to the Trash list rather than erasing it. A trashed todo keeps its id and still reports status `open`, so `get_todo` cannot tell one from a live todo.

## Constraints

Every tool needs the Mac awake with a logged-in GUI session. Reads drive Things through Apple Events and writes hand off to Launch Services, and neither works if Things cannot run. Mail to Things stays the capture path when the Mac is asleep.

The first tool call that touches Things prompts for a TCC Automation grant against whatever binary spawned it. Approve it once in System Settings if the dialog is missed.
