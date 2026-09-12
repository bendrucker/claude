---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request (PR, MR, CR).
  Use when the user asks to open one, including right after committing changes.

argument-hint: "[--draft] [--no-auto] [--base <ref>] [--label <name>] [--no-review] [--[no-]review-body]"
allowed-tools:
  - mcp__github
  - Agent
  - Skill(pull-request:follow-up)
  - Skill(github:stack)
  - Skill(gitlab:merge-request)
  - Skill(gitlab:api)
  - Skill(github:attach)
  - Skill(review:human)
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

Give the reviewer what the diff cannot: why the change exists, the decisions behind it, and how you know it works. Open the PR in the state the repo's workflow expects, so review starts without the user first fixing the title, the body, the base, or the labels.

The commit log, PR template, CONTRIBUTING notes, and review-bot config in the context below record conventions this document does not anticipate. Follow them over the defaults here.

## Context

- Remote URL: !`git remote get-url origin`
- Review bot: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-bot.ts`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/sem-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Arguments

Parse `$ARGUMENTS` for these flags. With no flags, open a PR/MR ready for review, and set auto-merge on a repo you own.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--no-auto`: skip auto-merge. Default: auto-merge on a repo you own, off on a third-party repo and off under `--draft`.
- `--base <ref>`: parent branch to target. Default: the repo's default branch. A branch whose parent is another topic branch is a stack layer, identified only by this flag or by the user. The upstream ref tracks the branch's own remote copy, so it cannot identify the parent.
- `--label <name>`: apply a label, repeatable. Default: none.
- `--no-review`: skip the hosted review request. Default: on a repo that gates its hosted bot on a label, request the review when the diff clears the metered-review gate and no local pass ran.
- `--[no-]review-body`: put the drafted body in front of the user before creating. Default: on when the Remote URL above names an owner other than you, off on your own repos.

## Title

Match the repo's commit style, read from the log in the context above:

- **subject** (default): `${subject}: ${summary}`, as in `api: add timeout to request`.
- **conventional**: `${type}: ${summary}`, as in `fix: add timeout to request`.

Name the primary change. If the title needs a serial comma, it is naming several changes: name the shared theme or the largest change, and put the rest in the body.

- Keep it under 50 characters. Cut scope rather than truncating words.
- Use the imperative mood.
- Lowercase every word except proper nouns.

## Body

Lead with intent: why the change exists, the decisions a reviewer cannot reconstruct from the diff, and how you know it works. Leave out what the diff, the git log, and the status checks already show.

- Review the session for content that never reached the code: rejected alternatives, scope changes, test observations. State each as a decision that stands on its own, rather than as a delta from a plan the reviewer never saw.
- Use the `Entities` block in the context above to judge what the change did, and write the intent behind those entries. Never reproduce the list.
- Open with a bare verb ("Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when it needs justifying. Write an opening that adds to the title rather than restating it.
- Reference the motivating issue at the end of the opening: `Closes #N`, `Fixes #N`, or a bare `#N` when the PR doesn't close it. Leave the issue itself untouched: no comments, labels, milestones, or assignees.
- Wrap code identifiers in backticks. Leave bare anything the platform auto-links: commit SHAs and issue or MR refs (`#N`, `!N`, `owner/repo#N`). Backticked refs don't auto-link.
- Default to prose. Write a small PR as one paragraph with no headings. Add `##` sections once the body carries enough substance to need them, judged by substance rather than by diff size.
- Write one line per paragraph and one line per list item. The body soft-wraps when it renders.

Load the `writing` skill and cut the tropes it lists.

Past one paragraph, load [`references/sections.md`](references/sections.md) and apply every rule in it: audience tiers, session content, density, headings, evidence, optional sections, and slop.

When the context above shows a detected PR template, follow the template's structure instead of the default body format and load [`references/template.md`](references/template.md) to map content into its sections.

## Workflow

1. **Branch check**: when the context above shows the current branch is a default branch (main or master), stop and ask the user to switch to a feature branch.
1. Stage any unstaged changes: `git add .`
1. When the branch carries no commits yet, commit in the same format as the PR title.
1. **Local bot review**: the Review bot line above reports repo config, CLI presence, and any cooldown. On a config hit with no cooldown, apply the gate in follow-up's SKILL.md to decide whether the diff needs a metered review, and run `pull-request:follow-up --local` before pushing when it does. With no config, decide from the hosted signals in follow-up's `local.md`. Skip the review when a local bot pass already ran on this branch this session (`/ship` runs one), when the gate says skip, when the provider is paused, when detection finds nothing, or when the user declines.
1. Push the branch: `git push -u origin HEAD`
1. Resolve every label against the repo before creating: each `--label` value, plus the review label when the gate in the local bot review step warranted a metered review that no local pass already spent. Load [`references/labels.md`](references/labels.md) for the lookup commands and for what to do when a label doesn't resolve.
1. Draft the title and body.
1. When `--review-body` applies, write the body to `tmp/pr-body-<branch>.md`, run `review:human --doc tmp/pr-body-<branch>.md --summary "PR body for <repo>"`, and fold the feedback into the file before creating. Inside herdr that ends the turn, and the steps below resume when the review comes back. This step reviews the body alone. Under `/ship` the diff already had its review.
1. Create the PR/MR, appending `--draft` when set, `--base <parent>` when the branch is a stack layer, and `--label <name>` for each label that resolved:
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description-file tmp/pr-body-<branch>.md`
   - Upload a screenshot or recording the body references by local path with the create command. GitHub: `--attach ./shot.png` per file on `gh pr create`, which rewrites the reference to the uploaded asset. Load `github:attach` first. GitLab: upload each file per the uploads section of `gitlab:api` and paste the returned markdown into the body before creating.
   - Put the branch name in the body filename so concurrent agents don't collide. Writing the file with a quoted heredoc (`cat > tmp/pr-body-<branch>.md <<'EOF'`) in the same call as the create command works, because the validation hook reads the heredoc directly.
1. Chain a GitHub stack layer into its stack once the PR exists. Load `github:stack` for the `gh stack link` forms, the detection query that picks between them, and what an exit code 9 means.
1. Enable auto-merge once the PR/MR exists, unless `--no-auto` or `--draft` is set. On a repo you own (the Remote URL above names the owner), run `gh pr merge --auto`. On a third-party repo, leave the merge to the maintainer. Load [`references/merge.md`](references/merge.md) for GitLab, for stacked PRs, and for a repo that rejects `--auto`.
1. On a corporate or internal repo, suggest reviewers for the user to choose from and assign only the ones the user accepts. On OSS (a public repo you don't own), skip this step and leave triage to the maintainer. Load [`references/reviewers.md`](references/reviewers.md) for the visibility gate, the ranking script (`${CLAUDE_PLUGIN_ROOT}/scripts/suggest-reviewers.ts`), and username resolution.

Done when the PR/MR exists on the remote, every step above has either run or been skipped for a condition that step names, and you have reported the URL to the user along with any step that did not complete and why.
