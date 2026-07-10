# Rate Limits

Predict when the current usage burn rate will exhaust the 5-hour usage limit, and warn before it does.

## Contents

- **Hook** (`UserPromptSubmit`): fits recent usage samples for the current block, projects when the line reaches 100%, and injects guidance when that lands before the block resets. A prediction-independent backstop fires when the block is already exhausted.
- **Recorder** (`scripts/recorder.ts`): a statusline wrapper that mirrors the `rate_limits` payload to `rl.json` and appends an edge-triggered history line, then execs the inner statusline.
- **Skill** (`rate-limits`): install/prepare, doctor, status, and a pre-flight check before large work.
- **CLI** (`scripts/rate-limits.ts`): `doctor`, `status`, and `install`.

## Recorder

The prediction needs usage history, which the single-snapshot `rl.json` cannot hold. The recorder wraps your existing statusline command so every render records a sample. Set `statusLine.command` in `~/.claude/settings.json` to wrap the inner command:

```json
{
  "statusLine": {
    "command": "bun /path/to/plugins/rate-limits/scripts/recorder.ts -- <your existing statusline command>"
  }
}
```

The recorder reads the statusline payload once, writes `rl.json` (single writer), appends to history, then execs the inner command with the same stdin. Recording is best-effort, so a failure never blocks rendering.

## History

History is edge-triggered NDJSON at `~/.claude/rate-limits/history.ndjson` (override with `CLAUDE_RATE_LIMITS_HISTORY_PATH`): a line is appended only when `used_percentage` changes, and lines older than 7 days are pruned on each write. Concurrent-session duplicates collapse on read.

## Compile

`hooks.json` prefers a compiled binary at `bin/alert` and falls back to `bun` when it is absent. Run `bun scripts/rate-limits.ts install` (or the skill's install action) to compile it. The binary is gitignored and ephemeral: a plugin upgrade lands in a fresh root with no binary, and the dispatcher falls back to `bun` until the skill recompiles.

## Tuning

Sensitivity defaults live in `scripts/predict.ts` and are overridable via env:

- `CLAUDE_RATE_LIMITS_MARGIN_MS`: how far before reset a projected exhaustion must land to alert (also the re-alert threshold).
- `CLAUDE_RATE_LIMITS_MIN_SAMPLES`: minimum in-block samples before fitting.
- `CLAUDE_RATE_LIMITS_MIN_SPREAD_MS`: minimum time spread across samples before fitting.

## Testing

```bash
bun test plugins/rate-limits
```
