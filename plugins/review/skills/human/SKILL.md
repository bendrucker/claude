---
name: review:human
description: >-
  Request Ben's own review of the working diff or a document before it leaves the machine, for architecture and slop rather than bugs. Runs after the mechanical passes (review:code or simplify, comments:audit). Use for "get my review", "let me look at this first", or as the last pre-PR pass.
argument-hint: "[--doc <file>] [--browser] [--summary <text>]"
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts:*)"
  - Bash(plannotator review:*)
  - Bash(plannotator annotate:*)
---

# Human Review

Put the change in front of Ben and act on what comes back. `attention.ts` labels the herdr pane `review`, sets its `$review` token, and raises a toast. Outside herdr, `raise` and `clear` are no-ops and `open` exits 1.

## Context

- herdr pane: !`[ "$HERDR_ENV" = 1 ] && printf %s "${HERDR_PANE_ID:-none}" || printf none`

## Modes

| Mode | Surface | Turn |
|---|---|---|
| Terminal (default), diff | reviewr sidebar over the working diff | Ends. Comments arrive as the next user turn |
| Terminal (default), `--doc <file>` | plannotator-tui over the file | Ends. Annotations arrive as the next user turn |
| `--browser`, diff | `plannotator review --git --json [--base <ref>]` | Blocks. The decision is the tool result |
| `--browser`, `--doc <file>` | `plannotator annotate <file> --gate --json --require-approval` | Blocks. The decision is the tool result |

Terminal surfaces open as a split beside this pane, named explicitly and without taking focus, and deliver into it once it is idle. So the turn has to end before Send can land. They need the herdr pane above. When it reads `none`, run the gate as if `--browser` were passed.

## Precondition

Request after the mechanical passes have run. `/ship` orders them. Standalone on an unreviewed diff, say so in the `--summary` text rather than running them here.

## Request

1. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts raise --summary "<repo> <branch>: <what to review>"`. A caller's `--summary` passes through verbatim.
2. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts open --diff`, or `open --doc <file>` for a document. `open --diff` re-uses a reviewr sidebar already up over this working tree.
3. End the turn with exactly one line naming the surface and that Send resumes the work. The surface shows the change. The line carries no recap.

## Resume

The next user turn carries the comment batch plus Ben's own remarks. Each block is a `path:lines` header, the verbatim snippet, and his text. The herdr plugin's `skills/herdr/references/reviewr.md` covers the shape in full. Act on all of it. Sending cleared reviewr's store. The batch in the turn is the only copy. This plugin's `UserPromptSubmit` hook has already cleared the pane label.

The review ends when Ben says approve, ship, or no further comments. Otherwise act on the batch and request again.

## Gate

With `--browser`:

1. `attention.ts raise --summary "..."`
2. `plannotator review --git --json`, adding `--base <ref>` when the caller resolved one, or `plannotator annotate <file> --gate --json --require-approval`
3. `attention.ts clear`
4. Act on the decision. `approved` ends the review. `annotated` means act on the annotations and run the gate again. `dismissed`, or exit 1 from the annotate gate, means not approved: fold the feedback in and run the gate again. Exit 2 is a startup error: report it and stop.
