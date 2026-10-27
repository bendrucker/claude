# auto-mode

Enhancements for Claude Code auto mode.

## Mod

Records each tool call's permission verdict. It depends on the `mod-events` plugin, which writes its events.

- `tool.check`: keeps the engine's verdict (`allow`, `ask`, `deny`), the deciding rule or hook, and the loop's `agentId`.
- `tool.call`: times the call and emits a `tool.verdict` event with the verdict. Tools that wait on the person (`AskUserQuestion`, the plan-mode tools) are marked `interactive`.
- `session.start`: emits a `session.start` event.
- `turn.step`: emits a `server.tool` event for each tool the API ran inside a request.

The `observability:session` index ingests the events as `mod_events` and reads them through the `classifier_verdicts` view. The engine does not expose the permission mode to `tool.check`. A `tool.verdict` therefore cannot tell an auto-mode classifier ask from a dialog ask. `tool_errors` carries each classifier refusal as `denial_kind = 'automode-blocked'`.

## Testing

```bash
bun scripts/mod-test.ts auto-mode
```
