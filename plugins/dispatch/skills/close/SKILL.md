---
name: close
description: >-
  Use when the user says to close yourself, close your pane or tab, or that you're done, and when this session's agreed close point arrives. Closes this session's Rex or herdr pane and resumes the session in the background to watch an open pull request. Also closes a child pane this session dispatched.
argument-hint: "[--target <name>]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/close.ts:*)
---

# Close

Get a finished session out of the user's way without losing work. The pane closes. The worktree and branch stay on disk, where the nightly prune removes them once the PR merges. An open PR keeps a watcher: this same session, resumed in the background once its pane closes, that keeps CI green and conflicts resolved until the PR merges or closes.

## Context

- Session: `${CLAUDE_SESSION_ID}`

## Arguments

- `--target <name>`: close the pane of a session this one dispatched, by its dispatch `name`. Default: this session's own pane.

## The Close Question

Skills that reach a done-point point here: `dispatch:dispatch`, `ship`, and `pull-request:babysit`. When this session has no answer yet, ask once with `AskUserQuestion`: "Close this pane once the PR is open? This session keeps watching it in the background until it merges." Recommend yes. Remember the answer for the rest of the session and never ask twice. When the answer is yes and the PR is open, close.

## Close This Pane

1. Leave the worktree, branch, and any `tmp/` output in place, and make no extra commits.
2. Write a summary of one to three lines: what is done, and what is left on disk.
3. Find the open PR or MR for this branch.
4. Tell the user in one line that the pane is closing, and where the work continues.
5. Run `close.ts` as the last tool call of the session, as one plain command:
   - Open PR or MR: `bun ${CLAUDE_SKILL_DIR}/scripts/close.ts close --handoff --session ${CLAUDE_SESSION_ID} --pr <url> --summary "<summary>"`
   - No PR: `bun ${CLAUDE_SKILL_DIR}/scripts/close.ts close --session ${CLAUDE_SESSION_ID} --summary "<summary>"`

On success the command never returns, because closing the pane ends this session. When it returns, the pane is still open: report the error it printed and stop.

## Close a Child Pane

Run `bun ${CLAUDE_SKILL_DIR}/scripts/close.ts close --target <name>`. It refuses a pane this session did not dispatch. This session keeps running.

## Gotchas

- herdr refuses to close a pane whose workspace leads a group of linked worktree workspaces. `close.ts` reports it and leaves the pane for the user.
- herdr App terminals (`HC_TERMINAL_ID`) are not supported yet. `close.ts` says so, and the user closes the pane.

## Ledger

Every close appends a row to the dispatch ledger. `bun ${CLAUDE_SKILL_DIR}/scripts/close.ts report --left-behind` lists closed sessions that left uncommitted or unpushed work.

A handoff resumes the session from a detached `close.ts resume` process that waits for this session's `claude` to exit. It logs to `close-resume-<session>.log` in the dispatch data directory, and a resume that fails appends an `ended` row whose summary starts with `resume failed:`.
