Use the pull-request:create skill to open a pull request for the change on this branch.

Repository: bendrucker/claude (personal audience)

This checkout holds the branch and its commit but not the changed files, so take the change from this summary:

Adds one Workflow bullet to user/CLAUDE.md stating that invoking a skill which instructs a subagent fan-out or background dispatch already carries the user's authorization for Agent, and narrows plugins/review/skills/code/SKILL.md's degrade cell so it only falls back to a single inline pass when Agent is genuinely absent from the tool set, placing the reinforcement sentence under the Fan-out cells heading instead. 2 files changed, +3/-2.

Notes from the session that produced the change. Decisions taken, evidence gathered, alternatives rejected, work deferred. Use what serves a reviewer.

- The user reported that /ship's reviewer pass ran inline instead of fanning out to subagents, even though the ship skill's own instruction said to fan out.
- Traced the cause with grep -a against the installed 2.1.220 CLI binary: two lines, "Do not call the AgentTool unless the user requested it" and "Do not use workflows or deep-research unless the user requested it," are compiled directly into the binary and absent from settings.json, .claude.json, user/, and every hook in the repo, so nothing in this repo can disable them.
- Resolution works with the native gate rather than against it: a skill instructing a fan-out is itself the user's request for Agent, stated once globally in user/CLAUDE.md so ship, writing:review, pull-request:create, and review:follow-up all pick it up without a per-skill edit.
- plugins/review/skills/code/SKILL.md held the actual trapdoor: its "No Agent tool" cell described every fan-out cell as degrading to a single inline pass, language broad enough to double as an excuse for a model already inclined to skip the fan-out; narrowed so it degrades only when Agent is genuinely missing from the tool set.
- A two-lens writing review (content and style) on the first draft flagged the CLAUDE.md bullet's "on my behalf" phrasing as ambiguous: the file's established convention is that first person always means the user, so a model could misread "my" as itself, inverting the intended meaning; reworded to "already carries the user's authorization for Agent."
- The same review found the SKILL.md reinforcement sentence was misplaced under the "No Agent tool" heading, which a model on a real fan-out cell never reads because it resolves at "Fan-out cells" first; moved the sentence to sit under "Fan-out cells" instead.
- Removal criteria: a release that stops shipping the compiled-in gate, or review:code summaries that stop declaring single-pass runs while Agent was actually available, since the skill already requires stating when a review went inline.
- A prose-quality hook flagged the first PR body draft for low sentence-length variation (CV=0.41 over 13 sentences); the refreshed body was rewritten to vary rhythm, mixing short fragments with longer explanatory sentences.
