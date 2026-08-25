# Show Me

Adapted from [dmmulroy/.dotfiles](https://github.com/dmmulroy/.dotfiles/blob/a6d5117/home/.agents/skills/show-me/SKILL.md) at [`a6d5117`](https://github.com/dmmulroy/.dotfiles/commit/a6d5117), path `home/.agents/skills/show-me/SKILL.md`. That repo carries no LICENSE, so what crosses over is the idea: a menu of visual formats, and the rule that the visual sits next to the text it supports. Every sentence here is written fresh.

The format order leads with the terminal-native forms, because that is where Ben reads the answer. Upstream puts Mermaid ahead of the diff variants and the whole-block form.

The four diff variants are the part of upstream worth the most. A diff only lands when its shape matches what the reader already holds, so each variant names the shape it diffs against: a component tree, a file tree, a call tree, or a state flow.

Upstream's last format writes a self-contained HTML file and opens it with `Bash(open …)`. Here that branch publishes an Artifact. The published page renders Mermaid natively, survives past the session, and has a URL Ben can hand to someone else.

Upstream annotates component trees with "module boundaries". This says seams, following [`../improve-codebase-architecture/LANGUAGE.md`](../improve-codebase-architecture/LANGUAGE.md).

## Removal

User-invoked. The description costs nothing per session and the body loads only on `/show-me`, which leaves disuse as the only removal signal. `plugins/claude-code/skills/session/resources/queries/skill-activity.sql` counts invocations per skill. Delete the skill if it has none by the 2026-11-01 check-in in [#1246](https://github.com/bendrucker/claude/issues/1246).

Invocations that produce the same one or two formats every time are a different result. That means the menu is larger than the habit, and the fix is cutting the unused formats rather than the skill.
