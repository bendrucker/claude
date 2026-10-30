---
name: review:human
description: >-
  Request Ben's own review of the working diff or a document before it leaves the machine, for architecture and slop rather than bugs. Runs after the mechanical passes (code-review or simplify, comments:audit). Use for "get my review", "let me look at this first", or as the last pre-PR pass.
argument-hint: "[--doc <file>] [--kind <kind>] [--browser] [--summary <text>]"
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts:*)"
  - Bash(rex run:*)
  - Bash(tuicr review:*)
  - Bash(plannotator review:*)
  - Bash(plannotator annotate:*)
---

# Human Review

Put the change in front of Ben and act on what comes back until he approves. `attention.ts` flags the herdr pane for review. Outside herdr, `raise` and `clear` are no-ops and `open` exits 1.

## Context

- herdr pane: !`[ "$HERDR_ENV" = 1 ] && printf %s "${HERDR_PANE_ID:-none}" || printf none`
- Rex block: !`printf %s "${REX_BLOCK:-none}"`

## Modes

| Mode | Surface | Turn |
|---|---|---|
| Terminal (default), diff | reviewr sidebar over the working diff | Ends. Comments arrive as the next user turn |
| Terminal (default), `--doc <file>` | plannotator-tui over the file | Ends. Annotations arrive as the next user turn |
| `--browser`, diff | `plannotator review --git --json [--base <ref>]` | Blocks. The decision is the tool result |
| `--browser`, `--doc <file>` | `plannotator annotate <file> --gate --json --require-approval` | Blocks. The decision is the tool result |

Terminal surfaces open as a split beside this pane and deliver into it once it is idle, so the turn has to end before Send can land. They need the herdr pane above. When it reads `none` and the Rex block is set, a diff review runs the Rex gate below, and a document review takes `--browser`. With neither, run the gate as if `--browser` were passed. In a cloud session, where Plannotator's browser can't reach Ben, name what to review and end the turn instead.

## Precondition

Request after the mechanical passes have run. `/ship` orders them. Standalone on an unreviewed diff, say so in the `--summary` text rather than running them here.

## Request

1. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts raise --kind <kind> --summary "<repo> <branch>: <what to review>"`. The kind is `code` for the diff and `doc` for a document, unless the caller passes a more specific `--kind` (`plan`, `pr-body`). A caller's `--kind` and `--summary` pass through verbatim.
2. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts open --diff`, or `open --doc <file>` for a document. `open --diff` re-uses a reviewr sidebar already up over this working tree. `open --doc` reloads the plannotator-tui pane it opened earlier for the same file, keeping Ben's annotations.
3. End the turn with one line naming the surface and saying Send resumes the work, with no recap of the change.

## Resume

The next user turn carries the comment batch plus Ben's own remarks. Each block is a `path:lines` header, the verbatim snippet, and his text, as the herdr plugin's `skills/herdr/references/reviewr.md` details. Act on all of it. Sending cleared reviewr's store, so the batch in the turn is the only copy. This plugin's `UserPromptSubmit` hook has already cleared the pane label.

Until Ben says approve, ship, or no further comments, act on the batch and request again. The review is done when he does: then run `attention.ts close --diff`, or `close --doc <file>` for a document, which quits the surface. Exit 2 means the surface stayed open holding unsent comments or a draft: tell Ben and leave it. Any other failure: relay its stderr to Ben.

## Gate

With `--browser`:

1. `attention.ts raise --kind <kind> --summary "..."`
2. `plannotator review --git --json`, adding `--base <ref>` when the caller resolved one, or `plannotator annotate <file> --gate --json --require-approval`
3. `attention.ts clear`
4. Act on the decision. `approved` ends the review. `annotated` means act on the annotations and run the gate again. `dismissed`, or exit 1 from the annotate gate, means not approved: fold the feedback in and run the gate again. Exit 2 is a startup error: report it and stop.

## Rex Gate

1. Note the comment IDs from `tuicr review comments --session <path>` for each session `tuicr review list --repo "$PWD"` prints.
2. With `run_in_background: true`, run `rex run --block "$REX_BLOCK" --split=right --focus=false --cwd "$PWD" --wait -- tuicr -w`, adding `-r <base>..HEAD` when the caller resolved a base. End the turn with one line saying quitting tuicr resumes the work.
3. When it completes, read the comments again. Those with IDs absent from step 1 are the feedback: act on them and run the gate again. No new comments means approved.
