---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents in other panes (distinct from in-session `Agent` subagents), split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Load this when the decision to hand a task to another pane's agent arrives mid-task, and when opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running. Pane, tab, workspace, and split are herdr's terms. A request naming one is a herdr request even when it never says herdr.
argument-hint: "[orient | agents | view <file> | read <pane>]"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh)
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts:*)
  - Bash(herdr api snapshot:*)
  - Bash(herdr --help:*)
  - Bash(herdr agent --help:*)
  - Bash(herdr pane --help:*)
  - Bash(herdr workspace --help:*)
  - Bash(herdr tab --help:*)
  - Bash(herdr plugin --help:*)
  - Bash(herdr worktree --help:*)
  - Bash(herdr agent prompt --help:*)
  - Bash(herdr agent start --help:*)
  - Bash(herdr agent list:*)
  - Bash(herdr agent get:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent wait:*)
  - Bash(herdr agent explain:*)
  - Bash(herdr pane list:*)
  - Bash(herdr pane get:*)
  - Bash(herdr pane current:*)
  - Bash(herdr pane read:*)
  - Bash(herdr pane layout:*)
  - Bash(herdr pane wait-output:*)
  - Bash(herdr workspace list:*)
  - Bash(herdr worktree list:*)
  - Bash(herdr tab list:*)
  - Bash(herdr plugin list:*)
  - Bash(herdr plugin action list:*)
  - Bash(herdr plugin log list:*)
  - Bash(herdr plugin config-dir:*)
  - Bash(herdr machine list:*)
---

# Herdr

herdr manages the terminal workspace this session runs in, including every pane, tab, and sibling coding agent.

Under `HERDR_ENV=1`, a request naming a pane, tab, workspace, or split is about this session's herdr layout.

## Command Surface

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For flags not shown above, `herdr <group> <command> --help` is complete: defaults, valid values for every enum flag, preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

Bare `herdr` launches or attaches the TUI in this pane. A mutating command in bare form runs on its defaults instead of printing usage, so `herdr workspace create` creates a workspace.

## Current Workspace

!`bun ${CLAUDE_SKILL_DIR}/scripts/orient.ts`

Columns are workspace, then `pane  agent/status  session  cwd  title`, with `cwd` shown only when it differs from the workspace checkout. That view projects `herdr api snapshot`, which returns this machine's workspaces, tabs, panes, layouts, and agents in one call. Prefer it to a sequence of `list` calls, and read it raw when the projection is wrong: `herdr api snapshot | jq .`

If the block reports a failure instead of a workspace listing, stop here and use ordinary tools. Nothing below reaches a server.

## Output Formats

Most commands answer with a single-line JSON envelope. Pipe them through `jq -r '.result...'` rather than reading them raw:

```json fragment
{"id":"cli:pane:list","result":{"panes":[...],"type":"pane_list"}}
```

Others print plain text, and `jq` on those fails with `Invalid numeric literal`. Terminal content and human explanations are one kind: `pane read`, `agent read`, `agent explain`. Anything reporting local installation instead of live session state is the other: `plugin list`, `plugin config-dir`, `config check`, `integration status`, `server agent-manifests`.

Exit 2 is a syntax error, wrong before it reached a server. Exit 1 is a failure at one: JSON on stderr from the local server, and plain text from a `--machine` command that could not reach the remote.

## Addressing

A pane exists whether or not an agent runs in it. `pane` commands drive the raw terminal, and `agent` commands drive the recognized process inside one.

An agent target is a live agent name or the pane ID hosting it, and nothing else. `agent list` prints a `terminal_id` and an `agent` kind beside those, and either one passed as a target yields `agent_not_found`, indistinguishable from a missing agent.

Your own identity comes from the environment, never from inference: `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`. `HERDR_ENV=1` marks a pane herdr launched.

Name a target on every command that takes one. Use `--current` for the calling pane, an explicit ID otherwise. A pane command with no target may resolve to the UI-focused pane, which can belong to the user or another client.

