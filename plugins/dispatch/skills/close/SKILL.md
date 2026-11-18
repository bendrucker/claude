---
name: close
description: >-
  Use when the user says to close yourself, close your pane or tab, or that you're done, and when your dispatch prompt says to close once the PR is open. Closes this session's Rex or herdr pane and resumes the session in the background to watch an open pull request, or minimizes the pane while CI is still running. Also closes a child pane this session dispatched.
argument-hint: "[--target <name>]"
allowed-tools:
  - Bash(claude-dispatch-close:*)
---

# Close

Get a finished session out of the user's way without losing work. The pane closes. The worktree and branch stay on disk, where the nightly prune removes them once the PR merges. An open PR keeps a watcher: this same session, resumed in the background once its pane closes, that keeps CI green and conflicts resolved until the PR merges or closes.

## Context

- Session: `${CLAUDE_SESSION_ID}`

## Arguments

- `--target <name>`: close the pane of a session this one dispatched, by its dispatch `name`. Default: this session's own pane.

## Close This Pane

1. Leave the worktree, branch, and any `tmp/` output in place, and make no extra commits.
2. Write a summary of one to three lines: what is done, and what is left on disk.
3. Find the open PR or MR for this branch, and read its CI with `gh pr checks <url>` or `glab ci status`.
4. Tell the user in one line what happens to the pane, and where the work continues.
5. Run the command for the branch's condition, as one plain command:
   - No PR or MR: `claude-dispatch-close close --session ${CLAUDE_SESSION_ID} --summary "<summary>"`
   - Every check passed: `claude-dispatch-close close --handoff --session ${CLAUDE_SESSION_ID} --pr <url> --summary "<summary>"`
   - A check pending or failing: `claude-dispatch-close park --session ${CLAUDE_SESSION_ID} --pr <url> --summary "<summary>"`, then continue under Parked.

`close` is the last tool call of the session. On success it never returns, because closing the pane ends this session. When it returns, the pane is still open: report the error it printed and stop. When `park` refuses, run the command its error names.

## Parked

`park` minimizes the pane, and this session keeps running.

1. Run `pull-request:babysit <url>` in this session.
2. Once every check passes, run the `close --handoff` command above.
3. When a failure needs the user's judgment, run `claude-dispatch-close restore --session ${CLAUDE_SESSION_ID}`, then ask with `AskUserQuestion`.

## Close a Child Pane

Run `claude-dispatch-close close --target <name>`. It refuses a pane this session did not dispatch. This session keeps running.

## Gotchas

- herdr refuses to close a pane whose workspace leads a group of linked worktree workspaces. `close.ts` reports it and leaves the pane for the user.
- herdr App terminals (`HC_TERMINAL_ID`) are not supported yet. `close.ts` says so, and the user closes the pane.
- `park` works in Rex only, and in a Rex tab with another visible pane.

## Ledger

Every close and park appends a row to the dispatch ledger. `claude-dispatch-close report --count` counts them per event. `claude-dispatch-close report --left-behind` lists closed sessions that left uncommitted or unpushed work. A failed handoff resume logs to `close-resume-<session>.log` in the dispatch data directory and appends an `ended` row whose summary starts with `resume failed:`.
