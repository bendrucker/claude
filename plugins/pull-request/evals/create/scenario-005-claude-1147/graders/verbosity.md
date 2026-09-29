---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Adds /github:copilot, a cross-model review skill that runs the Copilot CLI against the diff to catch blind spots a same-model re-review shares. Uses disable-model-invocation for a fixed-budget design: one call by default, capped at three, diff-scoped with 120KB soft / 400KB hard size caps. Testing against the skill's own diff surfaced and fixed four input-validation defects. 4 files changed, +559/-0.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
