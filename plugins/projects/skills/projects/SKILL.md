---
name: projects
description: >-
  Dispatch work to a sibling agent in its own worktree, record what each thread returned on the dispatch ledger, and list the projects and open threads. Load this when handing a pull request's worth of work to another agent, when recording that a dispatched thread finished or blocked, when asking what is out and what came back, or when a request names a project, a lead, a thread, or the ledger.
argument-hint: "[status [--tag k=v] | outcome | dispatch]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts:*)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/board.ts:*)
---

# Projects

Everything here reads and writes the plugin data dir, `$CLAUDE_PLUGIN_DATA` or `~/.claude/plugins/data/projects-bendrucker`. The ledger is `dispatches.jsonl` there, append-only and read at query time. Project directories are `projects/<slug>/`.

## Dispatch

New work needing its own worktree and agent gets both in one call:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts --repo "$REPO" --branch "$BRANCH" --prompt "$PROMPT_FILE"
```

It creates the worktree off `origin/main`, starts a Claude agent in it through herdr, and prompts it. Read `prompted` on the JSON line: false means herdr never confirmed the agent took the work, so read the pane before reporting the hand-off. A failure prints the error, then the partial record once the worktree exists. A dispatch that reaches worktree creation appends to the ledger, whether it completes or lands as `orphaned`. One that fails validation first leaves the ledger unchanged. `--tag <key>=<value>`, repeatable, records who dispatched it and what for (`--tag by=chief`, `--tag project=<slug>`).

Load `herdr:herdr` for the pane mechanics around a dispatched agent: reading it, prompting it again, waiting on it. `worktrunk:wt-switch-create` re-roots this session instead of dispatching.

## Ledger

The ledger is the record of what is out and what came back:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts status --tag project=ledger
bun ${CLAUDE_SKILL_DIR}/scripts/ledger.ts outcome --repo "$REPO" --branch "$BRANCH" --state done --pr "$PR_URL"
```

`status` prints the projects (one line per `projects/<slug>/project.md`: slug, description, lead state, open thread count), then every thread whose latest row is `dispatched` or `blocked` and carries each given tag. Without `--tag` it lists every open thread, and `--json` returns the same as data. The lead state is `live` when a `lead-<slug>` agent is running, `none` when herdr lists no such agent, and `unknown` when herdr could not be asked, which is not a reason to start one.

`outcome` appends a row with the thread's new state (`done`, `blocked`, `abandoned`), an optional `--pr`, and a `--note` saying why when it is blocked or abandoned. `--repo` may be any worktree of the repository. The latest row per repo and branch is the thread's state.

The board renders the same data as a TUI:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/board.ts [--watch]
```

`--watch` re-renders every ten seconds (`--interval <seconds>` overrides it), one section per workspace with each project's threads nested under its description. Without it the board prompts for a project or a thread, then focuses that agent's pane or sends it a message.

## Projects

`projects/<slug>/project.md` is shaped like a skill: frontmatter `name`, `description`, `repo`, `tracker`, and a body of standing instructions every thread receives. The slug matches `^[a-z][a-z0-9_-]{0,26}$` so that `lead-<slug>` is a legal herdr agent name. A `description` holding a colon is written as a `>-` block scalar, since a plain scalar with one fails to parse and `status` then skips the project with a warning.
