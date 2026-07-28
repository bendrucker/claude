# `session-limit`

`UserPromptSubmit` hook that warns when the session is running out of usage budget, so work winds down before the block is exhausted instead of spilling into overage.

## How It Works

Claude Code pipes rate-limit data to the statusline, which mirrors it to the path in `CLAUDE_STATUSLINE_RATE_LIMITS_PATH` (set in `user/settings.json`). On each prompt this hook reads that file back and injects context when the usage percentage crosses a band:

| Window | Threshold | Guidance |
| --- | --- | --- |
| 5-hour | 90% | Favor efficient work, avoid large non-essential tasks |
| 5-hour | 95% | Finish in-flight work, batch tool calls |
| 5-hour | 100% | Stop after in-flight work. Schedule a wake-up if the reset is under an hour out, otherwise tell the user when to return |
| 7-day | 95% | Minimize spend until the weekly reset |

Each band fires once. The highest band announced per window is recorded in `/tmp/claude/<session-id>/session-limit.json`, keyed to that window's `resets_at`. A changed `resets_at` means the block rolled over, so the bands re-arm.

The hook is silent when the file is unconfigured or missing, or when it lacks a `five_hour` percentage, which covers accounts and sessions with no rate-limit data.

## Writing the File

[My status line script](../../scripts/statusline.ts) handles this alongside actual rendering. A simplified shell version:

```sh
#!/bin/sh
input=$(cat)

limits=$(printf '%s' "$input" | jq -c '.rate_limits // empty')
if [ -n "$limits" ]; then
  mkdir -p "$(dirname "$CLAUDE_STATUSLINE_RATE_LIMITS_PATH")"
  printf '%s\n' "$limits" > "$CLAUDE_STATUSLINE_RATE_LIMITS_PATH"
fi

printf '%s' "$input" | jq -r '.model.display_name'
```

## Configuration

- `CLAUDE_STATUSLINE_RATE_LIMITS_PATH`: where the statusline writes rate-limit data, and where this hook reads it. No default. Unset disables both.
- `CLAUDE_SESSION_LIMIT_MARKER_ROOT`: root for per-session marker files (default `/tmp/claude`)

Adding a band is one entry in `FIVE_HOUR_BANDS` or `SEVEN_DAY_BANDS`. The threshold and its message are paired in the same object, so a threshold cannot exist without a message.
