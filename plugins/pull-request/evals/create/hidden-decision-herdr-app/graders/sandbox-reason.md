---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line. Pass when the body explains why the sandbox grants `~/.local/state/herdr-core`: on macOS `XDG_RUNTIME_DIR` is unset, so `hc` puts its socket there. Fail when the grant appears without that reason or not at all.
