---
name: projects
description: >-
  Dispatch work to a sibling agent in its own worktree, record what each thread returned on the dispatch ledger, raise what needs Ben on the queue, and list the projects and open threads. Load this when handing a pull request's worth of work to another agent, when recording that a dispatched thread finished or blocked, when a decision is Ben's to make, when asking what is out and what came back, or when a request names a project, a lead, a thread, the queue, or the ledger.
argument-hint: "[status [--tag k=v] | outcome | dispatch | ask]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/board.ts:*)
---

# Projects

Everything here reads and writes the plugin data dir, `$CLAUDE_PLUGIN_DATA` or `~/.claude/plugins/data/projects-bendrucker`. The ledger is `dispatches.jsonl` there and the queue is `queue.jsonl`, both append-only and read at query time. Project directories are `projects/<slug>/`.

## Dispatch

New work needing its own worktree and agent gets both in one call:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts --repo "$REPO" --branch "$BRANCH" --prompt "$PROMPT_FILE"
```

It creates the worktree off `origin/main`, starts a Claude agent in it through herdr, and prompts it. Read `prompted` on the JSON line: false means herdr never confirmed the agent took the work, so read the pane before reporting the hand-off. `prompted: false` reaches the ledger row too, where `status` reports the thread under `waiting-on-you` until herdr reports its agent working. A failure prints the error, then the partial record once the worktree exists. A dispatch that reaches worktree creation appends to the ledger, whether it completes or lands as `orphaned`. One that fails validation first leaves the ledger unchanged. `--tag <key>=<value>`, repeatable, records who dispatched it and what for (`--tag by=chief`, `--tag project=<slug>`).

Load `herdr:herdr` for the pane mechanics around a dispatched agent: reading it, prompting it again, waiting on it. `worktrunk:wt-switch-create` re-roots this session instead of dispatching.

## Ledger

The ledger is the record of what is out and what came back:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts status --tag project=ledger
bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts outcome --repo "$REPO" --branch "$BRANCH" --state done --pr "$PR_URL"
```

`status` prints the open queue items oldest first, then the projects (one line per `projects/<slug>/project.md`: slug, description, lead state, open thread count), then every open thread, each tagged with its `need`. A thread its agent called `done` stays open while its pull request does. The lead state is `live` when a `lead-<slug>` agent is running, `none` when herdr lists no such agent, and `unknown` when herdr could not be asked, which is not a reason to start one.

Threads sort by need, in this order:

- `waiting-on-you`: herdr reports the thread's agent blocked on a dialog, the dispatch never delivered its prompt and its agent is not working, the ledger records the thread `blocked`, or the agent is gone from a thread still `dispatched` and under a week old.
- `ready-for-review`: the pull request is open, unapproved, and out of draft. A thread whose agent called it `done` stays here until that request merges or closes.
- `landing`: the pull request is approved, merged, or closed. The note says which, and a merged or closed one takes an `outcome` row to record its result.
- `working`: herdr reports the agent working.
- `idle`: herdr reports the agent idle and the thread has no pull request.
- `stale`: the thread's latest row is over a week old and no agent is left.

The list gives sort order. Precedence runs differently: a thread stopped on Ben reports `waiting-on-you` whatever its pull request says, a pull request decides ahead of the thread's age, and age decides ahead of a missing agent.

Pull request state comes from one `gh pr view` per thread, bounded to rows under a fortnight old, and reads `unknown` when gh cannot answer, so a machine offline still gets a status. `--tag <key>=<value>` narrows to the threads carrying each pair. `--json` returns the same as data, with each thread's `need` and, for a thread that has one, its pull request state.

`outcome` appends a row with the thread's new state (`done`, `blocked`, `abandoned`), an optional `--pr`, and a `--note` saying why when it is blocked or abandoned. `--repo` may be any worktree of the repository. The latest row per repo and branch is the thread's state. A `done` outcome carrying a `--pr` also raises a review on the queue and prints that item as a second line, so there is no second command to learn.

## Queue

The queue holds what needs Ben himself. Raise an item as soon as the work stops on him:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts ask --agent "$AGENT" "$QUESTION"
bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts push --review --url "$PR_URL" --repo "$REPO" --branch "$BRANCH" "$WHAT_TO_READ"
```

`ask` raises a question, `push --review` something to read. Both take `--url`, `--repo` and `--branch` to name the thread it came from, `--agent` and `--pane` to say where an answer goes back. Text runs to 500 characters, like a ledger note.

Only Ben clears an item, or a lead writing on his word with `--by <who>`:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts ack <id> [--by <who>]
bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts answer <id> "$ANSWER"
bun ${CLAUDE_SKILL_DIR}/scripts/queue.ts list [--json]
```

`ack` clears an item he only had to see. `answer` records the answer, sends it to the item's agent with `herdr agent prompt`, and records whether that landed. Never answer your own item. A review item pointing at a GitHub pull request or issue clears itself once that request merges or closes, which `status` and `list` check as they read.

## Board

The board renders the queue and the ledger together as a TUI:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/board.ts [--watch]
```

`--watch` re-renders every ten seconds (`--interval <seconds>` overrides it). The queue heads it as `NEEDS YOU`, with the threads the board derived as `waiting-on-you` kept under it as `observed`, then one section per remaining need, each thread's project slug on its row, or its repository where the thread carries no project tag. Without it the board prompts for an item, a project or a thread. An item offers ack, answer, and focus on the pane it came from. A project or a thread focuses that agent's pane or sends it a message. Both views find a thread's agent by the session it was dispatched with, so one that moved panes still reads as itself. The picker falls back to the pane the ledger recorded, and reports that it has no agent to reach when another agent has taken that pane over.

## Projects

`projects/<slug>/project.md` is shaped like a skill: frontmatter `name`, `description`, `repo`, `tracker`, and a body of standing instructions every thread receives. The slug matches `^[a-z][a-z0-9_-]{0,26}$` so that `lead-<slug>` is a legal herdr agent name. A `description` holding a colon is written as a `>-` block scalar, since a plain scalar with one fails to parse and `status` then skips the project with a warning.
