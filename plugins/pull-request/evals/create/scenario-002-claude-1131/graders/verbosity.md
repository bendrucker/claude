---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Fixes pipeline selection in gitlab:ci-monitor to eliminate false-green reports caused by external pipelines, parent pipelines, and unrelated MRs on the same branch. MR mode now queries the MR-specific endpoint; branch mode keeps the branch-ref query. Adds fail-closed job verification before emitting success, plus property-based and e2e tests against a stub glab. 3 files changed, +790/-67.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
