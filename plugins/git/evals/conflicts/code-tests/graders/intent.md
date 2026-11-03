---
type: llm
focus: { source: file, path: plugins/herdr/skills/herdr/scripts/dispatch.ts }
---
The file keeps both behaviors: main's recovery when a new pane is busy or the first submission is not confirmed (a pause, a nudge, and a `retry` recorded on the result), and the branch's retry of a worktree config write while another process holds the config lock, with a lock that outlasts the timeout or a denied write recorded as `trackingError` and the agent still started. Restructured code passes when both behaviors remain. Fail if either is dropped or stubbed out.
