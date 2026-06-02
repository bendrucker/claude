---
name: review:self
description: |
  Self-review your own changes in a live Hunk session before committing or opening a PR. You annotate changed lines in the terminal and your comments come back to Claude as edits to apply. Replaces the difit web UI. Use for "review my changes", "self review", "let me look at the diff before committing".
disable-model-invocation: true
allowed-tools:
  - Skill(review:hunk)
  - Read
  - Edit
  - Bash(hunk:*)
  - Bash(git:*)
  - Bash(jq:*)
---

# Self Review

I review my own changes in Hunk; you read my comments back and apply them. The live session is
the buffer: I annotate lines, you edit. Nothing lives in a hand-edited JSON file.

Load `review:hunk` for all session mechanics (launch, seeding, read-back, the ledger). This
skill is the inbound loop on top of it.

## Target

Default to the working tree. Override with $ARGUMENTS (`staged`, `main...HEAD`, `HEAD`).

## Loop

1. **Launch** via `review:hunk`: open the target diff in a sibling tmux pane with
   `--watch --agent-notes`.
2. **Self-critique (optional)**: offer to flag your own concerns as agent notes first, so I see
   your read alongside mine. Skip if I decline.
3. **Hand off**: I add comments at lines (the `c` key) in the Hunk pane.
   - **Batch**: I tell you when I am done.
   - **Live**: if I ask to work as I go, arm monitor mode (`review:hunk` Monitor section) and
     act on each comment as it lands, holding the applied edits for my review.
4. **Collect**: `hunk session comment list --type user --json`.
5. **Apply**: for each comment, read the referenced file and lines, then make the edit.
   `--watch` reloads the diff as you go.
6. **Resolve, don't delete**: mark each applied note resolved with `review:hunk`'s ledger CLI
   (`ledger.ts resolve <noteId> --action ...`), keyed by `noteId`. The note stays visible and
   nothing is lost. The ledger is the source of truth for open vs resolved, since `--watch`
   orphans rather than resolves. Sync the current notes with `ledger.ts upsert` first, and use
   `ledger.ts list --open` to report what remains.
7. **Repeat** until I say done, then summarize what changed and what is still open (from the
   ledger).

## Guidelines

- Apply comments in file order, but ask before any change that is ambiguous or that you would
  push back on.
- A note you disagree with stays open: leave it and tell me why rather than silently resolving
  it.
- When done, offer next steps (commit, peer review, PR) without taking them unprompted.
