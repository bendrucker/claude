# Atuin Source

Atuin records every shell command in `~/.local/share/atuin/history.db`.

```bash
"${CLAUDE_SKILL_DIR}/scripts/collect.sh" atuin <day> <days>
```

It scans the history read-only, skips imported rows (`exit = -1`), and runs each file in [`queries/atuin/`](../queries/atuin/). The target is the command head (first two words), never the arguments.

- `slow`: heads whose median run is over 30 s. Interactive sessions (`ssh`, `claude`, `herdr`, editors, pagers, `tail -f`) run until you leave them, so their duration is not a wait. Skip them.
- `failing`: heads that fail at least a third of 5+ runs a day. A command that fails on purpose (`grep` with no match, `test`, `diff`) or that you interrupted (exit 130) is not friction. Ground each one before recording it.
