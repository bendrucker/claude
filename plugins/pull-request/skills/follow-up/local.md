# Local Review CLI

Mechanics for running a hosted reviewer's CLI locally in [Local Mode](SKILL.md#local-mode-pre-push). Triage criteria and the loop live in SKILL.md; satisfaction signals live in [reviewers.md](reviewers.md). This file is only the channel: how to detect the provider and drive its CLI.

## Provider Detection

The repo's bot config decides. An installed CLI is a fallback only when no config exists:

- `.greptile/config.json` → Greptile.
- `.coderabbit.yaml` → CodeRabbit (no local workflow yet: say so and stop).
- Neither config, but `greptile` is on PATH → Greptile.
- Otherwise → ask which bot reviews this repo's PRs.

## Greptile

Preflight: confirm you are in a git repo. If the CLI is missing, offer to install it (`npm i -g greptile` or `brew install greptileai/tap/greptile`). Check auth with `greptile whoami`. On failure, offer `greptile login` (interactive, so suggest I run it myself). Greptile reviews committed work only: if the tree is dirty, offer to commit first.

Run `greptile review --json`, adding `-b <base>` only when a base was given. Absent, the CLI reviews against the repository's default branch. Fall back to `--agent` (plain-text output for agents) if `--json` fails. For an interrupted run, `greptile review --resume` continues it and `greptile review status` reports the most recent review. For other flags, check `greptile review --help`.

The `--json` output carries `comments` (each with file, line, severity) plus `confidence` and `summary`. The satisfaction signal is the local form of the hosted one in reviewers.md: zero comments at top confidence.
