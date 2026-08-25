---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents in other panes, distinct from in-session `Agent` subagents, split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Load this when the decision to hand a task to another pane's agent arrives mid-task, and when opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running. Pane, tab, workspace, and split are herdr's terms, so a request naming one is a herdr request even when it never says herdr.
argument-hint: "[orient | agents | view <file> | read <pane>]"
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh)
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh)
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
---

# Herdr

herdr manages the terminal workspace this session runs in, and knows every workspace, pane, and sibling coding agent, including which Claude session occupies which pane.

Under `HERDR_ENV=1`, a request naming a pane, tab, workspace, or split is about this session's herdr layout. Use tmux only when the user says tmux.

## Arguments

`$0` (optional verb) routes to a section: `orient` to [Current Workspace](#current-workspace), `agents` to [Sibling Agents](#sibling-agents), `view <file>` to [Collaborative File Viewing](#collaborative-file-viewing), `read <pane>` to [Reading Another Pane](#reading-another-pane). With no verb, answer from the orientation block below.

## Command Surface

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For a command whose flags are not shown above, `herdr <group> <command> --help` is complete: it prints defaults, enumerates valid values for every enum flag, and states preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

Bare `herdr` launches or attaches the TUI in this pane. A mutating command dropped to its bare form runs on its defaults instead of printing usage, so `herdr workspace create` with no arguments creates a workspace.

## Current Workspace

!`bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh`

Columns are workspace, then `pane  agent/status  session  cwd  title`, with `cwd` shown only when it differs from the workspace checkout. That view projects `herdr api snapshot`, which returns workspaces, tabs, panes, layouts, and agents in one call. Prefer the snapshot to a sequence of `list` calls, and read it directly when the projection looks wrong: `herdr api snapshot | jq .`

If the block reports that herdr is not running, stop here and use ordinary tools. Nothing below will reach a server.

## Output Formats

Most commands answer with a single-line JSON envelope. Pipe them through `jq -r '.result...'` rather than reading them raw:

```fragment
{"id":"cli:pane:list","result":{"panes":[...],"type":"pane_list"}}
```

Others print plain text, and `jq` on those dies with `Invalid numeric literal`. Terminal content and human explanations are one kind: `pane read`, `agent read`, `agent explain`. Anything reporting local installation instead of live session state is the other: `plugin list`, `plugin config-dir`, `config check`, `integration status`, `server agent-manifests`.

Exit 1 is a server error with JSON on stderr: parse it. Exit 2 is a syntax error, wrong before it reached the server.

## Addressing

A pane exists whether or not an agent runs in it. `pane` commands drive the raw terminal, and `agent` commands drive the recognized process inside one.

An agent target is a live agent name or the pane ID hosting it, and nothing else. `agent list` prints a `terminal_id` and an `agent` kind beside those, and either one passed as a target yields `agent_not_found`, indistinguishable from a genuinely absent agent.

Your own identity comes from the environment, never from inference: `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`. `HERDR_ENV=1` marks a pane herdr launched.

Name a target on every command that takes one. Use `--current` for the calling pane, an explicit ID otherwise. A pane command with no target may resolve to the UI-focused pane, and that pane can belong to the user or to another client.

IDs are opaque handles shaped `w1` for a workspace, `w1:t1` for a tab, and `w1:p1` for a pane. Read them out of responses rather than composing them: `pane split` returns `.result.pane`, `tab create` returns `.result.tab` and `.result.root_pane`, `workspace create` returns all three. Closed IDs are never reused. `pane move` mints a new workspace-qualified pane ID, so take the pane forward as `.result.move_result.pane.pane_id` and drop `.result.move_result.previous_pane_id`. The moved process keeps the stale ID in its own inherited `HERDR_PANE_ID`, so never take a target from there.

## Safety

Leave the server alone. `herdr server stop` takes down every pane process the session owns, this one included, so run it only when the user asks for exactly that. Signalling the main herdr process does the same. An experiment needing its own server gets `herdr --session <name>`.

Close only what you opened. A pane you split for the user to read counts as theirs. Close your own scratch panes with `herdr pane close` once the work in them is done.

Read another agent's approval dialog and hand it to the user. Answering it is theirs. `agent prompt` refuses a `blocked` agent on its own, and `send-keys` carries no such check.

Leave lifecycle reporting to the scraper. `pane report-agent` overrides the detection manifest for a Claude pane and leaves herdr's view wrong.

## Sibling Agents

Each agent pane carries `agent_session.value`, the Claude session UUID.

A reference to work by branch, repo, or task usually names a pane already doing it. Match it against the `cwd` and `title` columns in the orientation block, then hand off to that pane instead of duplicating the checkout here.

Hand off with `agent prompt --wait`, which blocks through the other agent's turn, then collect with `agent read`:

```bash
herdr agent prompt <target> "the request" --wait --timeout 900000
herdr agent read <target> --source recent-unwrapped --lines 80
```

Drop `--wait` only to leave an agent running unattended, then collect with `agent wait` followed by `agent read`.

`agent prompt` writes through the pane's live bracketed-paste mode and presses Enter after a short delay, so a multi-line prompt arrives as one paste instead of submitting at the first newline.

`agent wait` and `pane wait-output` block server-side, so use them instead of polling `pane get`. For state herdr exposes no wait for, such as a plugin's output through `plugin log list`, use `Monitor`.

An agent parked on its own interactive UI answers to logical key names: `herdr agent send-keys <target> esc`. Modifiers join with `+`, as in `ctrl+c`, `ctrl+u`, and `shift+tab`. Only `C-c` and `c-c` are aliased to that form, so any other `-` spelling returns `invalid_key`. For staging literal text in a plain pane without submitting it, `pane send-text` is the counterpart, and `pane run` is the one that also presses Enter.

`herdr agent focus` brings a pane to the foreground for the user. `herdr agent attach` connects to it directly.

### Starting an Agent

A sibling agent that needs its own checkout gets it from `herdr worktree create`, which leaves this session where it is. `worktrunk:wt-switch-create` re-roots the calling session instead.

`agent start` attaches an agent to a pane that already exists and is free, sitting at its interactive prompt with nothing running in the foreground. Split first, start second:

```bash
pane=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id')
herdr agent start reviewer --kind claude --pane "$pane"
```

A session that refuses that command substitution takes the same two steps as separate calls, reading `.result.pane.pane_id` out of the split and passing it to `--pane`.

Only `agent start` registers an agent, and only a registered agent answers `agent prompt`, `agent read`, and `agent wait`. Starting one through `pane run` or `pane send-text` fills the pane without registering anything, and `agent start` then returns `agent_pane_busy` against that same pane.

The name becomes the handle every later command uses, so make it descriptive. It has to match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. It binds to the pane's current occupant and clears when that agent exits, is released, or is replaced. Arguments meant for the agent's own CLI go after `--`.

An agent that comes up into a permission or trust dialog returns `agent_not_ready` without waiting out the startup timeout. The name is bound, so `agent read` and `agent send-keys` reach the pane. `agent prompt` stays refused until it settles at `idle`.

### Agent Status

For Claude, herdr's integration hook reports only session identity. The `idle`, `working`, `blocked`, and `done` states come from matching the pane's screen against a detection manifest, so an unusual or suppressed terminal title reads as `unknown`.

`idle` and `done` are one resting state, split by whether the pane's tab has been seen. Seen rests at `idle`. Work that finished in a tab nobody looked at rests at `done`. The user focusing that tab marks it seen, and so does a `focus` command you issue yourself. Plain reads never do, so an agent you follow entirely through `agent read` stays `done`.

`blocked` means herdr recognized an approval or question UI. `unknown` means an agent is present and the scraper could not classify it, which is no evidence that it finished.

Debug that with `herdr agent explain <pane>`, which prints the manifest rule that fired, the region it read, and the text it matched.

## Collaborative File Viewing

When working through a file with the user, open it beside this pane so they watch it change:

```bash
pane=$(herdr pane split --current --direction right --ratio 0.4 --no-focus | jq -r '.result.pane.pane_id')
herdr pane run "$pane" markless --watch path/to/file.md
```

Use `markless --watch` for markdown and `$EDITOR` for everything else. Keep `--no-focus` so the user's cursor stays where it is.

`right` suits a wide pane and `down` suits a tall one. Read the shape from `herdr pane layout --pane "$HERDR_PANE_ID"` when it is not obvious, and alternate directions across successive splits rather than slicing one axis down to an unusable strip.

`pane run` hands the command string to the pane's own interactive shell, which parses it a second time. Send one command with ordinary quoting. Write anything longer to a file and run `bash <path>`, since a multi-statement string dies on a bare `parse error` inside the pane where your tool result never shows it.

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

## Reading Another Pane

`herdr pane read <pane_id>` replaces a terminal scrape. The default `--source recent` reads accumulated output history and returns nothing for a pane created moments ago, so use `--source visible` when reading a pane you just made. On an established pane the sources agree. `recent-unwrapped` is that same history with soft wraps joined back into whole lines. Use it for logs and transcripts. `--source detection` returns the slice the status scraper matches against, which is what to compare when a pane's status looks wrong.

Add `--format ansi` when color is the evidence, as in a diff or a test summary. Otherwise take the text.

`pane read --lines` draws on the pane's screen and the host's scrollback. An agent painting the terminal's alternate screen feeds neither, so its scrolled-away rows sit beyond `pane read` at any `--lines`. `agent read` recovers them for a recognized agent at rest, paging the history out through the agent's own mouse-scroll interface. That path needs the agent resting, so a deep read during `working`, `blocked`, or `unknown` comes back truncated or as an `agent_not_idle` error. When the history is unreachable either way, ask the agent to write its full response as markdown under a temp directory and reply with nothing but the path, then read the file yourself. Hold that fallback until a read has actually come up short.

## Plugins

```bash
herdr plugin list
herdr plugin action list | jq -r --arg os macos '.result.actions[] | select(.platforms | index($os)) | "\(.plugin_id)  \(.action_id)  \(.title)"'
herdr plugin action invoke "$action_id" --plugin "$plugin_id"
```

No platform flag exists, so an unfiltered list shows each action twice.

`herdr plugin log list` shows a plugin's command output, which is where to look when an action produces no visible effect. `herdr plugin config-dir <plugin_id>` locates its config.

`herdr plugin pane open` always needs `--entrypoint` alongside `--plugin`, and exits 2 without it. Its `--placement` then decides which of the addressing flags are legal, and each wrong one comes back `invalid_params`. `--help` lists four placements, and the binary also accepts `popup` and `fullscreen`.

A turn carrying `path:line-range` blocks, each with diff lines and reviewer text under it, came from the reviewr sidebar. [`references/reviewr.md`](references/reviewr.md) covers anchoring those comments and the plugin's one-way contract.
