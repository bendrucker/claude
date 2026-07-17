---
name: review:bot
description: >
  Run a review-bot CLI (Greptile) locally against the current branch's unmerged commits
  before pushing, then loop: summarize findings by severity, fix, commit, re-run until
  clean. The local pre-push counterpart to hosted PR bot review. Use for "greptile review",
  "run the review bot locally", "bot review before pushing".
argument-hint: "[base-branch]"
allowed-tools:
  - Bash(greptile:*)
  - Bash(git status:*)
  - Bash(git diff:*)
  - Bash(git log:*)
  - Bash(git rev-parse:*)
  - Bash(git add:*)
  - Bash(git commit:*)
  - Bash(jq:*)
  - Read
  - Edit
---

# Review Bot

Run the review bot that watches this repo's PRs, but locally, before anything is pushed: review
the branch's unmerged commits, fix what the bot would flag, and re-run until clean. Triage of
hosted bot comments after a PR exists belongs to `pull-request:follow-up`, not this skill.

## Arguments

`$ARGUMENTS` is the base branch to review against, passed as `-b <base>`. Absent, omit `-b` so
the CLI reviews against the repository's default branch.

## Provider

- **`greptile` CLI**: !`command -v greptile >/dev/null 2>&1 && greptile --version 2>/dev/null || echo "not installed"`

Detect the provider before running anything. The repo's bot config decides. The installed CLI is
a fallback only when no config exists:

- `.greptile/config.json` → Greptile.
- `.coderabbit.yaml` → CodeRabbit (no local workflow here yet: say so and stop).
- Neither config, but the probe above shows a version → Greptile.
- Otherwise → ask which bot reviews this repo's PRs.

## Greptile

1. **Preflight**: confirm you are in a git repo. If the CLI is missing, offer to install it
   (`npm i -g greptile` or `brew install greptileai/tap/greptile`). Check auth with
   `greptile whoami`. On failure, offer `greptile login` (interactive, so suggest I run it
   myself). Greptile reviews committed work only: if the tree is dirty, offer to commit first.
2. **Run**: `greptile review --json`, adding `-b <base>` only when a base was given. Fall back
   to `--agent` (plain-text output for agents) if `--json` fails. For an interrupted run,
   `greptile review --resume` continues it and `greptile review status` reports the most recent
   review. For other flags, check `greptile review --help`.
3. **Summarize**: report findings grouped by severity, each with a `file:line` reference and a
   one-line statement of the issue.
4. **Triage**: apply the clear wins. A finding you disagree with stays open: surface it with your
   reasoning rather than silently skipping it, and let me make the call.
5. **Repeat**: commit the fixes, re-run the review, and loop until it comes back clean or I stop.
6. **Hand off**: offer next steps (push, PR) without taking them.
