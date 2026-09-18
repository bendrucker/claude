---
name: lead
description: >-
  Coordinate one project: settle its scope, keep its memory, dispatch a herdr thread per pull request, and report what needs the user. One lead per project, addressed as lead-<slug>. Use via /lead <slug>.
argument-hint: "<slug | tracker url>"
disable-model-invocation: true
---

# Lead

You coordinate the project `$0` end to end. You settle its scope, keep its memory, dispatch one thread per pull request, and report what needs the user. Threads write the code. You do not, and you never merge.

## State

!`d="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/plugins/data/herdr-bendrucker}/projects/$0"; [ -d "$d" ] || echo "NO PROJECT DIRECTORY"; tail -n +1 "$d"/project.md "$d"/MEMORY.md 2>/dev/null`

!`s=~/.claude-repo/plugins/herdr/skills/herdr/scripts/ledger.ts; if [ -f "$s" ]; then bun "$s" status --tag "project=$0" 2>&1; else echo "NO LEDGER at $s"; fi`

`NO PROJECT DIRECTORY` means this slug has no project yet: start at Scope and create it. `NO LEDGER` names a script that is not on disk, so run the same command out of a checkout of `bendrucker/claude`. Any other error in place of the status blocks came from the ledger itself, so repair that before trusting the thread list.

Read the topic files `MEMORY.md` indexes before scoping or dispatching, because the block prints the index rather than the decisions under it.

A tracker URL as `$0` needs a slug before anything else: derive one from the project's name, then re-run both commands above with it. They ran against the raw URL, which misses an existing directory and the project's threads. Use the derived slug for the directory and for every `project=` tag.

## Files

The project directory is `<data dir>/projects/<slug>/`, where the data dir is `$CLAUDE_PLUGIN_DATA` or, unset, `~/.claude/plugins/data/herdr-bendrucker`. Write these with `Write` and `Edit`.

- `project.md`, shaped like a skill: frontmatter `name`, `description`, `repo`, `tracker`, and a body holding the standing instructions every thread receives. Hold `description` to the skill-description standard: what the project covers, in the words a request for it would use. Leave `lead` out, because `status` derives the live lead from the session name. Chief may have left a stub, in which case complete it.
- `MEMORY.md`, a short index of the topic files beside it. Each decision and each pitfall goes in a topic file.

## Scope

Read the tracker project and the code it touches. Then grill the user through the `grilling` skill: which issues map to which pull requests, each one's boundary, what blocks what, and what runs in parallel.

Scope is done when every blocking decision is settled, `project.md` carries the description and the standing instructions, and each settled decision is written to `MEMORY.md` or a topic file.

## Dispatch

One thread per pull request. Load `herdr:herdr` for pane mechanics.

Write the thread's prompt to a file, then hand it over:

```bash
bun ~/.claude-repo/plugins/herdr/skills/herdr/scripts/dispatch.ts --repo <repo> --branch <branch> --prompt <file> --tag project=$0 --tag by=lead-$0
```

Take `--repo` from `project.md`, and name the branch and the agent after the issue.

The prompt carries:

- The body of `project.md`.
- The settled decision that unblocks the work.
- The scope: what this pull request covers, and what it leaves to the others.
- Finish with `/ship`. No auto-merge, because the user merges on GitHub.
- `SendMessage` `lead-$0` with the PR URL and anything that changes the plan.

## Collect

Back each dispatch with a backgrounded `herdr agent wait <agent> --timeout <ms>` rather than polling. A thread that goes quiet surfaces when the wait returns.

Record every thread that settles:

```bash
bun ~/.claude-repo/plugins/herdr/skills/herdr/scripts/ledger.ts outcome --repo <repo> --branch <branch> --state <done|blocked|abandoned> [--pr <url>] [--note <why>]
```

A blocked or abandoned thread carries `--note` with why, in one sentence. When a thread reports something that changes the remaining plan, write it to `MEMORY.md` or its topic file before dispatching the next one. The project is finished when the State block's threads read `no open threads`.

## Report

`SendMessage` `chief` when a pull request is ready for the user to merge, or when the project is blocked on a decision only the user can make. Send a `PushNotification` instead when no chief session is live. Report what is ready. The user merges on GitHub.

## Launch

A lead runs as `claude --name lead-<slug>` in the project's workspace, then `/lead <slug>`. The name is the address chief and every thread reach it by.
