# auto-mode

Enhancements for Claude Code auto mode.

## Mod

Records each tool call's permission verdict. It depends on the `mod-events` plugin, which writes its events.

- `tool.check`: keeps the engine's verdict (`allow`, `ask`, `deny`), the deciding rule or hook, and the loop's `agentId`.
- `tool.call`: times the call and emits a `tool.verdict` event with the verdict. Tools that wait on the person (`AskUserQuestion`, the plan-mode tools) are marked `interactive`.
- `session.start`: emits a `session.start` event.
- `classic.PermissionDenied`: emits a `classifier.deny` event with the classifier's reason and the permission mode each time the auto-mode classifier refuses a call.
- `turn.step`: emits a `server.tool` event for each tool the API ran inside a request.

The `observability:session` index ingests the events as `mod_events` and reads them through the `classifier_verdicts` view. The engine does not expose the permission mode to `tool.check`, so a `tool.verdict` cannot tell an auto-mode classifier ask from a dialog ask. A `classifier.deny` event records each refusal and why.

## Testing

```bash
bun scripts/mod-test.ts auto-mode
```
