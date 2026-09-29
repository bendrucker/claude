---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when the body carries what a reviewer needs from the session notes below: the load-bearing decisions with the evidence behind them, rejected alternatives a reviewer would otherwise re-propose, and deferred work. Leaving out a note that would not change a reviewer's reading is correct pruning. Fail when a needed decision is missing, or appears without the evidence that supports it.

- The job skill previously handed over a claude --resume <sessionId> command for every item with a live session, requiring a manual copy, paste, and run.
- herdr agent list returns agent_session.value, which carries the Claude session UUID, giving an exact join to a claude agents record with no title guessing.
- Gather makes one extra inline call when HERDR_PANE_ID is set; a matched pane turns the brief's action line into herdr agent focus <pane_id>.
- Act can run the focus command directly after confirming, since focus moves the foreground off the job session; herdr agent attach stays out of allowed-tools and is instead named in the brief for a manual run because it takes over the terminal.
- Every branch is guarded on HERDR_PANE_ID, so the tmux work machine, where both multiplexers remain operational, keeps its existing resume path unchanged.
