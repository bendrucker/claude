---
name: review:self
description: |
  Self-review your own changes in a live Hunk session before committing or opening a PR. You annotate changed lines in the terminal and your comments come back to Claude as edits to apply. Replaces the difit web UI. Use for "review my changes", "self review", "let me look at the diff before committing". Supports a by-hand mode where Claude hands each comment back as an instruction and you apply the edits yourself, for changes you want to understand and remember ("guide me through the changes", "I'll apply the edits myself", "let me make the changes").
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

I review my own changes in Hunk; you read my comments back. The live session is the buffer: I
annotate lines, the comments come back as edits. Nothing lives in a hand-edited JSON file. By
default you apply the edits; in by-hand mode you guide me and I apply them myself.

Load `review:hunk` for all session mechanics (launch, seeding, read-back, the ledger). This
skill is the inbound loop on top of it.

## Target

Default to the working tree. Override with $ARGUMENTS (`staged`, `main...HEAD`, `HEAD`).

## Modes

Two loops over the same Hunk session. The setup is identical: target the diff, launch the
session, hand off, collect the comments, and keep the ledger. They differ only at apply time.

1. **Launch** via `review:hunk`: open the target diff in a sibling tmux pane with
   `--watch --agent-notes`.
2. **Self-critique (optional)**: offer to flag your own concerns as agent notes first, so I see
   your read alongside mine. Skip if I decline.
3. **Hand off**: I add comments at lines (the `c` key) in the Hunk pane.
   - **Batch**: I tell you when I am done.
   - **Live**: if I ask to work as I go, arm monitor mode (`review:hunk` Monitor section) and
     act on each comment as it lands, holding the applied edits for my review.
4. **Collect**: `hunk session comment list --type user --json`.

Then apply, in one of two modes:

#### Apply (default)

For each comment, read the referenced file and lines, then make the edit. `--watch` reloads the
diff as you go.

#### By-hand

I make the edits; you guide me. For each comment, in file order, tell me the file, the lines,
what to change, and why, as one concrete instruction. Then stop and wait. I make the edit; you
confirm it landed (the `--watch` reload shows it) before moving to the next. One comment at a
time. The friction is the point: I want to understand and remember each change, so never use
`Edit` here.

#### Resolve, don't delete

Mark each handled note resolved with `review:hunk`'s ledger CLI
(`ledger.ts resolve <noteId> --action ...`), keyed by `noteId`. The note stays visible and
nothing is lost. The ledger is the source of truth for open vs resolved, since `--watch`
orphans rather than resolves. Sync the current notes with `ledger.ts upsert` first, and use
`ledger.ts list --open` to report what remains. In by-hand mode, resolve only after I confirm I
applied the edit, recording "applied by hand".

Repeat until I say done, then summarize what changed and what is still open (from the ledger).

## Guidelines

- Apply comments in file order, but ask before any change that is ambiguous or that you would
  push back on.
- A note you disagree with stays open: leave it and tell me why rather than silently resolving
  it.
- In by-hand mode, never use `Edit`. If I stall, explain more, but do not apply the change for
  me.
- In by-hand mode, give me one comment at a time. Do not dump the full list.
- When done, offer next steps (commit, peer review, PR) without taking them unprompted.
