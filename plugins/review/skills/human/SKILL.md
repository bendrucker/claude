---
name: review:human
description: >-
  Request Ben's own review of the working diff or a document before it leaves the machine, for architecture and slop rather than bugs. Runs after the mechanical passes (code-review or simplify, comments:audit). Use for "get my review", "let me look at this first", or as the last pre-PR pass.
argument-hint: "[--doc <file>] [--kind <kind>] [--base <ref>] [--browser] [--summary <text>]"
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts:*)"
  - Bash(rex do review_reply:*)
  - Bash(plannotator review:*)
  - Bash(plannotator annotate:*)
---

# Human Review

Put the change in front of Ben and act on what comes back until he approves.

## Context

- herdr pane: !`[ "$HERDR_ENV" = 1 ] && printf %s "${HERDR_PANE_ID:-none}" || printf none`
- Rex block: !`printf %s "${REX_BLOCK:-none}"`

## Routing

The host is herdr when the herdr pane is set, else Rex when the Rex block is set, else none. `attention.ts open` reads the same environment and picks the surface itself.

| Host | Diff | `--doc <file>` |
|---|---|---|
| herdr | reviewr split. Follow Request | plannotator-tui split. Follow Request |
| Rex | Hunk split. Follow Request | plannotator-tui split, gated. Follow Rex Document Gate |
| none, or `--browser` | Follow Browser Gate | Follow Browser Gate |

In a cloud session, where Plannotator's browser can't reach Ben, name what to review and end the turn instead.

## Precondition

Request after the mechanical passes have run. `/ship` orders them. Standalone on an unreviewed diff, say so in the `--summary` text rather than running them here.

## Request

1. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts raise --kind <kind> --summary "<repo> <branch>: <what to review>"`. The kind is `code` for the diff and `doc` for a document, unless the caller passes a more specific `--kind` (`plan`, `pr-body`). A caller's `--kind` and `--summary` pass through verbatim. Outside herdr it is a no-op.
2. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts open --diff`, adding `--base <ref>` when the caller resolved one, or `open --doc <file>` for a document. Under herdr, `open --diff` re-uses a reviewr sidebar already up over this working tree, and `open --doc` reloads the plannotator-tui pane it opened earlier for the same file, keeping Ben's annotations.
3. End the turn with one line naming the surface and saying Send resumes the work, with no recap of the change. reviewr and plannotator-tui deliver into this pane once it is idle, so Send lands only after the turn ends.

## Resume

With herdr, the next user turn holds the comment batch plus Ben's own remarks. Each block is a `path:lines` header, the verbatim snippet, and his text, as the herdr plugin's `skills/herdr/references/reviewr.md` details. Act on all of it. Sending cleared reviewr's store, so the batch in the turn is the only copy. This plugin's `UserPromptSubmit` hook has already cleared the pane label.

With Rex, the next turn starts with its kind. On `[review: changes]`, follow the message's instructions and end the turn, and the review continues. `[review: approved]` and `[review: dismissed]` both end the review.

Until Ben says approve, ship, or no further comments, act on the batch and request again. When he does, run `attention.ts close --diff`, or `close --doc <file>`, which quits the herdr split and is a no-op under Rex. Exit 2 means the surface stayed open holding unsent comments or a draft: tell Ben and leave it. Any other failure: relay its stderr to Ben.

## Rex Document Gate

`open --doc` under Rex opens plannotator-tui in a split right of this block, taking three quarters of its width, and blocks until Ben quits it, which can outlast the Bash timeout.

1. Run `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts open --doc <file>` with `run_in_background: true`.
2. End the turn with one line saying the review is open right of this pane and its decision resumes the work.
3. When the task completes, its output is `{"decision": ..., "feedback": ...}`. `approved` ends the review. Any other decision means fold the feedback's annotations in and run the gate again. Exit 2 means plannotator-tui exited without writing a decision: report its stderr and stop.

## Browser Gate

1. `attention.ts raise --kind <kind> --summary "..."`
2. `plannotator review --git --json`, adding `--base <ref>` when the caller resolved one, or `plannotator annotate <file> --gate --json --require-approval`
3. `attention.ts clear`
4. Act on the decision. `approved` ends the review. `annotated` means act on the annotations and run the gate again. `dismissed`, or exit 1 from the annotate gate, means not approved: fold the feedback in and run the gate again. Exit 2 is a startup error: report it and stop.
