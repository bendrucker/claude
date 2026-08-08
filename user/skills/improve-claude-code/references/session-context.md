# Session Context

The mechanics behind [Session Context](../SKILL.md#session-context): how to pull each todo's originating session and query it safely.

Each todo's notes embed the originating session as `Session: <uuid>`. For every selected todo, parse that UUID and use the `claude-code:session` skill to pull the original context: what you were doing, the commands that ran, and the errors that prompted the todo. This is richer than the todo's prose summary and grounds each plan in the real failure.

Refresh the index once (`refresh.ts --refresh`), then look up each todo's session over the shared file with `duckdb -readonly` at the stable DB path (see the session skill's "Parallel Queries" section). Read-only opens coexist, so a batch of lookups runs concurrently without contending; never re-refresh per todo. Query `messages` / `content_items` / `text_content` filtered by `WHERE session_id = '<uuid>'`. Do not filter by `host`: many todos come from the work machine, whose corpus is imported as a separate host, and omitting the filter spans every machine. Distill the result to a few lines per todo and pass it, with the title and notes, to the matching agent in the [Plan](../SKILL.md#plan) workflow. Agents receive the stable DB path for any further read-only lookup but never refresh.

If the UUID is absent from the index (not yet imported, or the index needs a refresh), proceed with notes only and say so for that todo.

## Egress

Session context informs local planning only. Imported hosts may be marked `block_egress`, so never paste session-derived content into PR bodies or any other output that leaves the machine.
