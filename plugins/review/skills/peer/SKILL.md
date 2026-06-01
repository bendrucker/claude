---
name: review:peer
description: |
  Review a pull request when requested by a peer. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes. Supports GitHub and GitLab.
allowed-tools:
  - Bash(gh:*)
  - Bash(hunk session:*)
  - mcp__github
  - Skill(code-review)
---

# Peer Review

Assist me in reviewing this PR: $ARGUMENTS

If not on the branch, first run `gh pr checkout` to switch.

## Guardrails

- **Must** check with me before submitting. Show file comments and review comment.
- **Don't** insist on commenting on every PR. Propose approving with no comment if everything looks good.
- **Do** match my writing style. You're commenting as me, not a generic AI assistant.
- **Do** present technical questions to me for ambiguous code. Don't proceed until you understand fully.

## Workflow

1. **Research** - Gather context (see [research.md](research.md))
2. **Context** - Determine review context using repository visibility. Private repositories use [corporate](references/corporate.md) defaults. Public repositories use [open-source](references/open-source.md) defaults. Check visibility via the platform API (`gh api repos/OWNER/REPO --jq .visibility` or `glab api projects/ENCODED_PATH | jq .visibility`). If ambiguous, ask me.
3. **Review** - Examine changed files and existing comments
4. **Delegate** - Run `/code-review` for code-quality analysis. Summarize the diff (rough line count, files touched, sensitive areas) and signals from the PR body, propose an effort level with one-line reasoning, and confirm via `AskUserQuestion` before invoking. Skip the call entirely for trivial PRs (docs-only, dep bumps). Effort heuristics:
   - **low**: docs-only, dep bumps, config tweaks, trivial fixes (<50 lines)
   - **medium**: typical features or fixes, single module, ~50–500 lines
   - **high**: large refactors, multi-module, public API or schema changes, ~500–2000 lines
   - **xhigh**: security-sensitive (auth, payments, data access), breaking changes, migrations
   - **max**: rare — incident hotfix or change with extreme blast radius
5. **Think** - Evaluate against priorities (see [priorities.md](priorities.md)), incorporating `/code-review` findings
6. **Suggest** - Propose comments with revisions or issues
7. **Stage in Hunk** - Push proposed comments into a live Hunk session for me to revise locally (see [Hunk staging](#hunk-staging))
8. **Submit** - Read back the revised comments and submit as a batch review (Approve / Comment / Request Changes)

See [tone.md](tone.md) for comment style guidelines.

## Hunk staging

By default this skill uses Hunk to stage comments before they're posted. This skill assumes the `hunk-review` skill is loaded — it owns the CLI mechanics.

If the review is approve-with-no-comments, skip Hunk staging entirely and go straight to Submit.

1. **Find or request a session.** `hunk session list --json`. If none matches the PR's checkout, ask me to open one — usually `hunk diff <base>...HEAD` (e.g. `main...HEAD`) so the view matches the PR's diff. If I decline to use Hunk, fall back to posting directly via `mcp__github` / `glab`.
2. **Push proposed comments as a batch.** Build the `{"comments":[...]}` JSON payload, `Write` it to a temp file, then `hunk session comment apply --repo . --stdin < /tmp/hunk-batch.json`. Use a file rather than a pipe so the bash command starts with `hunk session` and matches the permission rule. One batch per review pass — not one shell call per comment.
3. **Hand control back.** Tell me the staged comments are ready and wait for me to revise them in the TUI (edit wording, drop notes I disagree with, add my own).
4. **Read back the final set.** When I say I'm done, run `hunk session comment list --repo .` and parse its output. That's the authoritative set to submit — do not re-use your original draft.
5. **Submit as a batch review** to GitHub or GitLab using the platform's review API (see [Service Support](#service-support)). After successful submission, clear the staging area: `hunk session comment clear --repo . --yes`.

Don't run `hunk diff` or `hunk show` yourself — those are interactive TUI commands for me.

## Service Support

For GitHub, submit the batched review via `mcp__github` PR review tools. For GitLab merge requests, load `gitlab:merge-request` for the review submission workflow and use `draft-note.ts submit` to publish draft notes with an optional summary and review decision (approve / request changes).
