# Local Review CLI

Mechanics for running a hosted reviewer's CLI in [Local Mode](SKILL.md#local-mode-pre-push): when a local review justifies its metered credit, how to detect the provider, and how to drive its CLI.

## When the Diff Warrants a Review

Reviews are metered, and a diff earns one review through one channel, local or hosted. Spend it when the diff touches risk areas (auth, permissions, sandbox config, secret handling, network egress), adds a new runtime entry point (a hook, script, server, or CLI command), or runs past roughly 100 changed lines or 4 files excluding tests, docs, and lockfiles. Prose, dependency bumps, and reverts never qualify. A config diff qualifies only through the risk areas above.

A `ship` skill with its own Bot Review Gate overrides these defaults. An explicit `--local` request overrides everything.

#### Recalibration

The 100 and 4 thresholds are on trial. When editing this file, recheck three counts since the last recheck (2026-09-06): PRs opened and those that drew a hosted review (`gh pr list --state all --json number,labels,createdAt` plus the bot's comments), local runs (`~/.greptile/reviews.json`), and hits on `free_reviews_limit_reached` in the session index. A limit hit restores 200 and 8 and returns the review label to explicit `--label`. Usage far under the roughly 68-a-month rate and the 128-a-month free tier argues for widening the gate.

## Provider Detection

SKILL.md injects `scripts/detect-bot.ts` output at load: each provider's repo config, CLI presence, and any live cooldown. Resolve it:

- `paused until <date> (<reason>)`: the provider is out of reviews until that date, in the CLI and the hosted loop. If it is the only provider, report the pause and stop.
- A repo config hit: that provider reviews this repo.
- No config: check the hosted signals ([When a Review Is Expected](reviewers.md#when-a-review-is-expected)), since repos often run a hosted reviewer with nothing committed. Recent commenters usually settle it, then required checks:
  - `gh api 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=100' --jq '[.[].user.login] | unique | map(select(test("greptile|coderabbit")))'`
  - `gh api 'repos/{owner}/{repo}/rules/branches/{default-branch}' --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'`
- A CLI on PATH with no config and no hosted signals is a global install. Run a bot only against a repo it reviews.
- Provider identified but CLI missing: offer to install it (per the provider section below).
- No signals anywhere: in the proactive paths (ship's pass, create's pre-push step) skip silently. On an explicit `--local` request, ask which bot reviews this repo's PRs.

## Running a Review

Both CLIs take minutes (CodeRabbit's docs say 7-30+). Launch with `run_in_background`, redirecting both streams to a file. The harness re-invokes you when the run exits.

Both print within a second or two: Greptile prints `▸ Dispatching review…`, CodeRabbit `--agent` starts streaming NDJSON. A run silent past 30 seconds is broken and would sit backgrounded with no exit to wake you, so follow the launch with this probe:

```
for i in $(seq 30); do [ -s <outfile> ] && break; sleep 1; done; head -5 <outfile>
```

An empty file at the end means dead. Kill the run, report what the file contains (usually an auth or network error), and stop, since a retry costs another metered review.

When a run reports a pause, record it and stop:

- Greptile `free_reviews_limit_reached`
- a CodeRabbit fair-usage or rate-limit message
- a hosted summary comment saying reviews are paused

Merge it into `~/.cache/claude/bot-review.json`, a JSON array of `{provider, remote, pausedUntil, reason}`, which `detect-bot.ts` reads. `pausedUntil` is the resume date from the message as `YYYY-MM-DD` (default: the first of next month), and `reason` is a short phrase like `free credits exhausted`. Omit `remote` for a quota or plan limit, which is charged to the account and stops reviews everywhere. Set `remote` to `git remote get-url origin` only for a pause specific to this repo, like a per-repo rate limit.

#### Removal Criterion

When the session index next shows a `free_reviews_limit_reached`, `~/.cache/claude/bot-review.json` should contain a matching record. If it doesn't, replace the cache with a script the skill calls, or drop it.

## Greptile

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it (`npm i -g greptile` or `brew install greptileai/tap/greptile`). Check auth with `greptile whoami`, and on failure suggest I run `greptile login` myself (it is interactive). Greptile reviews committed work only, so offer to commit a dirty tree first.

Run `greptile review --json` backgrounded, adding `-b <base>` only when a base was given. Without a base it reviews against the default branch. Fall back to `--agent` (plain text) if `--json` fails. `greptile review --resume` continues an interrupted run and `greptile review status` reports the latest. See `greptile review --help` for other flags.

The `--json` output carries `comments` (each with file, line, severity) plus `confidence` and `summary`. The bar is `confidence` at its maximum with no comments left, or a written reason in the report for each declined comment.

## CodeRabbit

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it from the [official CLI docs](https://docs.coderabbit.ai/cli) (the `coderabbitai/skills` plugin is the work-machine integration) rather than a hardcoded `curl | sh`. Check auth with `coderabbit auth status`, and on failure suggest I run `coderabbit auth login` myself (it is interactive). `coderabbit doctor` verifies review readiness.

Run `coderabbit review --agent --light` backgrounded, adding `--base <base>` only when a base was given. `--light` trades depth for turnaround. Without a base it resolves a default and errors asking for `--base` when it can't. Fall back to `--plain` if the `--agent` output can't be parsed. `coderabbit review findings` re-prints the last local review without re-running. See `coderabbit review --help` for other flags.

`--agent` emits NDJSON events. Parse the `finding` events (`severity` = `critical`|`warning`|`info`, `fileName`, `codegenInstructions`) and the terminal `complete` event (`findings` count, `reviewedFiles`). The bar is a `complete` event with no critical or warning findings, or a written reason in the report for each declined one. Info-level findings don't hold the bar.
