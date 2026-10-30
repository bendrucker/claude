---
name: review:peer
description: |
  Review a pull request when requested by a peer. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes. Supports GitHub and GitLab. Pass --triage to summarize a PR and estimate its review effort without reviewing it.
argument-hint: "<pr-url-or-number> [--triage]"
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - Bash(git log:*)
  - Bash(git diff:*)
  - Bash(git show:*)
  - Bash(git branch:*)
  - Bash(git fetch:*)
  - Bash(git checkout:*)
  - Bash(git remote:*)
  - Bash(git rev-parse:*)
  - Bash(git cat-file:*)
  - Bash(git status:*)
  - Bash(jq:*)
  - mcp__github
  - WebFetch
  - Skill(code-review)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
---

# Peer Review

Help me review this PR: $ARGUMENTS

The review is done when I have approved a mapped set of comments (or an approval with none) and it is posted as one batch.

## Context

Your own login as the reviewer (see [tone.md](tone.md) for how to address each party). The platform that doesn't apply reads `unavailable`.

- GitHub user: !`gh api graphql -f query='{viewer{login}}' --jq .data.viewer.login 2>/dev/null | grep . || echo "unavailable"`
- GitLab user: !`glab api user 2>/dev/null | jq -r .username 2>/dev/null | grep . || echo "unavailable"`

## Triage Mode

With `--triage`, stay read-only and judge scope from the PR body, diff stat, and files touched. Report two things and stop:

- What the PR changes, in one line.
- The review effort on the [effort scale](#effort-scale), with one-line reasoning.

## Guardrails

- Show me the file comments and review comment, and post only on my go.
- When everything looks good, propose approving with no comment.
- Write in my voice. You're commenting as me.
- Ask me about ambiguous code.
- For library introspection, read the source or fetch the docs.

## Workflow

1. Research: gather context and identify participants (see [research.md](research.md)).
2. Context: private repos use [corporate](references/corporate.md) defaults, public repos use [open-source](references/open-source.md). Check with `gh api repos/OWNER/REPO --jq .visibility` or `glab api projects/ENCODED_PATH | jq .visibility`. Ask me if ambiguous.
3. Review the changed files and existing comments.
4. Delegate: run `code-review`, except on trivial PRs (docs-only, dep bumps). It reads the local diff, so `gh pr checkout` first. Before invoking, summarize the diff (rough line count, files, sensitive areas) and PR-body signals, propose an effort level, and confirm it via `AskUserQuestion`.
5. Think on two separate axes, so a clean diff does not mask a missed requirement: requirement fulfillment ([requirements.md](requirements.md)) and code quality ([priorities.md](priorities.md), [smells.md](smells.md)), folding in `code-review` findings.
6. Map: write proposed comments to a JSON file (`id`, `path`, `start_line`, `end_line`, `side`, `comment_type`, `content`), then map them to platform positions. Skip when approving with no comments.

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/mapping.ts map --platform <github|gitlab> \
     --comments <path> --diff <path> --commit <head-sha>
   ```

   GitLab also needs `--base` and `--start` from the MR `diff_refs`. The output is `{ payloads, dropped }`. A `dropped` comment anchors outside a diff hunk (GitHub rejects it with `422 "Line could not be resolved"`), so show it to me and re-anchor it.
7. Post: show me the mapped set, then on my go post one batch with Approve, Comment, or Request Changes by severity. GitHub uses a pending review, GitLab draft notes published together.

See [tone.md](tone.md) for comment style.

### Effort Scale

- low: docs-only, dep bumps, config tweaks, trivial fixes (<50 lines)
- medium: typical features or fixes, single module, ~50–500 lines
- high: large refactors, multi-module, public API or schema changes, ~500–2000 lines
- xhigh: security-sensitive (auth, payments, data access), breaking changes, migrations, or extreme blast radius

## Service Support

For GitLab, load `gitlab:merge-request` for submission and publish draft notes with `draft-note.ts submit`, which takes an optional summary and review decision.

Post comments through `mcp__github`, `gh`, or `glab`. On follow-up, resolve addressed threads natively: `review-threads.ts` on GitHub, the resolve flow in `gitlab:merge-request` on GitLab.
