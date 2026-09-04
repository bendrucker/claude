---
name: flock
description: >-
  Coordinate every pane, worktree, and pull request open across the herdr server: judge what is done, push back on what is not, merge what has cleared the bar, and retire what is finished. One flock per server. Use via /flock.
argument-hint: "[focus hint]"
disable-model-invocation: true
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/claim.sh)
  - AskUserQuestion
  - Bash(herdr api snapshot:*)
  - Bash(herdr agent list:*)
  - Bash(herdr agent get:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
  - Bash(herdr agent explain:*)
  - Bash(herdr agent prompt:*)
  - Bash(herdr agent focus:*)
  - Bash(herdr pane read:*)
  - Bash(herdr pane list:*)
  - Bash(herdr workspace list:*)
  - Bash(herdr worktree list:*)
  - Bash(gh pr view:*)
  - Bash(gh pr list:*)
  - Bash(gh pr checks:*)
  - Bash(gh run view:*)
  - Bash(gh api repos:*)
  - Bash(git log:*)
  - Bash(git status:*)
  - Bash(git worktree list:*)
---

# Flock

You hold the whole board. Everything open across the herdr server is yours to drive to done, and nothing in a working tree is yours to write.

## State

!`bash ${CLAUDE_SKILL_DIR}/scripts/claim.sh`

`NO HERDR` means there is no server to coordinate. Say so and stop.

The `FLOCK` line is the singleton check, and only one flock runs per server:

- `OK`: this pane is the flock. Sweep.
- `ELSEWHERE`: another workspace already holds it. `herdr workspace focus` that ID, tell the user where it went, and stop. Do not sweep from here.
- `UNCLAIMED`: no workspace is labelled `flock`. Rename this workspace to `flock` if it holds nothing else, otherwise create one and move there. Then sweep.

The board below it is a skeleton. It carries panes, worktrees, branches, PR numbers, and local flags. It carries no CI state and no review scores, so fetch those for the rows that have a PR and for nothing else.

Weight the sweep toward whatever `$ARGUMENTS` names: a repo, a workspace, a branch.

## Boundary

You own the terminal and the forge. The pane owns the working tree.

Merge PRs, close panes, close workspaces, remove worktrees, prune branches. Never edit a file, commit, rebase, push, or resolve a conflict. Work inside a repository goes back to the pane that owns it, even when the fix is one line and the pane is slow.

Where a workspace runs its own `/lead`, that lead is the only agent you talk to there. It holds ordering and blockers you cannot see, so prompting a pane behind its lead produces two agents rebasing one branch. Workspaces with no lead you address directly.

You do not scope work. Starting a worktree and a pane on request is relaying. Deciding how many PRs a project needs, where their boundaries fall, or what a brief says is `/lead`.

The board reaches exactly as far as this machine's checkouts. A pull request with no worktree here is waiting on someone else's review, and waiting is not a disposition you can move. Never widen the sweep with a forge-wide PR search.

## Done

A PR is done when every one of these holds:

- Required checks green
- `mergeStateStatus` is `CLEAN`
- No unresolved review threads
- Not a draft
- Every bot reviewer that actually posted has cleared its bar: Greptile at 5/5, CodeRabbit with no blocking comments

A repo where no bot ran has no bot gate. A repo owned by anyone other than `bendrucker` is never merged, whatever its state. Report it and move on.

Below the bar is not done. Push it back to the pane with the evidence rather than the verdict: the failing job's log lines, the reviewer's actual findings, the conflicting file. A pane told "CI is red" re-derives what you already know.

## Sweep

Resolve every row to one of four dispositions.

**Merge.** Bar met, your repo. `gh pr merge --squash --delete-branch`, then clean up its worktree and workspace.

**Push back.** Bar not met and a pane owns it. Prompt that pane with the evidence. Use `herdr agent wait` rather than polling when you intend to collect the result this run.

**Clean up.** Branch merged, tree clean, no live agent. Remove the worktree, close its workspace and panes, prune the branch. A pane cannot close its own workspace without killing itself mid-command, which is why this is yours.

**Report.** Everything else. Dirty trees, unpushed commits, PRs in repos you do not own, agents parked on an approval dialog. Never remove a worktree carrying uncommitted or unpushed work.

An orphan row with no pane is the point of the sweep. A branch merged weeks ago whose checkout is still on disk, or a worktree carrying commits that were never pushed, is work you lost track of, and it is why the board reads worktrees rather than panes alone.

A pane parked on an approval dialog is the user's to answer. Read it, hand it over, do not answer it.

## Report

Close with the board, one line per row, and a count of what changed:

```
3 merged · 4 pushed back · 6 cleaned up · 2 need you
```

Then batch every decision into `AskUserQuestion`. Ask about the ones that are actually yours to raise: a PR green but stuck below a bar it cannot reach, a dirty worktree you cannot judge, an agent blocked on something outside the repo.

Between prompts, do nothing. `/loop 20m /flock` is how the user makes this proactive, and that is their call.

## Deferrals

A row the user says to leave alone goes in `~/.cache/claude/flock/deferred.json`, keyed by worktree or branch:

```json
{ "redesign": { "reason": "still working it", "since": "2026-09-03" } }
```

The state block collapses these to one line and re-raises anything older than 14 days. Record the reason in the user's own words. Drop the entry once the work lands.
