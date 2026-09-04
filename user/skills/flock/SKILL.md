---
name: flock
description: >-
  Coordinate every pane, worktree, and pull request open across the herdr server: merge what has cleared the bar, push back what has not, clean up what is finished, and report the rest. One flock per server. Use via /flock.
argument-hint: "[focus hint]"
disable-model-invocation: true
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/claim.sh)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/defer.sh:*)
  - AskUserQuestion
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
  - Bash(herdr agent prompt:*)
  - Bash(herdr agent focus:*)
  - Bash(herdr pane read:*)
  - Bash(herdr workspace list:*)
  - Bash(herdr workspace focus:*)
  - Bash(herdr workspace rename:*)
  - Bash(herdr workspace create:*)
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

Everything open across the herdr server is one board, and this pane holds it.

## State

!`bash ${CLAUDE_SKILL_DIR}/scripts/claim.sh`

`NO HERDR` means there is no server to coordinate. Say so and stop.

The `FLOCK` line is the singleton check, and only one flock runs per server:

- `OK`: this pane is the flock. Sweep.
- `ELSEWHERE`: another workspace already holds it. `herdr workspace focus` that ID, tell the user where it went, and stop. Do not sweep from here.
- `UNCLAIMED`: no workspace is labelled `flock`. Rename this workspace to `flock` if it holds nothing else, then sweep. Otherwise create one, tell the user to run `/flock` there, and stop. A pane carries the workspace it launched in, so moving this one would leave the next load reading `ELSEWHERE` against the workspace it just claimed.

The board below it is a skeleton. It carries panes, worktrees, branches, PR numbers, and local flags. It carries no CI state and no review scores, so fetch those only for rows with a PR.

An `incomplete:` line above the board names a repo whose lookup failed. A `?` in a PR column means `gh pr list` failed, so re-run it there. A missing-worktrees warning means that repo contributed no rows at all, so run `git worktree list` yourself before concluding it is clean, and a missing-default-branch warning means its merged flags are absent. Dispose of nothing in a repo whose retry also fails. Report it instead.

Weight the sweep toward whatever `$ARGUMENTS` names: a repo, a workspace, a branch.

## Boundary

You own the terminal and the forge. The pane owns the working tree.

Merge PRs, close panes, close workspaces, remove worktrees, prune branches. Never edit a file, commit, rebase, push, or resolve a conflict. Work inside a repository goes back to the pane that owns it, even when the fix is one line and the pane is slow.

Where a workspace runs its own `/lead`, that lead is the only agent you talk to there. It holds ordering and blockers you cannot see, so prompting a pane behind its lead produces two agents rebasing one branch. Address a workspace with no lead directly.

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

**Push back.** Bar not met and a pane owns it. Prompt that pane with the evidence. Use `herdr agent wait` followed by `herdr agent read` rather than polling when you intend to collect the result this run.

**Clean up.** Branch merged, tree clean, no live agent. Remove the worktree, close its workspace and panes, prune the branch. A pane cannot close its own workspace without killing itself mid-command.

**Report.** Everything else. Dirty trees, unpushed commits, PRs in repos you do not own, agents parked on an approval dialog, repos whose lookup failed twice. Never remove a worktree carrying uncommitted or unpushed work.

A healthy row mid-flight gets none of the four. An agent working a fresh branch with no PR and no flags is not stuck, and prompting it interrupts the work. Skip it.

Merging, removing a worktree, closing a workspace, and pruning a branch all sit outside the pre-approved set, so each stops at the permission gate. The sweep proposes disposals and the user lets them through.

Check every row against the deferred keys before assigning it a disposition. A deferred row is held, not swept, unless the state block re-raised it as stale.

An orphan row with no pane is the point of the sweep: a branch merged weeks ago whose checkout is still on disk, or a worktree carrying commits that were never pushed.

A pane parked on an approval dialog is the user's to answer. Read it, `herdr agent focus` it so the dialog is in front of them, and say what it is asking. Do not answer it.

## Close

Close with the board, one line per row, and a count of what changed:

```
3 merged · 4 pushed back · 6 cleaned up · 2 need you
```

Then batch every decision into `AskUserQuestion`. Ask about the ones that are actually yours to raise: a PR green but stuck below a bar it cannot reach, a dirty worktree you cannot judge, an agent blocked on something outside the repo.

Between prompts, do nothing. `/loop 20m /flock` is how the user makes this proactive.

## Deferrals

A row the user says to leave alone is recorded by key, either a worktree or a branch:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/defer.sh redesign "still working it"
bash ${CLAUDE_SKILL_DIR}/scripts/defer.sh --drop redesign
```

The state block lists the keys and adds a re-raise line for every entry older than 14 days. Record the reason in the user's own words. Drop the entry once the work lands.
