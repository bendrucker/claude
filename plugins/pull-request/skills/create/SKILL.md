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
  - Skill(gitlab:api)
  - Skill(github:attach)
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
- Name the primary change. If the title needs a serial comma, it's naming several changes. Name the shared theme or the largest change, and put the rest in the body.
- Keep under 50 characters. Cut scope rather than truncating words.
- Use imperative mood, lowercase except proper nouns

## Body

Lead with intent: why the change exists, the decisions a reviewer can't reconstruct from the diff, and how you know it works. Don't restate what the diff, the git log, or the status checks show. Review the session for content that never reached the code (rejected alternatives, scope changes, test observations) and state each as a self-contained decision, never as a delta against a plan the reviewer hasn't seen.

- Open with a bare verb ("Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when it needs justifying. Don't restate the title.
- Default to prose. Write a small PR as one paragraph with no headings. Add `##` sections only when the body is long enough to need them. Base length on substance, not diff size.
- Reference the motivating issue at the end of the opening (`Closes #N`, `Fixes #N`, or bare `#N` if not closing). Never touch the issue itself: no comments, labels, milestones, or assignees.
- Wrap code identifiers in backticks, but leave bare anything the platform auto-links: commit SHAs and issue/MR refs (`#N`, `!N`, `owner/repo#N`). Backticked refs don't auto-link.
- Write one line per paragraph and one line per list item. The body soft-wraps when it renders. Hard-wrapping at a column only narrows it.

Load the `writing` skill for the full set of tropes to avoid.

When the context above shows a detected PR template, follow its structure instead of the default body format and load [`references/template.md`](references/template.md) for mapping content into its sections.

## Reviewers

Corporate and internal repos only. On OSS (a public repo you don't own), skip this step and leave triage to the maintainer. Suggest reviewers for the user to choose from. Never assign them yourself. Load [`references/reviewers.md`](references/reviewers.md) for the visibility gate, the ranking script, and username resolution.

## Arguments

Parse `$ARGUMENTS` for these flags. With none, create a PR/MR that is ready for review and, on a repo you own, set to auto-merge.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--no-auto`: skip auto-merge. Default: auto-merge on a repo you own, off on a third-party repo and off under `--draft`. See [`references/merge.md`](references/merge.md).
- `--base <ref>`: parent branch to target. A branch whose parent is another topic branch is a stack layer. Only this flag or the user identifies one. The upstream ref tracks the branch's own remote copy, so it can't identify the parent. Default: the repo's default branch.
- `--label <name>`: apply a label, repeatable. On a repo that gates its hosted review bot on a label, apply the label to request the review (see follow-up's `reviewers.md`). Confirm each label exists first, per [`references/labels.md`](references/labels.md). Default: none.

## Workflow

1. **Branch validation**: If the context above shows you're on a default branch (main/master), stop and ask the user to switch to a feature branch first.
1. Stage changes if not already staged: `git add .`
1. Commit if there are no commits yet on the branch, using the same format as the PR title.
1. Local bot review, gated: the Review bot line above reports repo config, CLI presence, and any cooldown. On a config hit with no cooldown, apply the gate in follow-up's SKILL.md to decide whether the diff needs a metered review. If it does, run `pull-request:follow-up --local` before pushing. With no config, decide from the hosted signals in follow-up's `local.md`. Skip when a local bot pass already ran on this branch this session (`/ship` runs one), the gate says skip, the provider is paused, detection finds nothing, or the user declines.
1. Push the branch to remote: `git push -u origin HEAD`
1. Resolve any `--label` values against the repo before creating (see [`references/labels.md`](references/labels.md)).
1. Draft the body. Past a single paragraph, read [`references/sections.md`](references/sections.md) first: audience tiers, session content, density and heading rules, evidence, optional sections, slop to cut.
1. Create the PR/MR, appending `--draft` when set, `--base <parent>` when the branch is a stack layer, and `--label <name>` for each label that resolved:
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description-file tmp/pr-body-<branch>.md`
   - A screenshot or recording the body references by local path goes up with the command. GitHub: `--attach ./shot.png` per file on `gh pr create`, which rewrites the reference to the uploaded asset. Load `github:attach` first. GitLab: upload each file per the uploads section of `gitlab:api` and paste the returned markdown into the body before creating.
   - Put the branch name in the body filename so concurrent agents don't collide. Writing the file with a quoted heredoc (`cat > tmp/pr-body-<branch>.md <<'EOF'`) in the same call as the create command works: the validation hook reads the heredoc directly.
1. Chain a GitHub stack layer into its stack once the PR exists. Load `github:stack` for the `gh stack link` forms, the detection query that picks between them, and what an exit code 9 means.
1. Enable auto-merge after the PR/MR exists, unless `--no-auto` or `--draft` is set. On a repo you own (the Remote URL above names the owner), run `gh pr merge --auto`. On a third-party repo, leave the merge to the maintainer. GitLab, stacked PRs, and a repo that rejects `--auto` take the paths in [`references/merge.md`](references/merge.md).
1. Suggest reviewers on corporate repos (see [Reviewers](#reviewers)). Skip this step for OSS.
