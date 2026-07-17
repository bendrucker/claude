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

The body conveys what the diff cannot: why this change, what you decided along the way, and how you know it works. The reviewer reads the diff for what changed, so don't restate it. Spend the body on intent and the decisions a reviewer can't reconstruct from the code.

Mine the conversation that produced this change. The substance lives there: decisions and the alternatives you rejected, the scope you added or dropped, theories you tried and overturned, what you observed testing locally, limitations you ruled out, naming or scope you settled by hand. Put it in the body as a self-contained decision, not as a delta against a plan the reviewer never saw. Keep it out of code comments.

- Open with what changed (a bare verb: "Adds", "Fixes", "Removes") when the change is self-evident, or with the problem when the change needs justifying. Don't restate the title.
- Length tracks substance, not diff size. A subtle one-line fix may need paragraphs. A large mechanical change may need two sentences.
- Restate nothing another surface already carries. The diff shows what changed, git shows which files, and the status checks show that lint, types, and tests pass. Name a check only when its result is not one CI will post: a manual observation, an intentional exclusion, a pre-existing warning you're leaving in place.
- Shape prose so it reads. One thread per paragraph, and break a paragraph that runs past three or four sentences. A single sentence stacking clauses behind commas is a wall even when every clause is true. When items are parallel and merely co-occur (findings, cases covered, checks run), make them a list. Prose is for reasoning that connects one point to the next. "Default to prose" means don't add the reflexive scaffold, not cram an enumeration into one sentence.
- Default to prose. Use `##` sections only when the body is long enough to need them. Small PRs are a tight paragraph with no headers.
- Audience sets the bar (same owner-and-visibility probe as [Reviewers](#reviewers)). Owner is you: a personal repo you review through Claude, so stay concise and skip background you already hold. Private or org-owned: a corporate repo coworkers skim, so lead with intent at moderate detail. Public and not yours: an open-source repo under external scrutiny with the highest cost for unclear intent, so spend the most on decisions and evidence.
- Reference the motivating issue at the end of the opening (`Closes #N`, `Fixes #N`, or `#N` if not closing). Related-for-context issues go in a `## References` section, never bare at the bottom.
- Wrap code identifiers in backticks: function names, class names, file paths, endpoints, status codes. Do not backtick anything the platform auto-links: commit SHAs and issue/MR references (`#N`, `!N`, `owner/repo#N`). Backticks render them as code and kill the link. Write them bare.

See [`sections.md`](sections.md) for the substance catalog (what to surface, by change type), optional-section guidance, how to ground claims in evidence, and the slop patterns to cut. Load the `writing` skill for the full set of tropes to avoid.

## Outline First

A wall of text is easier to prevent than to fix. For a large change, or any open-source PR, settle the structure before writing prose.

- Gauge size from the diff in the context above. A change spanning several concepts or many files, or any open-source-tier PR, earns an outline first. A small personal change does not: write it in one pass.
- The outline is the section headings you'll use, each with one-line bullets naming what belongs under it. Keep it under a few hundred characters, bullets rather than sentences. Leave a placeholder for a screenshot, table, or benchmark you'll add later.
- Show the outline to the user and stop. Let them cut a section, add one, or reshape it before you spend tokens on prose. Then expand each bullet into the body, following the shape rules and the section catalog.

## Template

When a PR template is provided in context above, follow its structure instead of the default body format:

- Preserve all template sections, even if some are left empty
- Leave checklists (checkbox items) untouched for the user to complete manually
- Remove HTML comments (`<!-- ... -->`) that serve as placeholder instructions
- Map skill-generated content into corresponding template sections:
  - Description/summary sections: the opening plus the conversation substance (decisions, scope added or dropped, what you observed testing)
  - Changes/what sections: follow the `## Changes` guidance in `sections.md`
  - Testing/verification sections: follow the `## Testing` guidance in `sections.md`
  - Issue/references sections: the motivating issue ref and `## References` content
- For template sections with no skill equivalent (e.g., type-of-change dropdowns), fill them based on the diff context
- Within each template section, follow the style rules from `sections.md`
- If the template has a free-form description section, place the summary sentences there and add skill subsections within it as needed

When no template is detected, use the default body format from the Body section above.

## Issue Handling

When an issue is referenced:

- **ONLY reference the issue** in the PR body (e.g., `Closes #123`, `Fixes #456`)
- **NEVER modify the issue directly** - no comments, labels, milestones, or assignees

## Reviewers

Reviewer suggestion is for corporate and internal work. On OSS the project author or maintainer triages incoming PRs, so suggesting reviewers there only adds noise. Gate this whole section on repository visibility:

- **GitHub**: `gh repo view --json visibility -q .visibility`
- **GitLab**: `glab api projects/:fullpath --jq .visibility`

A public repository is OSS. Skip the rest of this section and let the maintainer triage. Any other visibility (private, internal) is corporate. Continue below.

Suggest reviewers; never assign them. The user always chooses from the suggestions.

Run the script to rank candidates from the git history of the changed files. It excludes you and needs no arguments:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/scripts/suggest-reviewers.ts
```

- **Blame owners**: people who wrote the lines you're changing. Suggest the top one or two.
- **Sole-author fallback**: when the output reports you're the sole author of the area, use the recent in-area PR/MR refs it prints—look up who you requested review from on those and suggest the recurring names.

This runs after you create the PR/MR, so it never delays creation. Resolve names to platform usernames only after the user accepts, then assign them to the existing PR/MR:

- **GitHub**: `gh pr edit --add-reviewer <user>` (resolve emails to logins with `mcp__github` if needed)
- **GitLab**: load `gitlab:merge-request` for username resolution, then `glab mr update --reviewer <user>`

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
1. Local bot review, proactive: when the repo has a supported review bot (bot config like `.greptile/config.json` present and its CLI installed), run `pull-request:follow-up --local` before pushing so the hosted reviewer's findings surface while the branch is still local. Skip when a local bot pass already ran on this branch in this session (`/ship` runs it as a gated pass) or the user declines.
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
