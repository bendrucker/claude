# Mod Events

The observability floor for mods. It seats `$.modEvents.emit`, which writes each mod's events to per-session JSONL that the `claude-code:session` index ingests as `mod_events`.

- **Mod**: [`register.ts`](mod/register.ts) provides the noun and records at session start whether the session is local or reached over mosh or ssh. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Contract**: [`types/index.d.ts`](types/index.d.ts)

## Emitting

A mod lists `"dependencies": ["mod-events"]` in its `plugin.json`, adds `"../../mod-events/types"` to its `mod/tsconfig.json` `include`, and calls:

```ts
void $.modEvents.emit({ mod: "herdr", event: "herdr.call", ok: exitCode === 0, ms, detail: { exitCode, stderr } });
```

`emit` never rejects. Every mod emits `session.start` from its `session.start` hook, so a query can tell whether it was live.

Records land in `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`, `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`, one line each:

```json
{"ts":1791304406845,"session":"…","mod":"herdr","event":"herdr.call","ok":true,"ms":12,"detail":{}}
```

The session index keeps its rows after retention deletes the oldest files past 500 MB.

A test seats a stub noun from its own `engine.create` and reads the events at `modEvents.emit`:

```ts
on("engine.create", async ($, e, next) => ({ ...(await next(e)), modEvents: { emit: () => Promise.resolve() } }));
on("modEvents.emit", ($, e) => (events.push(e), { value: undefined }));
```

## Tests

`bun scripts/mod-test.ts mod-events`
