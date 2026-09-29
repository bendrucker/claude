---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Removes a machine-specific default path (~/.vibe-island/cache/rl.json) from the session-limit hook so it matches the statusline writer's contract, requiring CLAUDE_STATUSLINE_RATE_LIMITS_PATH to be set explicitly. Adds a test for the unset case and fixes a README heading. 3 files changed, +37/-8.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
