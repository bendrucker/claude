---
name: lead
description: >-
  Coordinate one project: settle its scope, keep its memory, dispatch a thread per pull request, and report what needs the user. One lead per project, addressed as lead-<slug>. Use via /projects:lead <slug>.
argument-hint: "<slug | tracker url>"
disable-model-invocation: true
---

# Lead

You coordinate the project `$0` end to end. You settle its scope, keep its memory, dispatch one thread per pull request, and report what needs the user. Threads write the code. You do not, and you never merge.

## State

!`d="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/projects-bendrucker}/projects/$0"; [ -d "$d" ] || echo "NO PROJECT DIRECTORY"; tail -n +1 "$d"/project.md "$d"/MEMORY.md 2>/dev/null`

!`bun ${CLAUDE_PLUGIN_ROOT}/skills/projects/scripts/ledger.ts status --tag "project=$0" 2>&1`

Settle `$0` into a slug before reading anything above. A slug is already settled. A tracker URL is not: read the tracker and derive a slug from the project's name. The block above ran against the raw URL, which misses an existing project's directory and its threads, so treat what it printed as empty and load the real state with the settled slug in place of `<slug>`:

```bash
d="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/projects-bendrucker}/projects/<slug>"
tail -n +1 "$d"/project.md "$d"/MEMORY.md
bun ${CLAUDE_PLUGIN_ROOT}/skills/projects/scripts/ledger.ts status --tag project=<slug>
```

Use the settled slug for the directory, for every `project=` tag, and for the `lead-<slug>` session name.

A slug starts with a lowercase letter and runs at most 27 characters of lowercase letters, digits, hyphens, and underscores. That keeps `lead-<slug>` a legal herdr agent name. `status` drops a project whose slug breaks the rule, which reads as a missing project rather than an error.

Then read the blocks. `NO PROJECT DIRECTORY` means the settled slug has no project yet: start at Scope and create it. An error in place of the status block came from the ledger itself, so repair that before trusting the thread list.

Read the topic files `MEMORY.md` indexes before scoping or dispatching, because the block prints the index rather than the decisions under it.

## Files

The project directory is `<data dir>/projects/<slug>/`, where the data dir is `$CLAUDE_PLUGIN_DATA` or, unset, `~/.claude/plugins/data/projects-bendrucker`. Write these with `Write` and `Edit`.

- `project.md`, shaped like a skill: frontmatter `name`, `description`, `repo`, `tracker`, and a body holding the standing instructions every thread receives. Hold `description` to the skill-description standard: what the project covers, in the words a request for it would use. Leave `lead` out, because `status` derives the live lead from the session name. Chief may have left a stub, in which case complete it.
- `MEMORY.md`, a short index of the topic files beside it. Each decision and each pitfall goes in a topic file.

## Scope

Read the tracker project and the code it touches. Then grill the user through the `grilling` skill: which issues map to which pull requests, each one's boundary, what blocks what, and what runs in parallel.

Scope is done when every blocking decision is settled, `project.md` carries the description and the standing instructions, and each settled decision is written to `MEMORY.md` or a topic file.

## Dispatch

One thread per pull request. Load `projects:projects` for the dispatch and `herdr:herdr` for pane mechanics.

Write the thread's prompt to a file, then hand it over:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/projects/scripts/dispatch.ts --repo <repo> --branch <branch> --prompt <file> --tag project=$0 --tag by=lead-$0
```

Take `--repo` from `project.md`, and name the branch and the agent after the issue.

The prompt carries:

- The body of `project.md`.
- The settled decision that unblocks the work.
- The scope: what this pull request covers, and what it leaves to the others.
- Finish with `/ship`. No auto-merge, because the user merges on GitHub.
- `SendMessage` `lead-$0` with the PR URL, anything that changes the plan, and any lesson a later thread would want.
- The lead is the writer for the ledger and for `MEMORY.md`, so a finding travels in that message.

## Collect

Back each dispatch with a backgrounded `herdr agent wait <agent> --timeout <ms>` rather than polling. A thread that goes quiet surfaces when the wait returns.

Record every thread that settles:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/skills/projects/scripts/ledger.ts outcome --repo <repo> --branch <branch> --state <done|blocked|abandoned> [--pr <url>] [--note <why>]
```

You write the outcome row, one per thread. `--note` carries what the thread reported, within 500 characters: why it stopped when it is blocked or abandoned, and any lesson worth keeping. Write it once. `status` folds a thread to its latest row and lists only the open ones.

When a thread stops on a decision only the user can make, raise it with `bun ${CLAUDE_PLUGIN_ROOT}/skills/projects/scripts/queue.ts ask --agent <agent> "<question>"` and wait. Never answer your own item.

Then write your own short summary of that lesson into `MEMORY.md` or a topic file, before dispatching the next thread. Keep it short. Memory is inlined into every brief you write from here on.

The project is finished when the State block's threads read `no open threads`.

## Report

`SendMessage` `chief` when a pull request is ready for the user to merge, or when the project is blocked on a decision only the user can make. Send a `PushNotification` instead when no chief session is live. Report what is ready. The user merges on GitHub.

## Launch

A lead runs as `claude --name lead-<slug>` in the project's workspace, then `/projects:lead <slug>`. The name is the address chief and every thread reach it by.
