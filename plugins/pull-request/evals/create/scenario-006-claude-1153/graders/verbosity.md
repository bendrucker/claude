---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Replaces the job skill's copy-paste claude --resume command with herdr agent focus when running under herdr, using an exact session-UUID join from herdr agent list. All new behavior is guarded on HERDR_PANE_ID so the tmux path is untouched. Prose-only changes to SKILL.md. 3 files changed, +8/-4.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