IDs are opaque handles shaped `w1` for a workspace, `w1:t1` for a tab, and `w1:p1` for a pane. Read them out of responses rather than composing them: `pane split` returns `.result.pane`, `tab create` returns `.result.tab` and `.result.root_pane`, `workspace create` returns all three. Closed IDs are never reused. `pane move` mints a new workspace-qualified pane ID, so take the pane forward as `.result.move_result.pane.pane_id` and drop `.result.move_result.previous_pane_id`. The moved process keeps the stale ID in its inherited `HERDR_PANE_ID`, so never take a target from there.

## Machines

The orientation block and `HERDR_*` describe this machine. Before running `herdr machine list`, passing `--machine`, or acting on an ID from another machine, read [`references/machines.md`](references/machines.md).

## Splits

Default to a sibling pane in the current tab under the caller's `$PWD`. A separate workspace, tab, worktree, or directory needs the user to ask for it.

Split `right` on a wide pane and `down` on a tall one, alternating direction across successive splits rather than slicing one axis into an unusable strip. `herdr pane layout --pane "$HERDR_PANE_ID"` reads the shape when it is not obvious.

`--no-focus` keeps the user's cursor where it is. Move focus only when they asked to switch.

## Safety

Leave the server alone. `herdr server stop` takes down every pane process the session owns, this one included, so run it only when the user asks for exactly that. Signalling the main herdr process does the same. An experiment needing its own server gets `herdr --session <name>`.

Close only what you opened. A pane you split for the user to read counts as theirs. Close your own scratch panes with `herdr pane close` when the work is done.

Read another agent's approval dialog and hand it to the user. The user answers it. `agent prompt` refuses a `blocked` agent on its own, and `send-keys` does not check.

Leave lifecycle reporting to herdr's own integration. This plugin's mod reports metadata tokens only. A `pane report-agent` that herdr accepts never decays. A stray `blocked` sent by hand holds the pane until the next report, and `agent prompt` refuses the pane meanwhile.

## Sibling Agents

Each agent pane carries `agent_session.value`, its Claude session UUID.

