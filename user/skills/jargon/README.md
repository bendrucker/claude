# Jargon

Adapted from [dmmulroy/skills](https://github.com/dmmulroy/skills/blob/8603380/bro/SKILL.md), `bro/SKILL.md`, [`8603380`](https://github.com/dmmulroy/skills/commit/8603380), MIT. Upstream names it `bro`.

[#1246](https://github.com/bendrucker/claude/issues/1246) rules this snapshot repo out as a source everywhere else. It is the source here because both copies of the skill are byte-identical and only the snapshot carries a license.

## Removal

`plugins/claude-code/skills/session/resources/queries/skill-activity.sql` attributes assistant turns to the active skill. No turns by the 2026-11-01 check-in in [#1246](https://github.com/bendrucker/claude/issues/1246) means delete the skill. Repeated invocations mean the default register is wrong, and the fix belongs in the always-on writing rules.
