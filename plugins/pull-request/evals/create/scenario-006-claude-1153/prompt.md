Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Replaces the job skill's copy-paste claude --resume command with herdr agent focus when running under herdr, using an exact session-UUID join from herdr agent list. All new behavior is guarded on HERDR_PANE_ID so the tmux path is untouched. Prose-only changes to SKILL.md. 3 files changed, +8/-4.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The job skill previously handed over a claude --resume <sessionId> command for every item with a live session, requiring a manual copy, paste, and run.
- herdr agent list returns agent_session.value, which carries the Claude session UUID, giving an exact join to a claude agents record with no title guessing.
- Gather makes one extra inline call when HERDR_PANE_ID is set; a matched pane turns the brief's action line into herdr agent focus <pane_id>.
- Act can run the focus command directly after confirming, since focus moves the foreground off the job session; herdr agent attach stays out of allowed-tools and is instead named in the brief for a manual run because it takes over the terminal.
- Every branch is guarded on HERDR_PANE_ID, so the tmux work machine, where both multiplexers remain operational, keeps its existing resume path unchanged.
