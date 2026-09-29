---
fail: []
---
Title: user,review: treat a skill's fan-out as requested

Claude Code 2.1.220's system prompt carries two lines: "Do not call the AgentTool unless the user requested it" and "Do not use workflows or deep-research unless the user requested it." Neither lives in a config file. `grep -a` against the installed binary finds both compiled directly into it, absent from every settings file, hook, and rule in this repo. Nothing here can disable them.

That gate recently beat a skill's own dispatch instruction. `/ship`'s reviewer pass ran inline instead of fanning out, even though the skill it invoked said to fan out. Since the lines can't be edited, the fix has to work with the gate rather than override it.

The resolution: invoking a skill that instructs a fan-out or a background dispatch is itself the user's request for `Agent`. `user/CLAUDE.md` states that once, globally, so `ship`, `writing:review`, `pull-request:create`, and `review:follow-up` all pick it up without a skill-local edit.

`plugins/review/skills/code/SKILL.md` gets a change on top of that, because it held the actual trapdoor. Its "No `Agent` tool" cell described "every fan-out cell degrades to a single inline pass." That language was broad enough to double as an excuse for a model already inclined to skip the fan-out. That cell now degrades only when `Agent` is genuinely missing from the tool set. The reinforcement sentence itself sits under the "Fan-out cells" heading rather than the degrade cell, so a model resolving to a real fan-out cell reads it before deciding what to run, while a model landing on the degrade cell reads the narrower trigger instead.

Removal criteria: a release that stops shipping the gate, or `review:code` summaries that stop declaring single-pass runs while `Agent` was available. The skill already requires stating when a review went inline. That's the signal this stopped working.
