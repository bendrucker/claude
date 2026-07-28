# session-limit

`UserPromptSubmit` hook that warns when the session is running out of usage budget, so work winds down before the block is exhausted instead of spilling into overage.

## How it works

Claude Code pipes rate-limit data to the statusline, which mirrors it to `~/.vibe-island/cache/rl.json`. On each prompt this hook reads that file and injects context when the usage percentage crosses a band:

| Window | Threshold | Guidance |
| --- | --- | --- |
| 5-hour | 90% | Favor efficient work, avoid large non-essential tasks |
| 5-hour | 95% | Finish in-flight work, batch tool calls |
| 5-hour | 100% | Stop after in-flight work. Schedule a wake-up if the reset is under an hour out, otherwise tell the user when to return |
| 7-day | 95% | Minimize spend until the weekly reset |

Each band fires once. The highest band announced per window is recorded in `/tmp/claude/<session-id>/session-limit.json`, keyed to that window's `resets_at`. A changed `resets_at` means the block rolled over, so the bands re-arm.

The hook is silent when `rl.json` is missing or lacks a `five_hour` percentage, which covers accounts and sessions with no rate-limit data.

## Configuration

- `CLAUDE_STATUSLINE_RATE_LIMITS_PATH`: source of rate-limit data (default `~/.vibe-island/cache/rl.json`)
- `CLAUDE_SESSION_LIMIT_MARKER_ROOT`: root for per-session marker files (default `/tmp/claude`)

Adding a band is one entry in `FIVE_HOUR_BANDS` or `SEVEN_DAY_BANDS`. The threshold and its message are paired in the same object, so a threshold cannot exist without a message.
