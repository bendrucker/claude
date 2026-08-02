---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request with proper formatting and content guidelines.
  Invoke when the user wants to create, open, or submit a PR, MR, or CR, including after committing changes.

argument-hint: "[--draft] [--auto] [--watch] [--base <ref>] [--dry-run]"
allowed-tools:
  - mcp__github
  - Agent
  - Skill(pull-request:babysit)
  - Skill(pull-request:follow-up)
  - Skill(github:stack)
  - "Bash(git add:*)"
  - "Bash(git commit:*)"
  - "Bash(git push:*)"
  - "Bash(git remote get-url:*)"
  - "Bash(gh pr:*)"
  - "Bash(gh stack:*)"
  - "Bash(glab mr:*)"
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/*)"
---

# Create Pull Request

## Context

- Remote URL: !`git remote get-url origin`
- Review bot: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-bot.ts`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Title

- Check the log in the context above to determine the repo's commit style:
  - **subject** (default): `${subject}: ${summary}` (e.g., `api: add timeout to request`)
  - **conventional**: `${type}: ${summary}` (e.g., `fix: add timeout to request`)
- Keep under 50 characters, max 100
- Use imperative mood, lowercase except proper nouns

## Body

Lead with intent: why this change, the decisions a reviewer can't reconstruct from the diff, and how you know it works. Don't restate what the diff, git, or the status checks already carry. Mine the session for the substance that never reached the code (rejected alternatives, overturned theories, what you observed testing, scope added or dropped) and state each as a self-contained decision, not as a delta against a plan the reviewer never saw.

- Open with a bare verb ("Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when it needs justifying. Don't restate the title.
- Default to prose. A small PR is a tight paragraph with no headers. Add `##` sections only when length earns them. Length tracks substance, not diff size.
- Reference the motivating issue at the end of the opening (`Closes #N`, `Fixes #N`, or bare `#N` if not closing). Wrap code identifiers in backticks, but leave bare anything the platform auto-links: commit SHAs and issue/MR refs (`#N`, `!N`, `owner/repo#N`). Backticks kill the link.

Before drafting anything past a one-paragraph body, load [`sections.md`](sections.md): the substance catalog by change type, audience tiers, density and heading rules, evidence grounding, and slop to cut. Load the `writing` skill for the full set of tropes to avoid.

## Outline First

For a large change (several concepts or many files) or any open-source PR, settle the structure before writing prose: draft the section headings with one-line bullets naming what belongs under each, show the outline to the user, and stop for their sign-off before expanding it. A small personal change skips this and gets written in one pass.

## Template

When the context above shows a detected PR template, follow its structure instead of the default body format. Load [`template.md`](template.md) for how to preserve sections and map skill-generated content into them. With no template detected, use the default Body format above.

## Issue Handling

Reference a motivating issue in the PR body only (`Closes #123`). Never modify the issue itself: no comments, labels, milestones, or assignees.

## Reviewers

Corporate and internal repos only. On OSS (a public repo you don't own) the maintainer triages, so skip this and add no noise. Suggest reviewers, never assign; the user always chooses. Load [`reviewers.md`](reviewers.md) for the visibility gate, the ranking script, and username resolution.

## Arguments

Parse `$ARGUMENTS` for these flags. With none, create a normal PR/MR that is ready for review and does not auto-merge.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--auto`: after creating, enable auto-merge so it merges once checks pass and required approvals land. Default: off.
- `--watch`: after creating, spawn `pull-request:babysit` to actively shepherd the PR/MR (fix trivial red CI, drive the merge). When a bot review should gate the merge (asked to wait for a reviewer, or a review bot is configured on the repo), add `--reviews` so babysit hands the wait to `follow-up --auto`; a needless `--reviews` costs only one no-op hand-off. Distinct from `--auto`, which only flips on the platform's passive auto-merge. Default: off.
- `--base <ref>`: parent branch for a stack layer. See [Stacking](#stacking). Default: the repo's default branch.
- `--dry-run` (alias `--body-only`): produce the body without creating anything. See [Dry Run](#dry-run). Default: off.

## Dry Run

Determine the title and body from the context above as usual, write the body to `tmp/pr-body-<branch>.md`, then print the title and body to the user and stop. Do not stage, commit, push, or run `gh pr create` / `glab mr create`. Use this to preview or evaluate the body in isolation.

## Workflow

If `--dry-run` (or `--body-only`) is set, follow [Dry Run](#dry-run) instead of the steps below.

1. **Branch validation**: If the context above shows you're on a default branch (main/master), stop and ask the user to switch to a feature branch first.
1. Stage changes if not already staged: `git add .`
1. Commit if there are no commits yet on the branch. Follow the same format for the commit message as for the pull request title (conventional or subject-oriented based on repo standard): `git commit -m "..."`
1. Local bot review, gated: the Review bot line in Context above is the fast-path verdict, covering repo config, CLI presence, and any live cooldown. On a repo config hit with no cooldown, apply ship's Bot Review Gate (`~/.claude/skills/ship/references/passes.md`, Bot Review Gate) to the diff. Both channels draw the same meter. A diff the gate skips gets no local pass. When it says spend, run `pull-request:follow-up --local` before pushing so findings surface while the branch is still local. With no config, a bot may still review the repo: follow-up's `local.md` hosted signals decide. Skip when a local bot pass already ran on this branch in this session (`/ship` runs it as a gated pass), when the provider is paused, when detection comes up empty, or when the user declines.
1. Push the branch to remote: `git push -u origin HEAD`
1. Draft the body, outlining first for a large change or any open-source PR (see [Outline First](#outline-first)).
1. Create the PR/MR. Append `--draft` to the create command when `--draft` is set:
   - Write the body to a temp file first (e.g., `tmp/pr-body-<branch>.md`)
   - Include the branch name in the filename to avoid conflicts with concurrent agents
   - Write the body in its own Bash call, then create in a second call that starts with `gh`/`glab`. The body-validation hook matches on that leading verb, so anything in front of it (a `cd`, a chained heredoc that writes the body, an env assignment) skips validation silently. Never `cd` to the directory you are already in
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description "$(cat tmp/pr-body-<branch>.md)"`
   - Add `--base <parent>` on either when the branch is a stack layer (see [Stacking](#stacking))
1. Link the stack when the branch is a GitHub stack layer, after the PR exists. See [Stacking](#stacking).
1. Enable auto-merge when `--auto` is set, after the PR/MR exists:
   - **GitHub**: `gh pr merge --auto` (add `--squash` or `--rebase` to match the repo's merge method when known)
   - **GitHub, stacked**: auto-merge has no equivalent. Say so and suggest `--watch`, which drives the stack merge at green.
   - **GitLab**: load `gitlab:merge-request` and run its `merge.ts --auto-merge`, which handles merge trains and falls back to `glab mr merge` as needed
1. Suggest reviewers on corporate repos (see [Reviewers](#reviewers)). Skip this step for OSS.
1. Watch the PR/MR when `--watch` is set. Spawn a background `Agent` that invokes `pull-request:babysit <url> --merge` (add `--reviews` per the flag above). Babysit is session-scoped and owns its own `Monitor` watcher, so the backgrounded Agent gives it a session to live in while create returns immediately.

## Stacking

A branch whose parent is another topic branch rather than the default branch is a stack layer, and its PR has to target that parent. `--base <ref>` names the parent, and so does the user saying what this branch sits on. Nothing else does: the branch's own upstream ref points at its remote copy, not its parent. Without either signal, open against the default branch.

On GitHub, create the PR with `--base <parent>`, then chain it into the stack with `gh stack link`. Creating it first is what preserves the drafted title and body: `link` reuses the open PR it finds, and auto-generates both for PRs it opens itself. The native alternative, `gh stack submit`, prompts for them in a full-screen editor no tool call can drive.

Which form of `link` to use depends on whether the parent is already stacked. `gh stack view --short` answers when the stack is tracked in this working tree, and `github:stack`'s detection query answers against the parent's PR either way.

```
gh stack link <stack-number> <this-branch> # parent is in a stack: append to it
gh stack link <bottom> ... <this-branch>   # parent isn't: list the chain bottom to top
```

`link` writes no local tracking state. It works whether or not `gh stack` owns the branches here. On a tracked stack the next `gh stack sync` reconciles the new PR into local state.

Exit code 9 means the repo doesn't have stacked PRs enabled. Leave the PR as it is: `--base <parent>` already targets the right branch, and with no stack object the merge takes the ordinary `gh pr merge` path. Say so and move on.

Load `github:stack` for the two layouts, the queries, and the merge behavior.

## GitLab Notes

For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
