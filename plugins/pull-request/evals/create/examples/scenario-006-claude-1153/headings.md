---
fail: [heading-sentence-case, heading-question, heading-clause]
---
Title: job: focus a live session's herdr pane

The job skill previously handed over a claude --resume <sessionId> command for every item with a live session, requiring a manual copy, paste, and run.

## What changed and why

herdr agent list returns agent_session.value, which carries the Claude session UUID, giving an exact join to a claude agents record with no title guessing.

## Out of Scope (Deferred, Not Part of This PR)

Every branch is guarded on HERDR_PANE_ID, so the tmux work machine, where both multiplexers remain operational, keeps its existing resume path unchanged.
