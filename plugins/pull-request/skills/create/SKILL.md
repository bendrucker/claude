---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request with proper formatting and content guidelines.
  Invoke when the user wants to create, open, or submit a PR, MR, or CR—including after committing changes.

argument-hint: "[--draft] [--auto] [--watch] [--dry-run]"
allowed-tools:
  - mcp__github
  - Agent
  - Skill(pull-request:babysit)
  - Skill(pull-request:follow-up)
  - "Bash(git add:*)"
  - "Bash(git commit:*)"
  - "Bash(git push:*)"
  - "Bash(git remote get-url:*)"
  - "Bash(gh pr:*)"
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

A wall of text is easier to prevent than to fix. For a large change, or any open-source PR, settle the structure before writing prose.

- Gauge size from the diff in the context above. A change spanning several concepts or many files, or any open-source-tier PR, earns an outline first. A small personal change does not: write it in one pass.
- The outline is the section headings you'll use, each with one-line bullets naming what belongs under it. Keep it under a few hundred characters, bullets rather than sentences. Leave a placeholder for a screenshot, table, or benchmark you'll add later.
- Show the outline to the user and stop. Let them cut a section, add one, or reshape it before you spend tokens on prose. Then expand each bullet into the body, following the shape rules and the section catalog.

## Template

When the context above shows a detected PR template, follow its structure instead of the default body format. Load [`template.md`](template.md) for how to preserve sections and map skill-generated content into them. With no template detected, use the default Body format above.

## Issue Handling

When an issue is referenced:

- **ONLY reference the issue** in the PR body (e.g., `Closes #123`, `Fixes #456`)
- **NEVER modify the issue directly** - no comments, labels, milestones, or assignees

## Reviewers

Corporate and internal repos only. On OSS (a public repo you don't own) the maintainer triages, so skip this and add no noise. Suggest reviewers, never assign; the user always chooses. This runs after creation, so it never delays it. Load [`reviewers.md`](reviewers.md) for the visibility gate, the ranking script, and username resolution.

## Arguments

Parse `$ARGUMENTS` for these flags. With none, create a normal PR/MR that is ready for review and does not auto-merge.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--auto`: after creating, enable auto-merge so it merges once checks pass and required approvals land. Default: off.
- `--watch`: after creating, spawn `pull-request:babysit` to actively shepherd the PR/MR (fix trivial red CI, drive the merge). When a bot review should gate the merge (asked to wait for a reviewer, or a review bot is configured on the repo), add `--reviews` so babysit hands the wait to `follow-up --auto`, which reads each reviewer's documented signal before merging. At creation time the pending-status-check signal does not exist yet, so lean on the configured-reviewer signal here and let follow-up re-check the live PR; a needless `--reviews` costs only one no-op hand-off. Distinct from `--auto`, which only flips on the platform's passive auto-merge. Default: off.
- `--dry-run` (alias `--body-only`): produce the body without creating anything. See [Dry Run](#dry-run). Default: off.

## Dry Run

If the arguments include `--dry-run` (alias `--body-only`), produce the body without creating anything. Determine the title and body from the context above as usual, write the body to `tmp/pr-body-<branch>.md`, then print the title and body to the user and stop. Do not stage, commit, push, or run `gh pr create` / `glab mr create`. Use this to preview or evaluate the body in isolation.

## Workflow

If `--dry-run` (or `--body-only`) is set, follow the Dry Run section instead of the steps below.

1. **Branch validation**: If the context above shows you're on a default branch (main/master), stop and ask the user to switch to a feature branch first.
1. Stage changes if not already staged: `git add .`
1. Commit if there are no commits yet on the branch. Follow the same format for the commit message as for the pull request title (conventional or subject-oriented based on repo standard): `git commit -m "..."`
1. Local bot review, proactive: the Review bot line in Context above is the fast-path verdict. A repo config hit means that bot reviews this repo: run `pull-request:follow-up --local` before pushing so its findings surface while the branch is still local. With no config, a bot may still review the repo: follow-up's `local.md` hosted signals decide. Skip when a local bot pass already ran on this branch in this session (`/ship` runs it as a gated pass), when detection comes up empty, or when the user declines.
1. Push the branch to remote: `git push -u origin HEAD`
1. Draft the body. For a large change or any open-source PR, outline the structure first and get the user's sign-off before expanding it (see [Outline First](#outline-first)). A small personal change skips straight to the full body.
1. Create the PR/MR. Append `--draft` to the create command when `--draft` is set:
   - Write the body to a temp file first (e.g., `tmp/pr-body-<branch>.md`)
   - Include the branch name in the filename to avoid conflicts with concurrent agents
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description "$(cat tmp/pr-body-<branch>.md)"`
1. Enable auto-merge when `--auto` is set, after the PR/MR exists:
   - **GitHub**: `gh pr merge --auto` (add `--squash` or `--rebase` to match the repo's merge method when known)
   - **GitLab**: load `gitlab:merge-request` and run its `merge.ts --auto-merge`, which handles merge trains and falls back to `glab mr merge` as needed
1. Suggest reviewers on corporate repos (see [Reviewers](#reviewers)). Skip this step for OSS. The PR/MR already exists, so reviewer ranking runs after creation and adds no latency to it.
1. Watch the PR/MR when `--watch` is set. Spawn a background `Agent` that invokes the `pull-request:babysit <url> --merge` skill (add `--reviews` when a bot review should gate the merge, per the flag above) on the PR/MR url created earlier. Babysit is session-scoped and owns its own `Monitor` watcher, so running it inside a backgrounded Agent gives it a session to live in: the create session returns immediately while the watch persists in the background. This mirrors the babysit -> follow-up handoff, where babysit delegates the review loop to another skill that owns its own watchers.

## GitLab Notes

For advanced GitLab features (stacking, username lookup), load `gitlab:merge-request`.
