---
name: herdr
description: >-
  Drive the herdr terminal workspace manager: inspect workspaces, tabs, and panes, hand work to sibling coding agents and read their results, split panes for collaborative file viewing, and correlate panes to Claude sessions. Use when coordinating with another agent, opening a file alongside the user, capturing another pane's output, or asking what else is running.
argument-hint: "[orient | agents | view <file> | read <pane>]"
allowed-tools:
  - Bash(bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh)
  - Bash(herdr api snapshot:*)
  - Bash(herdr --help:*)
  - Bash(herdr agent list:*)
  - Bash(herdr agent get:*)
  - Bash(herdr agent read:*)
  - Bash(herdr agent explain:*)
  - Bash(herdr pane list:*)
  - Bash(herdr pane get:*)
  - Bash(herdr pane read:*)
  - Bash(herdr workspace list:*)
  - Bash(herdr tab list:*)
---

# Herdr

herdr manages the terminal workspace this session runs in. It knows every workspace, pane, and sibling coding agent, including which Claude session occupies which pane.

## Arguments

`$0` (optional verb) routes to a section: `orient` to [Current Workspace](#current-workspace), `agents` to [Working With Sibling Agents](#working-with-sibling-agents), `view <file>` to [Collaborative File Viewing](#collaborative-file-viewing), `read <pane>` to [Capturing Another Pane](#capturing-another-pane). With no verb, answer from the orientation block below.

## Check Help Before Composing a Call

herdr ships roughly weekly. This file deliberately does not restate its command surface, because a copy of `--help` output goes stale between releases.

Before composing any call, run `herdr <group> --help` for the subcommand list and `herdr <group> <command> --help` for its arguments. Leaf help is complete: it prints defaults, enumerates valid values for every enum flag, and states preconditions. Where this file and the CLI disagree, the CLI is right and this file is stale.

The orientation block below prints the running `version` and `protocol`. If either has moved well past what you see in the examples here, trust `--help` over the examples.

## Current Workspace

!`bash ${CLAUDE_SKILL_DIR}/scripts/orient.sh`

That view is a projection over `herdr api snapshot`, which returns workspaces, tabs, panes, layouts, and agents in one call. Prefer it to a sequence of `list` calls. When the projection looks wrong or omits something, read the source: `herdr api snapshot | jq .`

If the block reports that herdr is not running, stop here and use ordinary tools. Nothing below will reach a server.

## Reading the Output

Structured queries answer with a single-line JSON envelope. Pipe them through `jq -r '.result...'` rather than reading them raw:

```json
{"id":"cli:pane:list","result":{"panes":[...],"type":"pane_list"}}
```

Commands that return terminal content or a human explanation print plain text instead, with no envelope. `pane read`, `agent read`, and `agent explain` are all in that group. Piping those through `jq` fails with a parse error.

Your own identity comes from the environment, never from inference: `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`, `HERDR_SOCKET_PATH`.

## Working With Sibling Agents

The most valuable thing herdr offers is a handle on the other agents running alongside you. Each agent pane carries `agent_session.value`, the Claude session UUID. That makes pane-to-session correlation exact, where a title match would only be a guess.

The loop is find, hand off, wait, collect:

```bash
herdr agent list | jq -r '.result.agents[] | "\(.pane_id) \(.agent_status) \(.foreground_cwd)"'
herdr agent prompt <target> "the request"
herdr agent wait <target> --until idle --timeout 600000
herdr agent read <target> --source recent --lines 80
```

`agent read` prints the pane's text directly. It needs no `jq`.

A reference to work by branch, repo, or task usually names a pane already doing it. Match it against the `cwd` and `title` columns in the orientation block, then hand off to that pane instead of duplicating the checkout here.

`herdr agent focus` brings a pane to the foreground for the user. `herdr agent attach` connects to it directly.

### Where Agent Status Comes From

For Claude, herdr's integration hook reports only session identity. The `idle`, `working`, `blocked`, and `done` states come from matching the pane's screen against a detection manifest. An unusual or suppressed terminal title therefore reads as `unknown`.

Debug that with `herdr agent explain <pane>`. Do not paper over a detection gap by calling `herdr pane report-agent`, which claims lifecycle authority that belongs to the scraper for Claude panes.

## Collaborative File Viewing

When working through a file with the user, open it beside this pane so they watch it change:

```bash
pane=$(herdr pane split --direction right --ratio 0.4 --no-focus | jq -r '.result.pane.pane_id')
herdr pane run "$pane" markless --watch path/to/file.md
```

Use `markless --watch` for markdown and `$EDITOR` for everything else. Keep `--no-focus` so the user's cursor stays where it is.

`pane run` executes through an interactive shell, so quoting and shell syntax behave normally. That shell inherits the new pane's directory, and mise activates tools per directory. A mise-managed tool available elsewhere can still come back `command not found` here. Confirm the pane actually started the viewer before telling the user to look at it:

```bash
herdr pane read "$pane" --source visible --lines 8
```

Fall back to `glow -w 0` or `bat --paging always` when the preferred viewer is missing, both of which are installed outside mise.

## Capturing Another Pane

`herdr pane read <pane_id>` replaces a terminal scrape. Check `--help` for the current `--source` values and line limits. To block until something appears, use `herdr pane wait-output` with `--match` or `--regex`.

`--source recent` reads accumulated output history and returns nothing for a pane created moments ago. Use `--source visible` when reading a pane you just made. On an established pane the sources agree.

## Worktrees Belong to Worktrunk

Create worktrees with `wt` through the `worktrunk:wt-switch-create` skill. `herdr worktree create` writes outside the sandbox's allowed paths and fails there. Opening a checkout that already exists is fine.
