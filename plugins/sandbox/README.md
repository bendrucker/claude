# Sandbox

Refuses a `dangerouslyDisableSandbox` Bash call whose commands already escape the sandbox through `sandbox.excludedCommands`, and names the form that escapes without the flag.

## Contents

- **Mod**: [`hooks/hooks.json`](hooks/hooks.json) loads [`register.ts`](mod/register.ts), which gates `Bash` calls that set the flag while the sandbox is on. It reads `excludedCommands` from every settings source and unions them, the way the engine merges the list.
  - [`scaffold.ts`](mod/scaffold.ts) splits the command and drops the scaffolding that keeps a chain from matching: a `cd` to the session directory in the main loop (a subagent's shell may start in its own worktree), `export AGENT_BROWSER_SESSION=<name>` or the inline form (rewritten to `agent-browser --session <name>`), `2>&1`, and a trailing pipe into `tail`, `head`, `grep`, `wc`, `sort`, `uniq`, `cut`, or `jq`. When every remaining command matches an entry, the call is denied with the rewritten command. Anything else runs as asked: a `cd` elsewhere, any other variable, `$(...)`, other redirections, `||`, a background job, or a command that matches none of the entries.
- **Events**: `session.start`, `bypass` (one per flagged call, `verdict` `deny` or `allow`, with the scaffolds dropped or the reason it was let through), and `error` go to [`mod-events`](../mod-events/README.md). The mod fails open, so a hook failure lets the bypass run.

## Tests

`bun scripts/mod-test.ts sandbox` runs the mod's tests.

## Removal

The `sandbox-bypass-scaffold` query in `observability:session` reports the weekly share of flagged calls the mod denied. Retire the plugin once that share stays under 10% for four consecutive weeks, or when Claude Code's own `excludedCommands` matching ignores these scaffolds.
