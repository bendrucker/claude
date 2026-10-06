# Session Limit

Show rate-limit usage in the status line, and steer the model to wind down before a usage block runs out and spills into overage.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) reads the rate-limit windows on each `session.measure`, shows them in the status line (`5h 42% · 7d 13%`), and appends guidance to the conversation when a window crosses a band. Each band fires once per block and re-arms when the window resets. The guidance lands mid-turn, at the model's next step.

| Window | Threshold | Guidance |
| --- | --- | --- |
| 5-hour | 90% | Favor efficient work, avoid large non-essential tasks |
| 5-hour | 95% | Finish in-flight work, batch tool calls |
| 5-hour | 100% | Stop after in-flight work. Schedule a wake-up if the reset is under an hour out, otherwise tell the user when to return |
| 7-day | 95% | Minimize spend until the weekly reset |

Every append is logged through [`mod-events`](../mod-events/README.md) as an `inject` event carrying the bands crossed and the stored row's id, or the error when the append was refused.

## Setup

Function hooks are early access. Set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the environment or the `env` block of `~/.claude/settings.json`, then install the plugin:

```
/plugin install session-limit --marketplace bendrucker/claude
```

Off a subscription the session's rate-limit list is empty. The mod stays idle there.

## Tests

`bun scripts/mod-test.ts session-limit`
