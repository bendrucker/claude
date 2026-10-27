# Sandbox

Teaches Claude to drop `dangerouslyDisableSandbox` when the command would escape the sandbox anyway through `sandbox.excludedCommands`. The call still runs. The reminder is attached to its result.

## Examples

With `git:*` and `agent-browser:*` excluded:

### Scaffolding Around an Excluded Command

The call: `cd /repo && git push -u origin HEAD 2>&1 | tail -5`, with the flag set. What comes back with its result:

```text
That call needed no `dangerouslyDisableSandbox`: every command in it matches `sandbox.excludedCommands` (`git:*`), so it runs outside the sandbox on its own.
Next time, leave the flag off, along with the pieces that keep the chain from matching:

    git push -u origin HEAD

- `cd /repo`: the command already runs in the session's directory.
- `2>&1`: the harness already captures stderr.
- `| tail -5`: the harness truncates long output itself.
```

### An Exported Session Variable

The call: `export AGENT_BROWSER_SESSION=docs; agent-browser open https://example.com`, with the flag set. What comes back with its result:

```text
That call needed no `dangerouslyDisableSandbox`: every command in it matches `sandbox.excludedCommands` (`agent-browser:*`), so it runs outside the sandbox on its own.
Next time, leave the flag off, along with the pieces that keep the chain from matching:

    agent-browser --session docs open https://example.com

- `export AGENT_BROWSER_SESSION=docs`: pass `--session docs` to `agent-browser` instead.
```

### A Bare Excluded Command

The call: `git status`, with the flag set. What comes back with its result:

```text
That call needed no `dangerouslyDisableSandbox`: every command in it matches `sandbox.excludedCommands` (`git:*`), so it runs outside the sandbox on its own.
It escapes as written. Next time, leave the flag off.
```

### No Reminder

`git status && bun test` doesn't get anything back, because `bun` doesn't match any entry. It also stays quiet for a `cd` elsewhere or in a subagent, any other variable, `$(...)`, another redirection, `||`, and `&`.

## Contents

- [`mod/register.ts`](mod/register.ts): a `tool.call` hook on Bash calls that set the flag while the sandbox is on. It unions `excludedCommands` across settings sources and fails open.
- [`mod/scaffold.ts`](mod/scaffold.ts): the parser that strips the scaffolding and writes the reminder.
- Events: `sandbox.bypass` per flagged call (`verdict` `remind` or `allow`, `scaffolds`, `reason`, `repeat`) through [`mod-events`](../mod-events/README.md).

## Tests

`bun scripts/mod-test.ts sandbox`

## Removal

The `sandbox-bypass-scaffold` query in `observability:session` reports `scaffolded_pct` and `repeat_pct`.

- **Retire the plugin** once `scaffolded_pct` stays under 10% for four weeks, or once Claude Code's own matching ignores these scaffolds.
- **Switch it to deny** if `repeat_pct` stays high.
