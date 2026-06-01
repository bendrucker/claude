---
name: review:self
description: |
  Self-review your own code changes using Hunk. You annotate lines in the Hunk TUI; Claude reads your comments via `hunk session comment list` and applies the requested edits.
disable-model-invocation: true
allowed-tools:
  - "Bash(hunk session:*)"
---

# Self Review

Apply your own review notes to a working tree. You drive the review in Hunk; Claude reads your annotations and edits the code.

This skill assumes the `hunk-review` skill is loaded — it owns the CLI mechanics (session selection, navigation, comment commands). This skill only covers the self-review-specific flow.

## Workflow

1. **Make sure Hunk is running.** Run `hunk session list --json` to find a live session for the current repo. If none, ask the user to open one in their terminal:
   - `hunk diff` — uncommitted changes (staged + unstaged + untracked)
   - `hunk diff --exclude-untracked` — tracked changes only
   - `hunk diff main...HEAD` — branch changes vs. main
   - `hunk show HEAD` — the latest commit
2. **Wait for the user to finish annotating.** Do not poll. Let the user say they're done before reading comments.
3. **Read their notes.** `hunk session comment list --repo .`. The author is the user, not the agent — these are change requests, not narration.
4. **Apply each comment.** For every entry:
   - Read the referenced file at the indicated line(s)
   - Make the requested change with Edit
   - Remove the comment after applying: `hunk session comment rm --repo . <comment-id>`. Leave it in place only if the user asked you to skip or push back — so the remaining comments at the end represent unresolved feedback.
5. **Summarize what you changed** and what (if anything) you skipped or want to push back on.

## Notes

- Don't run `hunk diff` or `hunk show` yourself — those are interactive TUI commands for the user. Only `hunk session *` subcommands are for Claude.
- If a comment is ambiguous, ask before editing rather than guessing.
- If you disagree with a requested change, say so instead of silently applying or skipping it.
