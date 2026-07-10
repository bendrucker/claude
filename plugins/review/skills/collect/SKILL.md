---
name: review:collect
description: >
  Pick up inbound review comments the user has already left in a running tuicr self-review
  session and run the apply-and-reconcile loop. Use when the user announces mid-task that their
  review is done and there are comments to collect: "I left review comments", "I finished my
  review", "I put in my complaints", "go pick up my tuicr comments", "I'm done reviewing, apply
  them". The model-invocable entry into review:self's inbound loop against an already-open
  session: review:self launches a fresh one, this attaches to the existing one. Not for reviewing
  a peer's PR (review:peer) or starting a self-review from scratch (review:self).
allowed-tools:
  - Skill(review:self)
  - Skill(review:tuicr)
---

# Collect Review Comments

The user has left inline comments in a running tuicr self-review session and wants them picked up.
This is the model-invocable bridge into `review:self`'s inbound loop: a session already exists, so
attach to it rather than launching a new one.

1. **Attach**: load `review:tuicr` Session Discovery and resolve the active session `slug`
   (`tuicr review list --repo .`). If none is active or the match is ambiguous, ask for the slug.
2. **Run the inbound loop**: run `review:self`'s apply loop (collect, apply, reconcile) against
   that session, skipping its launch, self-critique, and hand-off steps since the comments already
   exist. Read back with `tuicr review comments`, apply each comment as an edit, and record
   resolutions in the ledger by comment `id` (`ledger.ts`) rather than deleting.
3. **Report** what changed and what stays open (`ledger.ts list --open`).
