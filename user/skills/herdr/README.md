# Herdr

Original prose. The CLI ships its own skill at `herdr --skill`, which this one replaces because most of what that file covers is restated `--help` output.

Two agent-lifecycle behaviors came from dmmulroy's live copy at [`home/.agents/skills/herdr/SKILL.md`](https://github.com/dmmulroy/.dotfiles/blob/a6d5117/home/.agents/skills/herdr/SKILL.md), sha [`a6d5117`](https://github.com/dmmulroy/.dotfiles/commit/a6d5117). One is `agent_not_ready`, returned when a startup lands in a permission dialog. The other is `agent_blocked`, which refuses `agent prompt` before any input is sent. Neither appears in `--help`, and dmmulroy wrote herdr, so his file documents behavior nothing else carries. That repo has no LICENSE. The prose here is original, and herdr 0.8.2 reconfirmed both behaviors before they were written down.

## Cache Discipline

The file states once, near the top, that `herdr <group> <command> --help` enumerates every enum flag and every default. Everything downstream is meant to be what a `--help` lookup cannot supply: which commands break `jq`, why `pane read` misses an alternate-screen agent, how `pane run` gets re-parsed by the target shell, and the two placements the plugin binary accepts without printing.

That rule has teeth. It took out a `--placement` compatibility matrix and a `pane wait-output` flag summary that restated `--help` word for word. Re-adding any flag table needs a reason the pointer above it does not already cover.

## Removal

The skill is model-invocable and spends its description on every session. The herdr-specific vocabulary (pane, tab, workspace, split) is what earns that. If the session index shows loads arriving only through `/herdr`, the natural-language triggers are inert, and the description should shrink to the argument-hint verbs.
