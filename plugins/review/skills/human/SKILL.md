---
name: review:human
description: >-
  Request Ben's own review of the working diff or a document before it leaves the machine, for architecture and slop rather than bugs. Runs after the mechanical passes (code-review or simplify, comments:audit). Use for "get my review", "let me look at this first", or as the last pre-PR pass.
argument-hint: "[--doc <file>] [--kind <kind>] [--base <ref>] [--app hunk|plannotator] [--batch] [--browser] [--summary <text>]"
allowed-tools:
  - "Bash(bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts:*)"
  - Bash(rex do review_reply:*)
  - "Bash([:*)"
  - Bash(printf:*)
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
| Rex | plannotator-tui split. Follow Request. Hunk with `--app hunk`: follow Request, then Rex Live Notes unless `--batch` | plannotator-tui split with Approve. Follow Request |
| none, or `--browser` | Follow Browser Gate | Follow Browser Gate |

In a cloud session, where Plannotator's browser can't reach Ben, name what to review and end the turn instead.

## Precondition

Request after the mechanical passes have run. On an unreviewed diff, say so in the `--summary` text rather than running them here.

## Request

1. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts raise --kind <kind> --summary "<repo> <branch>: <what to review>"`. The kind is `code` for the diff and `doc` for a document, unless the caller passes a more specific `--kind` (`plan`, `pr-body`). A caller's `--kind` and `--summary` pass through verbatim. Outside herdr it is a no-op.
2. `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts open --diff`, adding `--base <ref>` when the caller resolved one and `--app` and `--batch` when given, or `open --doc <file>` for a document. Under herdr, `open --diff` re-uses a reviewr sidebar already up over this working tree, and `open --doc` reloads the plannotator-tui pane it opened earlier for the same file, keeping Ben's annotations.
3. For a Hunk review under Rex without `--batch`, start `bun ${CLAUDE_PLUGIN_ROOT}/scripts/attention.ts watch` with `Monitor` at `timeout_ms: 1800000`.
4. End the turn with one line naming the surface and saying how notes arrive: `E` in plannotator-tui, each saved note for live Hunk, Send otherwise. Leave out any recap of the change. reviewr and plannotator-tui deliver into this pane once it is idle, so Send lands only after the turn ends.

## Resume

With herdr, the next user turn holds the comment batch plus Ben's own remarks. Each block is a `path:lines` header, the verbatim snippet, and his text, as the herdr plugin's `skills/herdr/references/reviewr.md` details. Act on all of it. Sending cleared reviewr's store, so the batch in the turn is the only copy. This plugin's `UserPromptSubmit` hook has already cleared the pane label.

With plannotator-tui, the next user turn holds its feedback, a heading per file and per note. Act on all of it. Its Approve on a document ends the review.

With Hunk under Rex, the next turn starts with its kind. On `[review: changes]`, follow the message's instructions and end the turn, and the review continues. `[review: approved]` and `[review: dismissed]` both end the review.

Until Ben says approve, ship, or no further comments, act on the batch and request again. When he does, run `attention.ts close --diff`, or `close --doc <file>`, which quits the herdr split and is a no-op under Rex. Exit 2 means the surface stayed open holding unsent comments or a draft: tell Ben and leave it. Any other failure: relay its stderr to Ben.

## Rex Live Notes

Each `watch` event is one saved note, `[review: comment] <path:lines> (id <id>) | <quoted lines> | <body>`, where ` ⏎ ` stands for a newline. Answer each note with one of:

- a fix, with a reply that states the `path:line` you changed
- an answer to its question, with no edit
- a pushback, with the reason
- one clarifying question

Send the reply with `rex do review_reply id=<id> text="<reply>"` and end the turn. `[review: comment edited]` replaces an earlier note with the same id, so act on the new body. `[review: retracted]` withdraws a note: revert any change made only for it.

To walk Ben through the diff in Hunk or leave notes of your own there, load `hunk:review`.

`[review: closed] <outcome>` means the review ended and `watch` exited. When the monitor expires with the review still open, start `watch` again. A `[review: changes]` turn from Send carries only notes `watch` missed: handle it as Resume says.

## Browser Gate

1. `attention.ts raise --kind <kind> --summary "..."`
2. Load `plannotator:gate` and run its gate on the diff, passing `--base <ref>` when the caller resolved one, or on the file.
3. `attention.ts clear` after each gate returns.
4. Act on the decision as `plannotator:gate` says, until it reports approval or a startup error.
