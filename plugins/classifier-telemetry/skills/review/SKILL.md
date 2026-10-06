---
name: classifier-telemetry:review
description: Weekly review of auto-mode permission asks. Ranks the top ask reasons from the classifier-telemetry records and proposes allow rules or command-style changes as a pull request against `user/settings.json`.
argument-hint: "[--since <date>]"
disable-model-invocation: true
---

# Review

Turn a week of permission asks into settings changes that stop the asks worth stopping. Each proposal either removes a class of asks or names why that class should keep reaching the decider. The output is one pull request, or a report saying why nothing qualified.

## Arguments

- `--since <date>`: the window's start, passed as `after_date`. Default: seven days before today.

## Gather

Load `claude-code:session` and run its refresh, which prints the index path. Run both queries read-only with `after_date` set:

```bash
duckdb -readonly -json <db> -c "SET VARIABLE after_date = DATE '<date>'" -c ".read ${CLAUDE_SKILL_DIR}/assets/share.sql"
duckdb -readonly -json <db> -c "SET VARIABLE after_date = DATE '<date>'" -c ".read ${CLAUDE_SKILL_DIR}/assets/asks.sql"
```

- `share.sql`: per tool, the calls and the share the engine sent to the decider.
- `asks.sql`: the ranked asks by tool, normalized reason, and Bash verb, with up to three sample commands. `compound` marks a Bash command that chains, pipes, substitutes, or runs a heredoc.

Run the session skill's `classifier` named query too, and keep its `dropped-allow-rule` rows: the allow rules auto mode ignores.

## Classify

Assign every row of `asks.sql` exactly one outcome:

- **Allow rule**: a non-compound command or a tool whose calls are safe to run unreviewed. Check `permissions.allow` in `user/settings.json` first. A rule already listed there that still asks is a matching problem, so read the samples for the reason.
- **autoMode entry**: a class the classifier should allow by description rather than by prefix, or a rule auto mode drops (a `dropped-allow-rule` row). Write it in the `**Key**: value` form under `autoMode.allow`, beside the literal `"$defaults"`.
- **Command style**: a compound row whose parts would each pass alone. The fix is how commands get written (one command per call, no `cd <dir> &&` prefix, a script file in place of a heredoc). Propose it as a line in `user/CLAUDE.md` or the rule file that governs it.
- **Keep**: the ask is the decider doing its job (writes outside the workspace, network egress, destructive git). Name the reason in one clause.

## Propose

Create a worktree with `worktrunk:wt-switch-create` on a branch named `classifier-review-<yyyy-mm-dd>`. Edit `user/settings.json` and any style file. Record each new allow or autoMode entry in `docs/settings.md` with the asks it targets and what would retire it.

Test the edited settings with `claude --settings "$PWD/user/settings.json" auto-mode critique`, and drop an entry it flags as overbroad.

Open the PR with `pull-request:create`, ready for review, and add the `classifier-review` label, creating it if missing. The body leads with a table: each proposal, the rows and ask counts it covers, and its outcome. A count of merged PRs with that label is the mod's evidence of value, so never merge one yourself.

The review is done when every `asks.sql` row has an outcome and the PR is open, or when the report names why no row earned a change.

## Gotchas

- The generic reason "haven't granted it yet" names no cause. Read the samples to tell an unlisted verb from a compound command.
- A prefix allow rule never matches a compound command, so a compound row needs a command-style change.
- Auto mode drops broad interpreter rules such as `Bash(bun:*)`, so check `dropped-allow-rule` before proposing a rule.
- The records carry no permission mode. Asks from sessions outside auto mode reach the dialog, not the classifier, and still count here.
- `duration_ms` spans the decider and the tool together. Read the classifier's own latency from the `classifier` query's `classifier-request` rows.
