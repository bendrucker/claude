# Herdr

Drive the [herdr](https://herdr.dev) terminal workspace manager from a session running inside it.

## Contents

- **Skill**: [`herdr`](skills/herdr) drives workspaces, tabs, and panes, and hands whole tasks to coding agents running in other panes
- **Mod**: [`register.ts`](mod/register.ts) publishes the session's subagents, teammates, and branch as metadata tokens on its herdr pane

## Mod Setup

The mod loads only when function hooks are enabled with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, and acts only in an interactive session inside a herdr pane (`HERDR_ENV=1`). Elsewhere it does nothing. herdr's own integration (`herdr integration install`) keeps reporting the agent's identity and lifecycle. The mod adds what herdr cannot see from outside the session, as tokens from source `bendrucker:herdr`:

| Token | Value |
| --- | --- |
| `subagents` | `↳` and the count of live subagents |
| `teammates` | `⇄` and the count of live teammates |
| `agents_waiting` | `?` and the count held on background work or a plan approval |
| `agents_idle` | `·` and the count of teammates between turns |
| `branch` | the session directory's current git branch |

A token is cleared while its count is zero and when the session exits. herdr shows a custom token only where `config.toml` names it in a sidebar row:

```toml
[ui.sidebar.agents.rows_by_agent]
claude = [
  ["state_icon", "agent", "$subagents", "$teammates", { token = "$agents_waiting", fg = "#e0405a" }, { token = "$agents_idle", dim = true }],
  [{ token = "$branch", dim = true }],
]
```

## Tests

`bun test plugins/herdr` runs the skill's bun tests, and `bun scripts/mod-test.ts herdr` runs the mod's.
