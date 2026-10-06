# classifier-telemetry

Records each tool call's permission verdict, and reviews the asks weekly to propose allow rules and command-style changes.

## Mod

A function-hooks mod, so it loads only where `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

- `tool.check`: keeps the engine's verdict (`allow`, `ask`, `deny`), the deciding rule or hook, and the loop's `agentId`.
- `tool.call`: times the call and records it with the verdict. Tools that wait on the person (`AskUserQuestion`, the plan-mode tools) are marked `interactive`.
- `turn.step`: records each server tool the API ran inside a request.

The `claude-code:session` index reads the records into `tool_verdicts`. The engine does not expose the permission mode to `tool.check`, so the records cannot tell an auto-mode classifier ask from a dialog ask.

## Skills

- `classifier-telemetry:review`: ranks the week's asks and opens a PR against `user/settings.json`. Typed as `/classifier-telemetry:review`.

## Testing

```bash
claude plugin test plugins/classifier-telemetry
```
