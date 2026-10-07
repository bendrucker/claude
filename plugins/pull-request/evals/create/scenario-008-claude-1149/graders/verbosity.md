---
type: llm
---
Judge only the PR body, the text after the `Title:` line. Ignore any commentary before that line, such as a note that the push or create command failed. Pass when every paragraph gives the reviewer information beyond the title and the diff stat, and the body's length fits the size and difficulty of this change:

Adds one Workflow bullet to user/CLAUDE.md stating that invoking a skill which instructs a subagent fan-out or background dispatch already carries the user's authorization for Agent, and narrows plugins/review/skills/code/SKILL.md's degrade cell so it only falls back to a single inline pass when Agent is genuinely absent from the tool set, placing the reinforcement sentence under the Fan-out cells heading instead. 2 files changed, +3/-2.

Fail when the body restates the diff, repeats a point it already made, or pads sentences with filler qualifiers. A one-line body passes only when the change leaves nothing else worth saying.
