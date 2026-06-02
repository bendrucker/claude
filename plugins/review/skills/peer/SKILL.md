---
name: review:peer
description: |
  Review a pull request when requested by a peer. Use when reviewing PRs, providing code review feedback, or analyzing proposed changes. Supports GitHub and GitLab.
allowed-tools:
  - Bash(gh:*)
  - Bash(glab:*)
  - mcp__github
  - Skill(code-review)
  - Skill(review:hunk)
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
6. **Stage** - Open the PR diff in Hunk via `review:hunk` and seed proposed comments as agent notes. Capture the PR head SHA (and base/start SHAs for GitLab, from the MR `diff_refs`) for mapping. Skip staging entirely when approving with no comments.
7. **Revise** - I curate in the Hunk pane: delete notes I reject, reword, and add my own at any line. The surviving set is what gets posted.
8. **Map** - Read back the final set (`hunk session comment list --type all --json`) and map each note to a platform position with `review:hunk`'s mapping CLI (`mapping.ts map --platform <github|gitlab> --notes ... --diff ... --commit <sha>`). It runs the in-diff pre-check and returns `{ payloads, dropped }`; off-diff anchors land in `dropped` (GitHub rejects them with `422 "Line could not be resolved"`), so surface those to me rather than silently losing them.
9. **Submit** - Show me the mapped set, then on my go post as one batch and choose Approve / Comment / Request Changes based on severity. GitHub: a pending review submitted as a batch. GitLab: draft notes published together.

See [tone.md](tone.md) for comment style guidelines.

## Service Support

This skill assumes GitHub. For GitLab merge requests, load `gitlab:merge-request` for the submission workflow; use `draft-note.ts submit` to publish draft notes with an optional summary and review decision.

When Hunk is not running or I prefer to skip it, fall back to posting directly via `mcp__github` / `gh` / `glab`. On follow-up, resolution is native: resolve addressed threads on the platform (`review-threads.ts` for GitHub, the resolve flow in `gitlab:merge-request` for GitLab), not in Hunk.
