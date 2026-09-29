---
fail: []
---
Title: session-limit: drop the hardcoded rate-limits path

Follow-up to #1126. The hook fell back to a machine-specific path (`~/.vibe-island/cache/rl.json`) when `CLAUDE_STATUSLINE_RATE_LIMITS_PATH` was unset, which put a private setup in the source and the README.

The statusline that writes the file has no such default, so the reader now matches it: unset means nothing is being written, and the hook stays silent. `user/settings.json` already sets the variable, so behavior here is unchanged.

The README documents a shell statusline that writes the file, so the hook reads as depending on the contract rather than on one statusline implementation. Verified end-to-end: the shell writer's output drives the hook to inject a band message, and a render carrying no `rate_limits` leaves the file intact.
