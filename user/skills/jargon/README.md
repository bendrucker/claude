# Jargon

Adapted from [dmmulroy/skills](https://github.com/dmmulroy/skills/blob/8603380/bro/SKILL.md) at [`8603380`](https://github.com/dmmulroy/skills/commit/8603380), path `bro/SKILL.md`, MIT. That repo is a stale snapshot of the live set in `dmmulroy/.dotfiles`. [#1246](https://github.com/bendrucker/claude/issues/1246) rules the snapshot out as a source everywhere else, and this skill is the exception: both copies of the skill are byte-identical, and only the snapshot repo carries a license.

Upstream calls it `bro` and asks for one thing: say it again without jargon. The rename to `jargon` makes the slash command name what it removes.

Upstream's single instruction leaves the model free to satisfy "simpler and more concise" by dropping content, since a shorter message with fewer claims reads as a successful restatement. The rules here say what plain language converts (terms, acronyms, metaphors, unnamed actors) and what it holds fixed (every claim, plus filenames, commands, numbers, and error text).

Restating applies to the invoked turn. A plain-language mode that persists belongs in settings or `CLAUDE.md`.

## Removal

User-invoked. It costs nothing until Ben types `/jargon`. Delete it if `plugins/claude-code/skills/session/resources/queries/skill-activity.sql` shows no turns attributed to it by the 2026-11-01 check-in in [#1246](https://github.com/bendrucker/claude/issues/1246).

Repeated invocations are their own signal. They mean the register is wrong by default, and the fix belongs in the writing rules that run on every turn rather than in a skill that repairs one message after the fact.
