---
name: review:self
description: |
  Self-review your own changes in a live tuicr session before committing or opening a PR. You annotate changed lines in the terminal and your comments come back to Claude as edits to apply. Replaces the difit web UI. Use for "review my changes", "self review", "let me look at the diff before committing".
argument-hint: "[staged | <commit-range> | HEAD]"
disable-model-invocation: true
allowed-tools:
  - Skill(review:tuicr)
  - Read
  - Edit
  - Bash(tuicr:*)
  - Bash(git:*)
  - Bash(jq:*)
---

# Self Review

I review my own changes in tuicr; you read my comments back and apply them. The live session is
the buffer: I annotate lines, you edit. Nothing lives in a hand-edited JSON file.

Load `review:tuicr` for session mechanics (discovery, launch, seeding, read-back, the ledger).
This skill is the inbound loop on it.

## Target

Default to the working tree. Override with $ARGUMENTS (`staged`, `main..HEAD`, `HEAD`).

## Loop

1. **Launch** via `review:tuicr`: open the target diff in a sibling tmux pane and capture the
   session `slug` from `tuicr review list`.
2. **Self-critique (optional)**: offer to flag your own concerns as agent comments first
   (`tuicr review add --username ...`), so I see your read alongside mine. Skip if I decline.
3. **Hand off**: I add comments at lines (the `c` key) in the tuicr pane.
   - **Batch**: I tell you when I am done.
   - **Live**: if I ask to work as I go, arm monitor mode (`review:tuicr` Monitor section) and
     act on each comment as it lands, holding the edits for my review.
4. **Collect**: `tuicr review comments --repo <repo> --session <slug>`.
5. **Apply**: for each comment, read the referenced file and lines, then make the edit. tuicr
   reloads the diff as you go.
6. **Resolve, don't delete**: mark each applied comment resolved with `review:tuicr`'s ledger CLI
   (`ledger.ts resolve <id> --action ...`), keyed by the tuicr comment `id`. Sync the current
   comments with `ledger.ts upsert` first, and use `ledger.ts list --open` to report what remains.
   `review:tuicr`'s Reconciliation section explains why resolution state lives in the ledger.
7. **Repeat** until I say done, then summarize what changed and what is still open (from the
   ledger).

## Guidelines

- Apply comments in file order, asking before any change that is ambiguous or that you would push back on (per `review:tuicr`).
- A comment you disagree with stays open: leave it and tell me why rather than resolving it.
- When done, offer next steps (commit, peer review, PR) without taking them.
