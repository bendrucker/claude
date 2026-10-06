# Mod Events

Telemetry for mods. It adds `$.modEvents.emit`, which writes each mod's events to per-session JSONL. The `claude-code:session` index ingests that JSONL as `mod_events`.

- **Mod**: [`register.ts`](mod/register.ts) provides `emit` and records at session start whether the session is local or reached over mosh or ssh, with each attached herdr client's reach. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Types**: [`types/index.d.ts`](types/index.d.ts) declares `$.modEvents.emit`.

## Emitting

A mod lists `"dependencies": ["mod-events"]` in its `plugin.json`, adds `"../../mod-events/types"` to its `mod/tsconfig.json` `include`, and calls:

```ts
void $.modEvents.emit({ mod: "herdr", event: "herdr.call", ok: exitCode === 0, ms, detail: { command, exitCode, stderr } });
```

`emit` never rejects. Without this plugin enabled, the default `emit` drops events. Every mod emits `session.start` from its `session.start` hook, so a query can tell whether it was live.

Records land in `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`, `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`, one JSON object per line. `<instance>` is the first event's timestamp, so a reload starts new files, and `<n>` rolls at 64 KB:

```json
{"ts":1791304406845,"session":"<session-id>","mod":"herdr","event":"herdr.call","ok":true,"ms":12,"detail":{}}
```

Retention deletes the oldest files once the directory passes 500 MB. The session index keeps rows it has already ingested.

In a test, stub `$.modEvents` from your own `engine.create` hook and collect events at `modEvents.emit`:

```ts
on("engine.create", async ($, e, next) => ({ ...(await next(e)), modEvents: { emit: () => Promise.resolve() } }));
on("modEvents.emit", ($, e) => (events.push(e), { value: undefined }));
```

## Tests

`bun scripts/mod-test.ts mod-events` runs the mod's tests.
