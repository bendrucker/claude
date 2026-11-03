---
type: llm
focus: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.test.ts }
---
The tests keep main's submodule cases (initializing submodules in a new worktree, and recording a failed init while still starting the agent) and the branch's cases for recovering an unconfirmed submission, with every scripted command sequence matching what dispatch now runs. Fail if a test from either side is deleted, skipped, or loosened to stop checking the calls.
