# classifier-telemetry

Records each tool call's permission verdict and wall time, so auto-mode classifier cost is measurable from the session index. A function-hooks mod, so it loads only where `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

## Hooks

- `tool.check`: keeps the engine's verdict (`allow`, `ask`, `deny`) and the deciding rule for the call.
- `tool.call`: times the call and writes one record to `~/.claude/classifier-telemetry/<session>/<tool_use_id>.json`, which the `claude-code:session` index reads into `tool_verdicts`.

## Testing

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/classifier-telemetry
```
