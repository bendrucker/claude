---
name: pull-request:create
description: |
  Create a pull request, merge request, or change request (PR, MR, CR).
  Use when the user asks to open one, including right after committing changes.

argument-hint: "[--draft] [--[no-]auto] [--base <ref>] [--label <name>] [--no-review] [--[no-]review-body]"
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

Give the reviewer what the diff cannot: why the change exists, the decisions behind it, and how you know it works. Open the PR in the state the repo's workflow expects, so review starts without the user first fixing the title, the body, the base, or the labels.

The commit log, PR template, CONTRIBUTING notes, and review-bot config in the context below record conventions this document does not anticipate. Follow them over the defaults here.

## Context

- Remote URL: !`git remote get-url origin`
- Review bot: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/detect-bot.ts`
- PR Template: !`bun ${CLAUDE_PLUGIN_ROOT}/scripts/pr-template.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/git-context.ts`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/sem-context.ts --stack-file "${user_config.stack_file}"`

!`bun ${CLAUDE_PLUGIN_ROOT}/scripts/contributing.ts`

## Arguments

Parse `$ARGUMENTS` for these flags. With no flags, open a PR/MR ready for review.

- `--draft`: open the PR/MR as a draft. Default: ready for review.
- `--[no-]auto`: set or skip auto-merge on a repo you own. Default: `${user_config.auto_merge}`. Off on a third-party repo and under `--draft`.
- `--base <ref>`: parent branch to target. Default: the repo's default branch. A branch whose parent is another topic branch is a stack layer, identified only by this flag or by the user. The upstream ref tracks the branch's own remote copy, so it cannot identify the parent.
- `--label <name>`: apply a label, repeatable. Default: none.
- `--no-review`: skip the hosted review request. Default: on a repo that gates its hosted bot on a label, request the review when the diff clears the metered-review gate and no local pass ran.
- `--[no-]review-body`: review the drafted body with `${user_config.body_review_skill}` before creating. Default: on when the Remote URL above names an owner other than you, off on your own repos. Off when that skill name is empty.

## Title

Match the repo's commit style, read from the log in the context above:

- **subject** (default): `${subject}: ${summary}`, as in `api: add timeout to request`.
- **conventional**: `${type}: ${summary}`, as in `fix: add timeout to request`.

Name the primary change. A title that needs a serial comma names several: name the shared theme or the largest change, and put the rest in the body. Keep it under 50 characters by cutting scope rather than truncating words. Use the imperative mood and lowercase every word except proper nouns.

## Body

Lead with intent: why the change exists, the decisions a reviewer cannot reconstruct from the diff, and how you know it works. Leave out what the diff, the git log, and the status checks already show.

- Review the session for content that never reached the code: rejected alternatives, scope changes, test observations, and a theory the evidence overturned that a reviewer could still hold. State each as a decision that stands on its own. Give an overturned theory one sentence: what it was and what ruled it out.
- Use the `Entities` block in the context above to judge what the change did, and write the intent behind those entries in place of the list.
- Open with a bare verb ("Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when it needs justifying. Make the opening add to the title.
- Reference the motivating issue at the end of the opening: `Closes #N`, `Fixes #N`, or a bare `#N` when the PR doesn't close it. On a repo you own, keep a link to the motivating task from another tracker (an `Original Task:` Things link) as the last line, even in a one-paragraph body. Leave the issue itself untouched: no comments, labels, milestones, or assignees.
- Wrap code identifiers in backticks. Leave bare anything the platform auto-links: commit SHAs and issue or MR refs (`#N`, `!N`, `owner/repo#N`). Backticked refs don't auto-link.
- Default to prose. Write a small PR as one paragraph with no headings. Add `##` sections once the body's substance, not the diff size, needs them.
- Write one line per paragraph and one line per list item. The body soft-wraps when it renders.

Load the `writing` skill and cut the tropes it lists.

Past one paragraph, load [`references/sections.md`](references/sections.md) and apply every rule in it.

When the context above shows a detected PR template, load [`references/template.md`](references/template.md) and follow the template's structure in place of the default body format.

## Workflow

1. When the current branch is a default branch (main or master), stop and ask the user to switch to a feature branch.
1. Stage any unstaged changes: `git add .`
1. When the branch carries no commits yet, commit in the same format as the PR title.
1. Local bot review: the Review bot line above reports repo config, CLI presence, and any cooldown. On a config hit with no cooldown, apply the gate in follow-up's SKILL.md to decide whether the diff needs a metered review, and run `pull-request:follow-up --local` before pushing when it does. With no config, decide from the hosted signals in follow-up's `local.md`. Skip it when a local bot pass already ran on this branch this session (`/ship` runs one), the gate says skip, the provider is paused, detection finds nothing, or the user declines.
1. Push the branch: `git push -u origin HEAD`
1. Resolve every label against the repo before creating: each `--label` value, plus the review label when the gate warranted a metered review that no local pass already spent. Load [`references/labels.md`](references/labels.md) for the lookup and for a label that doesn't resolve.
1. Draft the title and body.
1. When `--review-body` applies, write the body to `tmp/pr-body-<branch>.md`, run `${user_config.body_review_skill} --doc tmp/pr-body-<branch>.md --kind pr-body --summary "<repo> <branch>: review the PR body"`, and fold the feedback into the file before creating. This step reviews the body alone.
1. Create the PR/MR, appending `--draft` when set, `--base <parent>` when the branch is a stack layer, and `--label <name>` for each label that resolved:
   - **GitHub**: `gh pr create --title "..." --body-file tmp/pr-body-<branch>.md`
   - **GitLab**: `glab mr create --title "..." --description-file tmp/pr-body-<branch>.md`
   - Upload a screenshot or recording the body references by local path. GitHub: load `github:attach`, then pass `--attach ./shot.png` per file on `gh pr create`, which rewrites the reference to the uploaded asset. GitLab: upload each file per the uploads section of `gitlab:api` and paste the returned markdown into the body before creating.
   - Keep the branch name in the body filename so concurrent agents use separate files. Writing the file with a quoted heredoc (`cat > tmp/pr-body-<branch>.md <<'EOF'`) in the same call as the create command works, because the validation hook reads the heredoc directly.
1. Chain a GitHub stack layer into its stack once the PR exists. Load `github:stack` for the `gh stack link` forms, the detection query that picks between them, and what an exit code 9 means.
1. When `--[no-]auto` resolves on, enable auto-merge per [`references/merge.md`](references/merge.md).
1. On a corporate or internal repo, suggest reviewers for the user to choose from and assign only the ones the user accepts. Load [`references/reviewers.md`](references/reviewers.md) for the visibility gate, the ranking script (`${CLAUDE_PLUGIN_ROOT}/scripts/suggest-reviewers.ts`), and username resolution.

Done when the PR/MR exists on the remote, every step above has either run or been skipped for a condition that step names, and you have reported the URL to the user along with any step that did not complete and why.
