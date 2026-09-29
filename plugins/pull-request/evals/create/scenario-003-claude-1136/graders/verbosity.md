---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Adds a user-level herdr skill with a discovery-first design that avoids documenting commands, which would go stale within herdr's release cadence. Includes an orient.sh script for dynamic orientation. Verifies non-derivable behaviors against a running v0.7.5. 3 files changed, +198/-0.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
