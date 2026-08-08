# `sandbox-discipline`

`PreToolUse` hook on `Bash` that enforces two sandbox rules the prose in [`CLAUDE.md`](../../CLAUDE.md) and [`settings.md`](../../../.claude/rules/settings.md) states but nothing checks: bypass the sandbox only after a sandboxed run failed, and keep an exempt verb at the top level of a command.

## Why

The instruction "only bypass after a sandboxed run of that command actually failed" was ignored at scale. Over eleven days the session index recorded 877 Bash calls with `dangerouslyDisableSandbox: true`, of which 8 followed an actual failure. The bypass is reflex, not evidence, and a written rule has already had its chance.

That failure is also why the enforcement is a hook rather than an `autoMode` rule. The classifier weighs prose against context, which is the same shape as the CLAUDE.md line that did not bind. A deterministic check is the escalation, and it is the only tier that can read `dangerouslyDisableSandbox` off the tool input rather than infer intent from the command.

The second rule fails silently rather than by choice. `excludedCommands` matches only a command's top-level token, so `cd <dir> && git push` runs `git` sandboxed even though `git` is exempt. The same eleven days recorded 167 of these forfeits, with `git` the most common verb at 31. Nobody decides to give up the exemption. The shell shape takes it.

## Behavior

#### Bypass gate

When `tool_input.dangerouslyDisableSandbox` is `true`, the bypass has to be earned. Three things earn it:

- The command runs a script carrying the `mac` plugin's `claude:dangerouslyDisableSandbox` marker comment, which is a deliberate, reviewed opt-out. The marker check does not re-validate that plugin's injection: `PreToolUse` hooks run in parallel off the same original input, so a flag the plugin adds is never visible here. It covers the case where the model sets the flag itself on a script the repo has already sanctioned, which is most of the session-index writers.
- The session transcript shows a recent sandboxed Bash call that ran a verb this command also runs and came back with a sandbox-attributable error.
- The command is a browser sign-in handoff (`gh auth login`, `glab auth login`). Launch Services handoff does not survive the container whatever the profile allows, so these can never produce the failure the gate would otherwise ask for, and [`plugins/gitlab/hooks/auth.ts`](../../../plugins/gitlab/hooks/auth.ts) tells the model to run one with the bypass.

Anything else is denied, with a reason naming the verb and the rule. The denial is not a dead end: run the command sandboxed, and if the sandbox refuses it, the retry with the bypass now has its evidence and passes.

Commands are compared by *verb*, not by text. Both sides are split on shell operators, stripped of `cd`, `export`, and env-assignment preamble, and reduced to basenames, so `cd /repo && bun x.ts` and `FOO=1 /opt/bun/bin/bun x.ts` both count as `bun`. Sharing one verb is enough, which is deliberately loose: requiring evidence for every verb would deny `mkdir -p out && bun write.ts` after only `bun` had failed. The gate produces a habit, and any model that wants the bypass can earn it by running the command sandboxed first. Treat it as a prompt toward that habit, and rely on the sandbox profile itself for anything a containment boundary has to guarantee.

A prior run that was itself bypassed proves nothing about what the sandbox refuses and is skipped. Whether that run *failed* is judged from its output text, not from `is_error`: a sandbox refusal often lands on stdout with exit 0, as `mktemp: ... Operation not permitted` does, so the structured flag misses the case this gate is for. The [session index](../../../plugins/claude-code/skills/session)'s `sandbox_bypasses` view keys on `is_error` and an exact command match instead, which makes it the stricter offline measure of the same idea.

Recency is bounded twice, and only by position: the last 256 KB of transcript, and the last 40 sandboxed Bash results within it. There is no clock. A wall-clock window would deny the legitimate case where a failure is followed by twenty minutes of reading before the retry, and the positional bounds already exclude anything that is not the current stretch of work.

The gate reaches `Bash` only. The `mac` plugin treats `Monitor` as equivalent because it also runs a shell command, so a bypass routed through `Monitor` is not gated. Widen the matcher if the session index ever shows `Monitor` bypasses; today the measured problem is entirely `Bash`.

#### `cd`-prefix rewrite

When the bypass is not in play, a command shaped `cd <dir> && git <rest>` is rewritten through `hookSpecificOutput.updatedInput` to `git -C <dir> <rest>`, which is exactly equivalent and puts `git` back at the top level where `excludedCommands` can see it.

The rewrite fires only when it is exact: one `cd`, one `git`, nothing after, no pipe, no redirect, no `;`, no command substitution, and a directory that cannot be read as a flag. Everything else passes through untouched, including `cd /repo && git add . && git commit -m x`. A wrong rewrite would run a command the model did not write, so ambiguity resolves to leaving it alone.

## Registration

One `PreToolUse` entry in [`user/settings.json`](../../settings.json) with a plain `Bash` matcher and no `if` condition. Everything the hook decides, it decides from the payload it is handed. A matcher condition would be a second place to keep in sync, and it cannot see `dangerouslyDisableSandbox` anyway.

The gate and the rewrite share that one entry, and one process, because both need the same parse of the same command on the same event. They stay separable in the code: the gate is [`transcript.ts`](transcript.ts) plus [`marker.ts`](marker.ts), the rewrite is `rewriteCdGit` in [`command.ts`](command.ts), and neither reads the other. They have independent removal criteria below.

## Removal

Both halves are measurable through `sandbox_bypasses` in the session index.

Retire the gate when denials go near zero for a month, which means the reflex is gone and the hook is idle, or when false positives outnumber true ones, which means it is blocking real work. Run the skill's `sandbox` named query with `after_date` set 30 days back.

Read `is_retry` in that output as the signal. A bypass that follows a real failure is one the hook allowed correctly. A stretch with few bypasses and most of them retries says the rule is internalized and the enforcement is redundant. Repeated denials of the same verb that then had to be worked around by hand say the sandbox-attributable pattern list is too narrow, and that is a tuning fix before it is a removal.

Retire the rewrite when `cd <dir> && git` stops appearing in the `sandbox-bypass-effective-command` query, or when Claude Code starts matching `excludedCommands` against a command's effective verb instead of its first token, which would make the rewrite pointless.

## Testing

```sh
bun test ./user/hooks/sandbox-discipline
```
