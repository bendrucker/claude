---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents and read their results, split panes for collaborative file viewing or long-running processes, and correlate panes to Claude sessions. Use when coordinating with another agent, opening a file alongside the user, starting a dev server or log tail the user should watch, capturing another pane's output, or asking what else is running.
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
---

# Herdr

herdr manages the terminal workspace this session runs in. It knows every workspace, pane, and sibling coding agent, including which Claude session occupies which pane.

## Arguments

`$0` (optional verb) routes to a section: `orient` to [Current Workspace](#current-workspace), `agents` to [Sibling Agents](#sibling-agents), `view <file>` to [Collaborative File Viewing](#collaborative-file-viewing), `read <pane>` to [Reading Another Pane](#reading-another-pane). With no verb, answer from the orientation block below.

## Command Surface

herdr ships roughly weekly. This file therefore states no command table of its own. The block below is generated from `--help` at load time and cannot go stale. It lists every group with its subcommands, then the full signature of the handful used most.

!`bash ${CLAUDE_SKILL_DIR}/scripts/commands.sh`

For a command whose flags are not shown above, `herdr <group> <command> --help` is complete: it prints defaults, enumerates valid values for every enum flag, and states preconditions. Where the CLI and this file disagree, the CLI is right and this file is stale.

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

Your own identity comes from the environment, never from inference: `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`.

## Sibling Agents

The most valuable thing herdr offers is a handle on the other agents running alongside you. Each agent pane carries `agent_session.value`, the Claude session UUID. That makes pane-to-session correlation exact, where a title match would only be a guess.

A reference to work by branch, repo, or task usually names a pane already doing it. Match it against the `cwd` and `title` columns in the orientation block, then hand off to that pane instead of duplicating the checkout here.

`agent prompt --wait` blocks through the other agent's turn. A handoff therefore costs two calls:

```bash
herdr agent prompt <target> "the request" --wait --timeout 900000
herdr agent read <target> --lines 80
```

Timeouts are milliseconds. `--wait` matches idle, done, or blocked unless you name states with `--until`. It does not track turns, so an agent that was already working can match on the turn it was in the middle of. Submitting to a resting agent returns `agent_prompt_stalled` when no state change shows up within 5s.

Never poll for a state change with `sleep` and a `pane get` loop. `agent wait` blocks server-side on an agent's state, and `pane wait-output` blocks on text appearing in a plain pane.

`herdr agent focus` brings a pane to the foreground for the user. `herdr agent attach` connects to it directly.

### Agent Status

For Claude, herdr's integration hook reports only session identity. The `idle`, `working`, `blocked`, and `done` states come from matching the pane's screen against a detection manifest. An unusual or suppressed terminal title therefore reads as `unknown`.

Debug that with `herdr agent explain <pane>`. Do not paper over a detection gap by calling `herdr pane report-agent`, which claims lifecycle authority that belongs to the scraper for Claude panes.

## Collaborative File Viewing

When working through a file with the user, open it beside this pane so they watch it change:

```bash
pane=$(herdr pane split --direction right --ratio 0.4 --no-focus | jq -r '.result.pane.pane_id')
herdr pane run "$pane" markless --watch path/to/file.md
```

Use `markless --watch` for markdown and `$EDITOR` for everything else. Keep `--no-focus` so the user's cursor stays where it is.

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
pane=$(herdr pane split --direction down --ratio 0.3 --no-focus --cwd "$PWD" | jq -r '.result.pane.pane_id')
herdr pane run "$pane" "bun run dev"
```

The same single-command limit applies. Reserve `run_in_background` for work the user has no reason to see.

## Reading Another Pane

`herdr pane read <pane_id>` replaces a terminal scrape. The default `--source recent` reads accumulated output history and returns nothing for a pane created moments ago, so use `--source visible` when reading a pane you just made. On an established pane the sources agree. `--source detection` returns the slice the status scraper matches against, which is what to compare when a pane's status looks wrong.

## Plugins

herdr's own capabilities are extended by plugins, and they are discoverable the same way everything else is:

```bash
herdr plugin list
herdr plugin action list | jq -r '.result.actions[] | "\(.plugin_id)  \(.action_id)  \(.title)"'
herdr plugin action invoke <action_id> --plugin <plugin_id>
```

`herdr plugin log list` shows a plugin's command output, which is where to look when an action produces no visible effect. `herdr plugin config-dir <plugin_id>` locates its config.

Filter the action list by platform. Plugins ship Windows variants of the same action, so an unfiltered list shows each one twice.

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

Two invariants worth knowing. reviewr never writes to the worktree, the index, or any branch, which rules it out as the explanation for an unexpected diff. Its one write is a baseline ref under `refs/reviewr/turn-base/`, deliberately outside `refs/heads`. Leave those refs alone.

Its `last-turn` scope reads the same scraped `agent_status` described above, treating a resting-to-working transition as a turn boundary. A turn that finishes inside one poll interval is invisible to it, which is why a very fast edit can be missing from that view.

## Sandbox Limits

Every read command works under the sandbox. Three writes do not, and all three come back `Operation not permitted`:

- `herdr worktree create` writes a checkout outside the allowed paths. Create worktrees with `wt` through the `worktrunk:wt-switch-create` skill instead, then `herdr worktree open` the result. Opening a checkout that already exists is fine.
- `herdr plugin install` and `herdr integration install` write into herdr's own state directories. Both are install-time operations that dotfiles owns, so hand them to the user rather than retrying with the sandbox off.
