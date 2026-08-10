---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request with proper formatting and content guidelines.
  Invoke when the user wants to create, open, or submit a PR, MR, or CR, including after committing changes.

argument-hint: "[--draft] [--no-auto] [--base <ref>] [--label <name>]"
allowed-tools:
  - mcp__github
  - Agent
  - Skill(pull-request:follow-up)
  - Skill(github:stack)
  - Skill(gitlab:merge-request)
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
- Name the primary change. A title that wants a serial comma is an enumeration. Find the theme the changes share, or name the biggest one and let the body carry the rest.
- Keep under 50 characters. Past that, cut scope from the title rather than truncating words.
- Use imperative mood, lowercase except proper nouns

## Body

Lead with intent: why this change, the decisions a reviewer can't reconstruct from the diff, and how you know it works. Don't restate what the diff, git, or the status checks already carry. Mine the session for the substance that never reached the code (rejected alternatives, scope added or dropped, what you observed testing) and state each as a self-contained decision, not as a delta against a plan the reviewer never saw.

- Open with a bare verb ("Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when it needs justifying. Don't restate the title.
- Default to prose. A small PR is a tight paragraph with no headers. Add `##` sections only when length earns them. Length tracks substance, not diff size.
- Reference the motivating issue at the end of the opening (`Closes #N`, `Fixes #N`, or bare `#N` if not closing). Never touch the issue itself: no comments, labels, milestones, or assignees.
- Wrap code identifiers in backticks, but leave bare anything the platform auto-links: commit SHAs and issue/MR refs (`#N`, `!N`, `owner/repo#N`). Backticks kill the link.

Before drafting anything past a one-paragraph body, load [`references/sections.md`](references/sections.md): the substance catalog by change type, audience tiers, density and heading rules, evidence grounding, and slop to cut. Load the `writing` skill for the full set of tropes to avoid.

When the context above shows a detected PR template, follow its structure instead of the default body format and load [`references/template.md`](references/template.md) for mapping content into its sections.

## Reviewers

Corporate and internal repos only. On OSS (a public repo you don't own) the maintainer triages, so skip this and add no noise. Suggest reviewers, never assign; the user always chooses. Load [`references/reviewers.md`](references/reviewers.md) for the visibility gate, the ranking script, and username resolution.

## Arguments

Parse `$ARGUMENTS` for these flags. With none, create a PR/MR that is ready for review and, on a repo you own, armed to auto-merge.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--no-auto`: skip auto-merge. Default: auto-merge on a repo you own, off on a third-party repo and off under `--draft`. See [`references/merge.md`](references/merge.md).
- `--base <ref>`: parent branch for a stack layer, per [`references/stacking.md`](references/stacking.md). Default: the repo's default branch.
- `--label <name>`: apply a label, repeatable. Where a repo gates its hosted review bot on a label, this is how a review gets requested (see follow-up's `reviewers.md`). Confirm each label exists before creating, per [`references/labels.md`](references/labels.md). Default: none.

## Workflow

1. **Branch validation**: If the context above shows you're on a default branch (main/master), stop and ask the user to switch to a feature branch first.
1. Stage changes if not already staged: `git add .`
1. Commit if there are no commits yet on the branch, using the same format as the PR title.
1. Local bot review, gated: the Review bot line in Context above is the fast-path verdict, covering repo config, CLI presence, and any live cooldown. On a repo config hit with no cooldown, decide whether the diff is worth a metered review (follow-up's SKILL.md defines the gate). When it is, run `pull-request:follow-up --local` before pushing so findings surface while the branch is still local. With no config, a bot may still review the repo: follow-up's `local.md` hosted signals decide. Skip when a local bot pass already ran on this branch in this session (`/ship` runs it as a gated pass), when the gate says skip, when the provider is paused, when detection comes up empty, or when the user declines.
1. Push the branch to remote: `git push -u origin HEAD`
1. Resolve any `--label` values against the repo before creating (see [`references/labels.md`](references/labels.md)).
1. Draft the body.
1. Create the PR/MR, appending `--draft` when set, `--base <parent>` when the branch is a stack layer, and `--label <name>` for each label that resolved:
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description "$(cat tmp/pr-body-<branch>.md)"`
   - Write the body to the temp file in its own Bash call, with the branch name in the filename so concurrent agents don't collide. The create call has to *start* with `gh`/`glab`: the body-validation hook matches on that leading verb, so anything in front of it (a `cd`, a chained heredoc that writes the body, an env assignment) skips validation silently. Never `cd` to the directory you are already in.
1. Link the stack when the branch is a GitHub stack layer, after the PR exists (see [`references/stacking.md`](references/stacking.md)).
1. Arm auto-merge after the PR/MR exists, unless `--no-auto` or `--draft` is set. On a repo you own (the Remote URL above names the owner), run `gh pr merge --auto`. On a third-party repo, leave the merge to the maintainer. GitLab, stacked PRs, and a repo that rejects `--auto` take the paths in [`references/merge.md`](references/merge.md).
1. Suggest reviewers on corporate repos (see [Reviewers](#reviewers)). Skip this step for OSS.
