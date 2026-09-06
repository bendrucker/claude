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
  - Skill(review:code)
  - "Bash(bun ${CLAUDE_SKILL_DIR}/scripts/:*)"
---

# Peer Review

Assist me in reviewing this PR: $ARGUMENTS

## Context

Your own login as the reviewer (see [tone.md](tone.md) for how to address each party). Whichever platform applies resolves. The other reads `unavailable`.

- GitHub user: !`gh api graphql -f query='{viewer{login}}' --jq .data.viewer.login 2>/dev/null | grep . || echo "unavailable"`
- GitLab user: !`glab api user 2>/dev/null | jq -r .username 2>/dev/null | grep . || echo "unavailable"`

## Arguments

- `--triage`: assess the PR for sequencing instead of reviewing it (see [Triage Mode](#triage-mode)). Default: off, which runs the full review workflow below.

## Triage Mode

When `--triage` is set, stay read-only and assess the PR for sequencing. Gather just enough to judge scope: the PR body, the diff stat, and the files touched. Then report two things and stop.

- What the PR changes, in one line.
- The estimated review effort on the same scale step 4 uses for `review:code` (low, medium, high, xhigh), with one-line reasoning.

## Guardrails

- **Must** check with me before submitting. Show file comments and review comment.
- **Don't** insist on commenting on every PR. Propose approving with no comment if everything looks good.
- **Do** match my writing style. You're commenting as me, not a generic AI assistant.
- **Do** ask me about ambiguous code rather than guessing.
- **Don't** run interpreter one-liners for library introspection. Read the source or fetch the docs.

## Workflow

1. **Research** - Gather context and identify participants (see [research.md](research.md))
2. **Context** - Determine review context using repository visibility. Private repositories use [corporate](references/corporate.md) defaults. Public repositories use [open-source](references/open-source.md) defaults. Check visibility via the platform API (`gh api repos/OWNER/REPO --jq .visibility` or `glab api projects/ENCODED_PATH | jq .visibility`). If ambiguous, ask me.
3. **Review** - Examine changed files and existing comments
4. **Delegate** - Run `review:code` for code-quality analysis. `review:code` reads the local diff, so run `gh pr checkout` first if not already on the PR branch. Summarize the diff (rough line count, files touched, sensitive areas) and signals from the PR body, propose an effort level with one-line reasoning, and confirm via `AskUserQuestion` before invoking. Skip the call for trivial PRs (docs-only, dep bumps). Effort heuristics:
   - **low**: docs-only, dep bumps, config tweaks, trivial fixes (<50 lines)
   - **medium**: typical features or fixes, single module, ~50–500 lines
   - **high**: large refactors, multi-module, public API or schema changes, ~500–2000 lines
   - **xhigh**: security-sensitive (auth, payments, data access), breaking changes, migrations, or a change with extreme blast radius
5. **Think** - Evaluate along two axes. Requirement fulfillment: does the change deliver what was asked (see [requirements.md](requirements.md))? Code quality: evaluate against priorities (see [priorities.md](priorities.md)) and smells (see [smells.md](smells.md)), incorporating `review:code` findings. Keep the axes separate so a clean diff does not mask a missed requirement.
6. **Map** - Write the proposed comments to a JSON file (`id`, `path`, `start_line`, `end_line`, `side`, `comment_type`, `content` per comment), then map each to a platform position:

   ```bash
   bun ${CLAUDE_SKILL_DIR}/scripts/mapping.ts map --platform <github|gitlab> \
     --comments <path> --diff <path> --commit <head-sha>
   ```

   GitLab also needs `--base` and `--start` from the MR `diff_refs`. The CLI runs the in-diff pre-check and returns `{ payloads, dropped }`. An anchor outside a diff hunk lands in `dropped` (GitHub rejects it with `422 "Line could not be resolved"`), so surface those to me and re-anchor rather than losing them. Skip this step when approving with no comments.
7. **Post** - Show me the mapped set, then on my go post as one batch and choose Approve / Comment / Request Changes based on severity. GitHub: a pending review submitted as a batch. GitLab: draft notes published together.

See [tone.md](tone.md) for comment style guidelines.

## Service Support

This skill assumes GitHub. For GitLab merge requests, load `gitlab:merge-request` for the submission workflow; use `draft-note.ts submit` to publish draft notes with an optional summary and review decision.

Comments post through the programmatic path (`mcp__github` / `gh` / `glab`). On follow-up, resolve addressed threads natively on the platform: `review-threads.ts` for GitHub, the resolve flow in `gitlab:merge-request` for GitLab.
