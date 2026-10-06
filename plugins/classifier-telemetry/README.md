# classifier-telemetry

Records each tool call's permission verdict, and reviews the asks weekly to propose allow rules and command-style changes.

## Mod

A function-hooks mod, so it loads only where `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. It depends on the `mod-events` plugin, which writes its events.

- `tool.check`: keeps the engine's verdict (`allow`, `ask`, `deny`), the deciding rule or hook, and the loop's `agentId`.
- `tool.call`: times the call and emits a `tool.verdict` event with the verdict. Tools that wait on the person (`AskUserQuestion`, the plan-mode tools) are marked `interactive`.
- `session.start`: emits a `session.start` event.
- `turn.step`: emits a `server.tool` event for each tool the API ran inside a request.

The `observability:session` index ingests the events as `mod_events` and reads them through the `classifier_verdicts` view. The engine does not expose the permission mode to `tool.check`, so the records cannot tell an auto-mode classifier ask from a dialog ask.

## Skills

- `classifier-telemetry:review`: ranks the week's asks and opens a PR against `user/settings.json`. Manual only: `/classifier-telemetry:review`.

## Testing

```bash
bun scripts/mod-test.ts classifier-telemetry
```
