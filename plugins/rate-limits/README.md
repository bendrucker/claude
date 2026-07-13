# Rate Limits

Predict when the current usage burn rate will exhaust the 5-hour usage limit, and warn before it does.

## Contents

- **Hook** (`UserPromptSubmit`): fits recent usage samples for the current block, projects when the line reaches 100%, and injects guidance when that lands before the block resets. A prediction-independent backstop fires when the block is already exhausted.
- **Recorder** (`scripts/recorder.ts`): a statusline wrapper that mirrors the `rate_limits` payload to `rl.json` and appends an edge-triggered history line, then execs the inner statusline.
- **Skill** (`rate-limits`): install/prepare the recorder and compiled hook, doctor, status, tuning, and a pre-flight check before large work.
- **CLI** (`scripts/rate-limits.ts`): `doctor`, `status`, and `install`.

## Testing

```bash
bun test plugins/rate-limits
```
