# Things MCP Server

An MCP server exposing Things 3 over stdio. It speaks JSON-RPC on stdin and stdout, contains no auth code, and opens no socket.

[tailgate](https://github.com/bendrucker/tailgate) supplies everything this server does not. It is an OAuth 2.0 resource server published through Tailscale Funnel, and it spawns this server as a child process, so reaching Things from a phone or a laptop goes through tailgate's OAuth flow, token introspection, audience validation, and per-identity policy.

```
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

stdout carries JSON-RPC framing and nothing else. One stray line of output desynchronizes the client, which then reports parse errors that name neither the writer nor the write.

This constrains more than `stdio.ts`. The tools reuse the plugin's CLI scripts (`scripts/url.ts`, `scripts/inbox.ts`, `scripts/reorder.ts`, `scripts/ensure-running.ts`), and those scripts print for their own human callers. Four rules keep the two uses apart:

- Printing belongs under `import.meta.main`. A function called by both the CLI and a tool returns its result and lets the CLI print it.
- Diagnostics go to stderr. tailgate captures child stderr into its logs, which is where a production failure gets read.
- A spawned subprocess pipes both streams. `src/mcp/jxa.ts` and `xcall` in `scripts/url.ts` capture output rather than inheriting it.
- Bun's `$` inherits stdout unless told otherwise, so the Launch Services handoff in `scripts/url.ts` runs `.quiet()` and forwards what it captured to stderr.

`stdio.test.ts` drives a real handshake and fails on any stdout line that will not parse, which catches a new print anywhere in the import closure.

## Tools

Reads run the plugin's JXA query scripts through the `mac` plugin's runner: `list_todos`, `find_todos`, `query_logbook`, `list_metadata`.

Writes go through the `things:///` URL scheme: `add_todo`, `add_project`, `update_todos`, `capture_inbox`, `reorder_todos`. Cultured Code exposes no write API beyond it.

`capture_inbox` takes `session_id` and `directory` and appends a resume command to the todo's notes. `directory` is a parameter because this process runs as tailgate's child, whose working directory has nothing to do with the session being attributed.

## Layout

- `stdio.ts`: the entry point. Constructs the server, registers the tools, connects the stdio transport.
- `tools.ts`: the tool registrations, wrapping the plugin's read scripts and write modules.
- `jxa.ts`: locates the `mac` plugin's JXA runner by filesystem layout and spawns it.

## Local Development

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | bun src/mcp/stdio.ts
```

Each message needs its own trailing newline. The transport frames on newlines, so a final line without one is never answered.

`bunx @modelcontextprotocol/inspector bun src/mcp/stdio.ts` gives the same thing interactively.

## Constraints

Every tool needs the Mac awake with a logged-in GUI session. Reads drive Things through Apple Events and writes hand off to Launch Services, and neither works against a Things that cannot run. Mail to Things stays the capture path when the Mac is asleep.

The first tool call that touches Things prompts for a TCC Automation grant against whatever binary spawned it. Approve it once in System Settings if the dialog is missed.