Work bound for its own pull request always goes through [Dispatch](#dispatch), whatever an existing pane shows. Otherwise hand off only to a pane whose `title` or `cwd` names work in flight there. A `primary` workspace is the repo's main checkout, so no pane under one is a hand-off target whatever `cwd` it prints.

Hand off with `agent prompt --wait`, which blocks until the agent settles at `idle`, `done`, or `blocked`, then collect with `agent read`:

```bash
herdr agent prompt <target> "the request" --wait --timeout 900000
herdr agent read <target> --source recent-unwrapped --lines 80
```

Drop `--wait` to leave an agent running, then collect with `agent wait` and `agent read`.

That wait tracks lifecycle state rather than one turn, so prompting a working agent can return when its earlier turn settles. When no state change follows within five seconds, `agent prompt` returns `agent_prompt_stalled` instead of blocking. `agent wait --until <state>` narrows to the states you name, for a running agent you expect to stop for input.

`agent prompt` pastes through the pane's bracketed-paste mode and presses Enter after a short delay, so a multi-line prompt arrives as one paste.

`agent wait` and `pane wait-output` block server-side, so use them instead of polling `pane get`. For state herdr exposes no wait for, such as a plugin's output through `plugin log list`, use `Monitor`.

An agent sitting in its own interactive UI takes logical key names: `herdr agent send-keys <target> esc`. Modifiers join with `+`, as in `ctrl+c` and `shift+tab`. Only `C-c` and `c-c` are aliased to that form, so any other `-` spelling returns `invalid_key`. In a plain pane, `pane send-text` stages literal text without submitting it, and `pane run` presses Enter.

`herdr agent focus` brings a pane to the foreground for the user. `herdr agent attach` connects to it directly.

### Dispatch

New work needing its own worktree and agent gets both in one call:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/dispatch.ts --repo "$REPO" --branch "$BRANCH" --prompt "$PROMPT_FILE"
```

It creates the worktree off `origin/main`, starts a Claude agent in it, and prompts it. Before reporting the hand-off, read the result fields in [`references/agents.md`](references/agents.md#dispatch-result).

`worktrunk:wt-switch-create` re-roots this session instead.

### Starting an Agent and Status

Before running `agent start` in a pane you split, or when an agent's status (`idle`, `done`, `blocked`, `unknown`) looks wrong, read [`references/agents.md`](references/agents.md).

## Collaborative File Viewing

When working through a file with the user, open it beside this pane so they watch it change:

```bash
pane=$(herdr pane split --current --direction right --ratio 0.4 --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id')
herdr pane run "$pane" markless --watch path/to/file.md
```

Use `markless --watch` for markdown and `$EDITOR` for everything else.

`pane run` hands the command string to the pane's own interactive shell, which parses it a second time. Send one command with ordinary quoting. Write anything longer to a file and run `bash <path>`, since a multi-statement string fails with a bare `parse error` inside the pane where your tool result never shows it.

That shell also inherits the new pane's directory, and mise activates tools per directory. A mise-managed tool available elsewhere can come back `command not found` here. Confirm the pane started the viewer before telling the user to look at it:

```bash
herdr pane read "$pane" --source visible --lines 8
```

Fall back to `glow -w 0` or `bat --paging always`, both installed outside mise.

## Long-Running Processes

A dev server, log tail, build, or REPL the user should watch belongs in a sibling pane instead of `run_in_background`:

```bash
pane=$(herdr pane split --current --direction down --ratio 0.3 --no-focus --cwd "$PWD" | jq -r '.result.pane.pane_id')
herdr pane run "$pane" "bun run dev"
```

The same single-command limit applies. Reserve `run_in_background` for work the user has no reason to see.

To block until the process reaches a known point, match on its output rather than sleeping:

```bash
herdr pane wait-output "$pane" --match "Listening on" --timeout 120000
```

The search covers output already on screen. A line from an earlier run matches immediately. `--match` takes a literal substring, `--regex` a Rust regex. Without `--timeout` the wait is unbounded.

## Reading Another Pane

`herdr pane read <pane_id>` replaces a terminal scrape. The default `--source recent` reads accumulated output history and returns nothing for a pane created moments ago, so use `--source visible` on a pane you just made. On an established pane the sources agree. `recent-unwrapped` is that history with soft wraps joined into whole lines. Use it for logs and transcripts. `--source detection` returns the slice the status scraper matches against, which is what to compare when a pane's status is wrong.

Add `--format ansi` when color is the evidence, as in a diff or a test summary. Otherwise take the text.

The `❯` line at the bottom of a Claude pane carries Claude Code's own prompt suggestion, ghost text the harness wrote rather than input the user typed. Take a pane's content from above that line and leave the line itself out of what you report. When the user asks what is sitting in that prompt, `--format ansi` tells the two apart: a suggestion arrives wrapped in `ESC[2m`, and typed text is unstyled.

`pane read --lines` reads the pane's screen and the host's scrollback. An agent drawing on the terminal's alternate screen writes to neither, so `pane read` misses its scrolled-away rows at any `--lines`. `agent read` recovers them for a recognized agent at rest, paging history out through the agent's own mouse-scroll interface. A deep read during `working`, `blocked`, or `unknown` comes back truncated or as an `agent_not_idle` error. When the history is unreachable either way, ask the agent to write its full response as markdown under a temp directory and reply with nothing but the path, then read the file yourself. Use that fallback only after a read returns too little.

## Plugins

Before invoking a plugin action, reading a plugin's logs, or running `herdr plugin pane open`, read [`references/plugins.md`](references/plugins.md).

A turn carrying `path:line-range` blocks, each with diff lines and reviewer text under it, came from the reviewr sidebar. [`references/reviewr.md`](references/reviewr.md) covers anchoring those comments and the plugin's one-way contract.
