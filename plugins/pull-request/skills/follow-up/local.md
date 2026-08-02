# Local Review CLI

Mechanics for running a hosted reviewer's CLI locally in [Local Mode](SKILL.md#local-mode-pre-push). Triage criteria and the loop live in SKILL.md; satisfaction signals live in [reviewers.md](reviewers.md). This file is only the channel: how to detect the provider and drive its CLI.

## Provider Detection

SKILL.md injects the fast path at load: `scripts/detect-bot.ts` reports each provider's repo config, CLI presence, and any live cooldown without spending a turn. Resolve its verdict:

- `paused until <date> (<reason>)` on a provider line means it is out of reviews until that date. Don't run its CLI and don't wait on its hosted bot ([reviewers.md](reviewers.md) covers the waiting loop). If it is the only provider, report the pause and stop.
- A repo config hit is definitive: that provider reviews this repo.
- No config does not mean no bot. Repos often run a hosted reviewer with nothing committed, so check the hosted signals (the same ones behind "When a Review Is Expected" in [reviewers.md](reviewers.md)). One call usually settles it, recent commenters first:
  - `gh api 'repos/{owner}/{repo}/issues/comments?sort=updated&direction=desc&per_page=100' --jq '[.[].user.login] | unique | map(select(test("greptile|coderabbit")))'`
  - Falling back to required checks: `gh api 'repos/{owner}/{repo}/rules/branches/{default-branch}' --jq '[.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'`
- A CLI on PATH with no config and no hosted signals is just a global install. Don't run a bot against a repo it doesn't review.
- Provider identified but CLI missing → offer to install it (per the provider section below).
- No signals anywhere → no bot reviews this repo. In the proactive paths (ship's pass, create's pre-push step) skip silently. On an explicit `--local` request, ask which bot reviews this repo's PRs.

## Running a Review

Both CLIs take minutes, and CodeRabbit's own docs say 7-30+. Launch the review with `run_in_background`, never in the foreground. The harness re-invokes you when it exits, so there is no poll loop to write and no timeout wall to hit.

Both also print within a second or two of starting. Greptile prints `▸ Dispatching review…`. CodeRabbit `--agent` starts streaming NDJSON events. So read silence as a break: if nothing has arrived on stdout 30 seconds in, kill the run and report what you saw, usually an auth or network error swallowed on stderr. Then stop. A broken CLI does not fix itself on a retry, and the retry costs another review.

Reviews are metered. Record a pause to the availability cache and stop when a run reports one:

- Greptile `free_reviews_limit_reached`
- a CodeRabbit fair-usage or rate-limit message
- a hosted summary comment saying reviews are paused

Write it to `~/.cache/claude/bot-review.json`, a JSON array of `{provider, remote, pausedUntil, reason}`. `remote` is `git remote get-url origin`, `pausedUntil` is the resume date the message gives (fall back to the first of next month), and `reason` is a short phrase like `free credits exhausted`. Merge into the existing array rather than overwriting it. `detect-bot.ts` reads the file. Recording the pause is what keeps the next session's fast path from implying availability and re-probing a dead provider.

## Greptile

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it (`npm i -g greptile` or `brew install greptileai/tap/greptile`). Check auth with `greptile whoami`. On failure, offer `greptile login` (interactive, so suggest I run it myself). Greptile reviews committed work only: if the tree is dirty, offer to commit first.

Run `greptile review --json` backgrounded, adding `-b <base>` only when a base was given. The flag is `-b`/`--branch`; there is no `--base`, and passing one fails with `error: unknown option '--base'`. Absent a base, the CLI reviews against the repository's default branch. Fall back to `--agent` (plain-text output for agents) if `--json` fails. For an interrupted run, `greptile review --resume` continues it and `greptile review status` reports the most recent review. For other flags, check `greptile review --help`.

The `--json` output carries `comments` (each with file, line, severity) plus `confidence` and `summary`. The satisfaction signal is the local form of the hosted one in reviewers.md: zero comments at top confidence.

## CodeRabbit

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it from the [official CLI docs](https://docs.coderabbit.ai/cli) (the `coderabbitai/skills` plugin is the work-machine integration); don't hardcode a `curl | sh` installer. Check auth with `coderabbit auth status`. On failure, offer `coderabbit auth login` (interactive, so suggest I run it myself). `coderabbit doctor` verifies review readiness.

Run `coderabbit review --agent --light` backgrounded, adding `--base <base>` only when a base was given. `--light` is the point of the local pass: it trades depth for turnaround, and the hosted review already covers depth. Absent a base, the CLI reviews against a resolved default base and errors asking for `--base` when it can't find one. Fall back to `--plain` (human-readable output) if the `--agent` output can't be parsed; `coderabbit review findings` re-prints the last local review without re-running. For other flags, check `coderabbit review --help`.

`--agent` emits newline-delimited JSON events. Parse the `finding` events (`severity` = `critical`|`warning`|`info`, `fileName`, `codegenInstructions`) and the terminal `complete` event (`findings` count, `reviewedFiles`). The satisfaction signal is the local form of the hosted one in reviewers.md: a terminal `complete` event with no critical or warning `finding` events. Info-level findings are noise, the local form of the hosted nitpick/LGTM notes, so they don't block satisfaction (a `complete` with `findings: 0` is the clean case, but info-only findings still count as satisfied).
