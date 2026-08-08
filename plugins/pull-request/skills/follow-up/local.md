# Local Review CLI

Mechanics for running a hosted reviewer's CLI locally in [Local Mode](SKILL.md#local-mode-pre-push). Triage criteria and the [acceptance bar](SKILL.md#acceptance-bar) live in SKILL.md; per-reviewer scores live in [reviewers.md](reviewers.md). This file is the channel: when a local review is worth its credit, how to detect the provider, and how to drive its CLI.

## When the Diff Warrants a Review

Reviews are metered, and a local pass plus a hosted one costs two credits for one change. A diff earns one review through one channel. Spend it when the diff carries risk (auth, permissions, sandbox config, secret handling, network egress), adds a runtime surface, or runs past roughly 200 changed lines or 8 files excluding tests, docs, and lockfiles. Prose, dependency bumps, and reverts never qualify, and a config diff qualifies only through the risk surfaces just named.

A `ship` skill with its own Bot Review Gate overrides these defaults, and tuning belongs there first. An explicit `--local` request overrides everything.

## Provider Detection

SKILL.md injects the fast path at load: `scripts/detect-bot.ts` reports each provider's repo config, CLI presence, and any live cooldown without spending a turn. Resolve its verdict:

- `paused until <date> (<reason>)` on a provider line means it is out of reviews until that date. Treat it as unavailable, in the CLI and in the hosted waiting loop ([reviewers.md](reviewers.md)). If it is the only provider, report the pause and stop.
- A repo config hit is definitive: that provider reviews this repo.
- No config does not mean no bot. Repos often run a hosted reviewer with nothing committed, so check the hosted signals (the same ones behind "When a Review Is Expected" in [reviewers.md](reviewers.md)). One call usually settles it, recent commenters first:
  - `gh api 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=100' --jq '[.[].user.login] | unique | map(select(test("greptile|coderabbit")))'`
  - Falling back to required checks: `gh api 'repos/{owner}/{repo}/rules/branches/{default-branch}' --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'`
- A CLI on PATH with no config and no hosted signals is just a global install. Don't run a bot against a repo it doesn't review.
- Provider identified but CLI missing → offer to install it (per the provider section below).
- No signals anywhere → no bot reviews this repo. In the proactive paths (ship's pass, create's pre-push step) skip silently. On an explicit `--local` request, ask which bot reviews this repo's PRs.

## Running a Review

Both CLIs take minutes, and CodeRabbit's own docs say 7-30+. Launch the review with `run_in_background`, redirecting both streams to a file. The harness re-invokes you when the run exits.

Both print within a second or two of starting: Greptile prints `▸ Dispatching review…`, CodeRabbit `--agent` starts streaming NDJSON events. Silence past 30 seconds means the CLI is broken rather than slow, and a broken run would otherwise sit backgrounded until the harness wakes you at exit that never comes. So follow the launch with a bounded liveness probe, which returns the moment output appears:

```
for i in $(seq 30); do [ -s <outfile> ] && break; sleep 1; done; head -5 <outfile>
```

An empty file at the end means dead. Kill the run, report what the file holds (usually an auth or network error), and stop. A retry costs another metered review.

Record a pause to the availability cache and stop when a run reports one:

- Greptile `free_reviews_limit_reached`
- a CodeRabbit fair-usage or rate-limit message
- a hosted summary comment saying reviews are paused

Merge it into `~/.cache/claude/bot-review.json`, a JSON array of `{provider, remote, pausedUntil, reason}`. `pausedUntil` is the resume date the message gives as `YYYY-MM-DD` (fall back to the first of next month), and `reason` is a short phrase like `free credits exhausted`. `detect-bot.ts` reads the file. The next session's fast path then reports the pause instead of re-probing.

`remote` scopes the record, and the message says which scope fits. A quota or plan limit is charged to the account and stops reviews everywhere. Omit `remote` and one record covers every repo. Reserve `git remote get-url origin` for a pause that names this repo, like a per-repo rate limit. Scope an account-wide pause to one repo and the next session in a sibling repo rediscovers it the expensive way.

**Removal criterion.** This step is model-instructed. The cache earns its parsing code and its load-time read only if the record actually gets written. The check: when the session index next shows a `free_reviews_limit_reached`, `~/.cache/claude/bot-review.json` should carry a matching record. A limit hit with no record means the instruction is inert. Replace the cache with a script the skill calls, or drop it.

## Greptile

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it (`npm i -g greptile` or `brew install greptileai/tap/greptile`). Check auth with `greptile whoami`. On failure, offer `greptile login` (interactive, so suggest I run it myself). Greptile reviews committed work only: if the tree is dirty, offer to commit first.

Run `greptile review --json` backgrounded, adding `-b <base>` only when a base was given. The base flag is `-b`/`--branch`. Absent a base, the CLI reviews against the repository's default branch. Fall back to `--agent` (plain-text output for agents) if `--json` fails. For an interrupted run, `greptile review --resume` continues it and `greptile review status` reports the most recent review. For other flags, check `greptile review --help`.

The `--json` output carries `comments` (each with file, line, severity) plus `confidence` and `summary`. The acceptance bar is the local form of the hosted one in [reviewers.md](reviewers.md): `confidence` at its maximum with no comments left, or a written reason in the report for each comment you declined.

## CodeRabbit

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it from the [official CLI docs](https://docs.coderabbit.ai/cli) (the `coderabbitai/skills` plugin is the work-machine integration); don't hardcode a `curl | sh` installer. Check auth with `coderabbit auth status`. On failure, offer `coderabbit auth login` (interactive, so suggest I run it myself). `coderabbit doctor` verifies review readiness.

Run `coderabbit review --agent --light` backgrounded, adding `--base <base>` only when a base was given. `--light` trades depth for turnaround, which is the point of the local pass. Absent a base, the CLI reviews against a resolved default base and errors asking for `--base` when it can't find one. Fall back to `--plain` (human-readable output) if the `--agent` output can't be parsed; `coderabbit review findings` re-prints the last local review without re-running. For other flags, check `coderabbit review --help`.

`--agent` emits newline-delimited JSON events. Parse the `finding` events (`severity` = `critical`|`warning`|`info`, `fileName`, `codegenInstructions`) and the terminal `complete` event (`findings` count, `reviewedFiles`). The acceptance bar is the local form of the hosted one in [reviewers.md](reviewers.md): a terminal `complete` event with no critical or warning `finding` events, or a written reason in the report for each one you declined. Info-level findings are noise, the local form of the hosted nitpick/LGTM notes, so they don't hold the bar (a `complete` with `findings: 0` is the clean case, and info-only findings clear it too).
