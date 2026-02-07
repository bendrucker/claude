# Session

Search and analyze Claude Code conversation history.

## Contents

- `SKILL.md` - Skill definition with CLI usage examples
- `cli/` - CLI implementation with subcommands: `search`, `digest`, `stats`, `errors`
- `search.md` - Advanced CLI reference documentation

## Observability

The CLI uses OpenTelemetry for traces and logs. By default, no telemetry output is produced (zero overhead).

- `--log-level debug` — emit log records to stderr
- `--log-level trace` — emit log records and spans to stderr
- `--log-file <path>` — write traces and logs to a JSONL file for offline analysis
- `OTEL_EXPORTER_OTLP_ENDPOINT` — send traces and logs via OTLP (suppresses console output)
- `OTEL_TRACES_EXPORTER=console` — force span output to stderr (always honored, even with OTLP)

## Testing

```bash
npm test -- plugins/claude-code/skills/session
```

## Inspiration

- [How I Built a Skill That Lets Me Talk to Claude's Conversation Memory](https://alexop.dev/posts/building-conversation-search-skill-claude-code/)
