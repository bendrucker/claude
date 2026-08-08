---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents and read their results, split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Use when coordinating with another agent, opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running. Pane, tab, workspace, and split are herdr's terms, so a request naming one is a herdr request even when it never says herdr.
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

herdr manages the terminal workspace this session runs in. It knows every workspace, pane, and sibling coding agent, including which Claude session occupies which pane.

Under `HERDR_ENV=1`, a request naming a pane, tab, workspace, or split is about this session's herdr layout. Use tmux only when the user says tmux.

## Arguments

`$0` (optional verb) routes to a section: `orient` to [Current Workspace](#current-workspace), `agents` to [Sibling Agents](#sibling-agents), `view <file>` to [Collaborative File Viewing](#collaborative-file-viewing), `read <pane>` to [Reading Another Pane](#reading-another-pane). With no verb, answer from the orientation block below.

## Command Surface

herdr ships roughly weekly. This file therefore states no command table of its own. The block below is generated from `--help` at load time and cannot go stale. It lists every group with its subcommands, then the full signature of the handful used most.

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For a command whose flags are not shown above, `herdr <group> <command> --help` is complete: it prints defaults, enumerates valid values for every enum flag, and states preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

Discovery goes through `--help` in every case. Bare `herdr` launches or attaches the TUI in this pane. A mutating command dropped to its bare form runs on its defaults instead of printing usage, so `herdr workspace create` with no arguments creates a workspace.

## Current Workspace

!`bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh`

Columns are workspace, then `pane  agent/status  session  cwd  title`, with `cwd` shown only when it differs from the workspace checkout. That view is a projection over `herdr api snapshot`, which returns workspaces, tabs, panes, layouts, and agents in one call. Prefer it to a sequence of `list` calls. When the projection looks wrong or omits something, read the source: `herdr api snapshot | jq .`

If the block reports that herdr is not running, stop here and use ordinary tools. Nothing below will reach a server.

## Output Formats

Most commands answer with a single-line JSON envelope. Pipe them through `jq -r '.result...'` rather than reading them raw:

```fragment
{"id":"cli:pane:list","result":{"panes":[...],"type":"pane_list"}}
```

Others print plain text, and `jq` on those dies with `Invalid numeric literal`. Two kinds do it. Terminal content and human explanations are one: `pane read`, `agent read`, `agent explain`. Anything reporting local installation instead of live session state is the other: `plugin list`, `plugin config-dir`, `config check`, `integration status`, `server agent-manifests`. The split runs between siblings, so `plugin action list` returns an envelope while `plugin list` does not.

Failures separate by exit status. A server error exits 1 with a JSON error on stderr, which is worth parsing. A syntax error exits 2, which means the command was wrong before it ever reached the server.

## Addressing

A pane exists whether or not an agent runs in it. `pane` commands drive the raw terminal, and `agent` commands drive the recognized process inside one, addressed by agent name or pane ID.

Your own identity comes from the environment, never from inference: `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`. `HERDR_ENV=1` marks a pane herdr launched. Whether the server still answers is a separate question, which the orientation block above already settled.

Name a target on every command that takes one. Use `--current` for the calling pane, an explicit ID otherwise. A pane command with no target may resolve to the UI-focused pane, and that pane can belong to the user or to another client.

IDs are opaque handles shaped `w1` for a workspace, `w1:t1` for a tab, and `w1:p1` for a pane. Read them out of responses rather than composing them: `pane split` returns `.result.pane`, `tab create` returns `.result.tab` and `.result.root_pane`, `workspace create` returns all three. Closed IDs are never reused. `pane move` mints a new workspace-qualified pane ID, so take the pane forward as `.result.move_result.pane.pane_id` and drop the old value the response echoes at `.result.move_result.previous_pane_id`. The moved process still carries that stale ID in its own inherited `HERDR_PANE_ID`, which makes it useless as a target for anyone else.

## Sibling Agents

Each agent pane carries `agent_session.value`, the Claude session UUID. That makes pane-to-session correlation exact, where a title match would only be a guess.

A reference to work by branch, repo, or task usually names a pane already doing it. Match it against the `cwd` and `title` columns in the orientation block, then hand off to that pane instead of duplicating the checkout here.

`agent prompt --wait` blocks through the other agent's turn. A handoff therefore costs two calls:

```bash
herdr agent prompt <target> "the request" --wait --timeout 900000
herdr agent read <target> --source recent-unwrapped --lines 80
```

Timeouts are milliseconds. `--wait` matches `idle`, `done`, or `blocked` unless you name states with `--until`, which repeats to accept several (`--until idle --until done`) and on `prompt` requires `--wait`. It does not track turns, so an agent that was already working can match on the turn it was in the middle of. Submitting to a resting agent returns `agent_prompt_stalled` when no state change shows up within 5s.

Never poll for a state change with `sleep` and a `pane get` loop. `agent wait` blocks server-side on an agent's state, and `pane wait-output` does the same for text in a plain pane.

An agent parked on its own interactive UI answers to logical key names: `herdr agent send-keys <target> esc`. herdr validates the whole sequence before writing a byte. For staging literal text in a plain pane without submitting it, `pane send-text` is the counterpart, and `pane run` is the one that also presses Enter.

`herdr agent focus` brings a pane to the foreground for the user. `herdr agent attach` connects to it directly.

### Starting an Agent

`agent start` attaches an agent to a pane that already exists and is free, and it creates no layout of its own. The pane has to be sitting at its interactive prompt with nothing running in the foreground. Split first, start second:

```bash
pane=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id')
herdr agent start reviewer --kind claude --pane "$pane"
```

The name becomes the handle every later command uses, so make it descriptive. It has to match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. It binds to the pane's current occupant and clears when that agent exits, is released, or is replaced, which frees the name for the next `agent start`. Arguments meant for the agent's own CLI go after `--`. The call blocks until herdr sees the expected agent ready for input, then gives up at 30 seconds.

### Agent Status

For Claude, herdr's integration hook reports only session identity. The `idle`, `working`, `blocked`, and `done` states come from matching the pane's screen against a detection manifest. An unusual or suppressed terminal title therefore reads as `unknown`.

`idle` and `done` are one resting state, split by whether the pane's tab has been seen. Seen rests at `idle`. Work that finished in a tab nobody looked at rests at `done`. The user focusing that tab marks it seen, and so does a `focus` command you issue yourself. Plain reads never do, so an agent you follow entirely through `agent read` stays `done`.

`blocked` means herdr recognized an approval or question UI. `unknown` means an agent is present and the scraper could not classify it, which is no evidence that it finished.

Debug that with `herdr agent explain <pane>`. Do not paper over a detection gap by calling `herdr pane report-agent`, which claims lifecycle authority that belongs to the scraper for Claude panes.

## Collaborative File Viewing

When working through a file with the user, open it beside this pane so they watch it change:

```bash
pane=$(herdr pane split --current --direction right --ratio 0.4 --no-focus | jq -r '.result.pane.pane_id')
herdr pane run "$pane" markless --watch path/to/file.md
```

Use `markless --watch` for markdown and `$EDITOR` for everything else. Keep `--no-focus` so the user's cursor stays where it is.

`right` suits a wide pane and `down` suits a tall one. Read the shape from `herdr pane layout --pane "$HERDR_PANE_ID"` when it is not obvious, and alternate directions across successive splits rather than slicing one axis down to an unusable strip.

`pane run` hands the command string to the pane's own interactive shell, which parses it a second time. One command with ordinary quoting survives that. A multi-statement script does not: the pane's zsh re-parses it and dies on a bare `parse error`, and that failure lands in the pane rather than in your tool result. Write anything past a single command to a file and run `bash <path>`.

That shell also inherits the new pane's directory, and mise activates tools per directory. A mise-managed tool available elsewhere can still come back `command not found` here. Confirm the pane actually started the viewer before telling the user to look at it:

```bash
herdr pane read "$pane" --source visible --lines 8
```

Fall back to `glow -w 0` or `bat --paging always` when the preferred viewer is missing, both of which are installed outside mise.

A pane opened for the user is theirs, so leave it. Close one you split for your own use (`herdr pane close`) once the work in it is done, rather than leaving the layout littered.

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

`--match` takes a literal substring and `--regex` takes a Rust regular expression. The search runs against the current snapshot before it waits, so text already on screen matches immediately. Omitting `--timeout` waits forever.

## Reading Another Pane

`herdr pane read <pane_id>` replaces a terminal scrape. The default `--source recent` reads accumulated output history and returns nothing for a pane created moments ago, so use `--source visible` when reading a pane you just made. On an established pane the sources agree. `recent-unwrapped` is that same history with soft wraps joined back into whole lines. Use it for logs and transcripts. `--source detection` returns the slice the status scraper matches against, which is what to compare when a pane's status looks wrong.

Add `--format ansi` when color is the evidence, as in a diff or a test summary. Otherwise take the text.

`pane read --lines` draws on the pane's screen and the host's scrollback. An agent painting the terminal's alternate screen feeds neither, so its scrolled-away rows sit beyond `pane read` at any `--lines`. `agent read` recovers them for a recognized agent at rest: past the visible screen, herdr pages the history out through the agent's own mouse-scroll interface. That path needs the agent resting, so a deep read during `working`, `blocked`, or `unknown` comes back truncated or as an `agent_not_idle` error. When the history is unreachable either way, ask the agent to write its full response as markdown under a temp directory and reply with nothing but the path, then read the file yourself. Hold that fallback until a read has actually come up short.

## Plugins

herdr's own capabilities are extended by plugins, and they are discoverable the same way everything else is:

```bash
herdr plugin list
herdr plugin action list | jq -r --arg os macos '.result.actions[] | select(.platforms | index($os)) | "\(.plugin_id)  \(.action_id)  \(.title)"'
herdr plugin action invoke <action_id> --plugin <plugin_id>
```

That `select` is load-bearing. Plugins ship Windows variants of the same action and no platform flag exists, so an unfiltered list shows each one twice.

`herdr plugin log list` shows a plugin's command output, which is where to look when an action produces no visible effect. `herdr plugin config-dir <plugin_id>` locates its config.

`herdr plugin pane open` takes a `--placement` of `overlay`, `split`, `tab`, or `zoomed`. The `split` and `zoomed` placements attach to an existing pane. Both need `--target-pane` and fail with `invalid_params` without it.

### reviewr

A review sidebar that shows the diff you just wrote and takes line comments on it. Its contract with you runs one direction, and misreading that direction is the main way to get this wrong.

You never query reviewr and never poll it. When the user hits Send, reviewr injects the comment batch into your input and stops. It does not submit. The comments therefore reach you as part of an ordinary user turn, usually with their own remarks attached.

Each block takes this shape, ordered by file then line:

```fragment
user/skills/herdr/SKILL.md:41-43
-old line
+new line
the reviewer's text, which may run to several lines
```

- Locate the code by matching the verbatim snippet lines. Your own edits shift line numbers, which makes the snippet the reliable anchor and the header a hint.
- A ` (removed)` suffix on the header means the comment sits on a deleted line. Its snippet comes from the old side and will not be found in the current file.
- Sending clears reviewr's list, and the store is in-memory only. The batch you receive is the only copy. Work through the whole set rather than acting on the first few.

reviewr never writes to the worktree, the index, or any branch, which rules it out as the explanation for an unexpected diff. Its one write is a baseline ref under `refs/reviewr/turn-base/`, deliberately outside `refs/heads`. Leave those refs alone.

Its `last-turn` scope reads the same scraped `agent_status` described above, treating a resting-to-working transition as a turn boundary. A turn that finishes inside one poll interval is invisible to it, which is why a very fast edit can be missing from that view.

## Sandbox Limits

Every read command works under the sandbox. Three writes do not, and all three come back `Operation not permitted`:

- `herdr worktree create` writes a checkout outside the allowed paths. Create worktrees with `wt` through the `worktrunk:wt-switch-create` skill instead, then `herdr worktree open` the result. Opening a checkout that already exists is fine.
- `herdr plugin install` writes into herdr's plugin store and `herdr integration install` writes into the agent's own config tree. Both are install-time operations that dotfiles owns, so hand them to the user rather than retrying with the sandbox off.
