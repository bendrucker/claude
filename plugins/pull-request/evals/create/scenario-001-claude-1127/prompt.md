Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Removes a machine-specific default path (~/.vibe-island/cache/rl.json) from the session-limit hook so it matches the statusline writer's contract, requiring CLAUDE_STATUSLINE_RATE_LIMITS_PATH to be set explicitly. Adds a test for the unset case and fixes a README heading. 3 files changed, +37/-8.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The hardcoded machine-specific path exposed a private setup in both the README and the source.
- The fix matches the statusline writer's contract: the hook reads only from the env var, so unset means nothing is being written and the hook stays silent.
- Behavior is unchanged in practice because user/settings.json already sets CLAUDE_STATUSLINE_RATE_LIMITS_PATH.
- End-to-end verification confirmed the shell writer's output drives the hook to inject a band message, and a render carrying no rate_limits leaves the file intact.
- Added test coverage for the unset-variable case to ensure graceful degradation.
