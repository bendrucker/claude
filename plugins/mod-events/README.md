# Mod Events

Telemetry for mods. It adds `$.modEvents.emit`, which writes each mod's events to per-session JSONL. Each line is an OpenTelemetry log record, so a collector can tail the files, and the `observability:session` index ingests them as `mod_events`.

- **Mod**: [`register.ts`](mod/register.ts) provides `emit` and records at session start whether the session is local or reached over mosh or ssh, with each attached herdr client's reach. Requires `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.
- **Types**: [`types/index.d.ts`](types/index.d.ts) declares `$.modEvents.emit`.

## Emitting

A mod lists `"dependencies": ["mod-events"]` in its `plugin.json`, adds `"../../mod-events/types"` to its `mod/tsconfig.json` `include`, and calls:

```ts
void $.modEvents.emit({ mod: "herdr", event: "herdr.call", ok: exitCode === 0, ms, detail: { command, exitCode, stderr } });
```

`emit` never rejects. Without this plugin enabled, the default `emit` drops events. Every mod emits `session.start` from its `session.start` hook, so a query can tell whether it was live.

Records land in `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`, `<config>` being `CLAUDE_CONFIG_DIR` or `~/.claude`. `<instance>` is the first event's timestamp, so a reload starts new files, and `<n>` rolls at 64 KB.

## Format

Each line is one OTel log record with the data model's field names, flat rather than wrapped in an OTLP `resourceLogs` envelope:

```json
{"timestamp":"2026-10-06T17:00:00.012Z","severity_text":"WARN","severity_number":13,"event_name":"herdr.herdr.call","attributes":{"command":"pane.report-agent","exitCode":1,"stderr":"…","duration_ms":12,"session.id":"<session-id>"},"resource":{"service.name":"claude-code","service.version":"2.1.291","claude_code.surface":"mosh"},"scope":{"name":"herdr"}}
```

- `timestamp` is ISO 8601 in UTC, like Claude Code's own `event.timestamp`.
- `severity_text` is `INFO` (9), or `WARN` (13) when `ok` is false. A failing mod degrades the session without ending it, so nothing logs `ERROR`.
- `event_name` is `<mod>.<event>`.
- `attributes` holds `detail`, plus `duration_ms` from `ms` and `session.id`. Both keys match Claude Code's native OTel events, so a backend can join a mod's records to the session's own telemetry.
- `resource` carries `service.name` (`claude-code`, as the native exporter uses) and `service.version`. Once the session's heartbeat has judged it, it also carries `claude_code.surface` (`local`, `mosh`, or `ssh`).
- `scope.name` is the mod. The engine doesn't expose a calling plugin's version, so `scope` has no `version`.

`$.fs` can only replace a file whole, so each event rewrites its chunk. The new text always extends the old, and a rolled chunk is never written again, so a tailer's fingerprint and offset stay valid. `$.fs.write` truncates and then writes in place rather than renaming a temp file over the chunk, and `$.fs` has no rename. A tailer polling inside that window reads an empty file. The collector's `filelog` receiver skips a file whose fingerprint is empty, then resumes at its offset once the bytes are back.

## Collector

An `otelcol-contrib` `filelog` receiver maps each line into a log record. `event_name` lands as the `event.name` attribute, as Claude Code's own events carry it:

```yaml
receivers:
  filelog/mod_events:
    include: ["${env:HOME}/.claude/mod-events/**/*.jsonl"]
    start_at: beginning
    operators:
      - type: json_parser
        parse_to: body
        timestamp:
          parse_from: body.timestamp
          layout_type: gotime
          layout: "2006-01-02T15:04:05.000Z07:00"
        severity:
          parse_from: body.severity_text
        scope_name:
          parse_from: body.scope.name
      - type: move
        from: body.attributes
        to: attributes
      - type: move
        from: body.event_name
        to: attributes["event.name"]
      - type: move
        from: body.resource
        to: resource
      - type: remove
        field: body
```

Retention deletes the oldest files once the directory passes 500 MB. The session index keeps rows it has already ingested.

In a test, stub `$.modEvents` from your own `engine.create` hook and collect events at `modEvents.emit`:

```ts
on("engine.create", async ($, e, next) => ({ ...(await next(e)), modEvents: { emit: () => Promise.resolve() } }));
on("modEvents.emit", ($, e) => (events.push(e), { value: undefined }));
```

## Tests

`bun scripts/mod-test.ts mod-events` runs the mod's tests.
