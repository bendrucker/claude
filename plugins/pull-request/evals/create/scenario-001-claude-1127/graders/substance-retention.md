---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body carries what a reviewer needs from the session notes below: the load-bearing decisions with the evidence behind them, rejected alternatives a reviewer would otherwise re-propose, and deferred work. Leaving out a note that would not change a reviewer's reading is correct pruning. Fail when a needed decision is missing, or appears without the evidence that supports it.

- The hardcoded machine-specific path exposed a private setup in both the README and the source.
- The fix matches the statusline writer's contract: the hook reads only from the env var, so unset means nothing is being written and the hook stays silent.
- Behavior is unchanged in practice because user/settings.json already sets CLAUDE_STATUSLINE_RATE_LIMITS_PATH.
- End-to-end verification confirmed the shell writer's output drives the hook to inject a band message, and a render carrying no rate_limits leaves the file intact.
- Added test coverage for the unset-variable case to ensure graceful degradation.
