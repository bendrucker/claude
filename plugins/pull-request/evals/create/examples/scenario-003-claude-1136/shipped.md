---
fail: [heading-question]
---
Title: herdr: add a discovery-first workspace skill

Adds a user-level `herdr` skill so Claude can actually drive the terminal workspace manager that replaced tmux as the daily driver.

The gap was measurable rather than theoretical. Every herdr CLI call on the Studio landed inside the migration session itself, with none after, because nothing pointed Claude at the tool. The work machine, which has been using herdr in earnest, spent a quarter of its calls this week re-running `--help` to rediscover the command surface from scratch, and one session guessed the binary name wrong. That re-probing is the metric this skill has to move.

## Why It Refuses to Document the Commands

herdr has cut five stable releases in five weeks plus near-weekly previews, so any command table committed here would be stale within a release cycle. Probing v0.7.5 showed the CLI already documents itself well: leaf `--help` prints defaults, enumerates valid values for every enum flag, and states preconditions. A copy of that in a skill file is strictly worse than the original.

So the skill states the discovery protocol and the small set of facts `--help` cannot express, and tells the reader that the CLI wins wherever the two disagree. `scripts/orient.sh` bang-executes a `jq` projection over `herdr api snapshot`, which replaces four separate `list` calls and leads with the live `version` and `protocol` so drift shows up at load time instead of silently.

## The Non-Derivable Parts

Each of these was verified against a running v0.7.5 rather than inferred:

- Structured queries return a single-line JSON envelope, but `pane read`, `agent read`, and `agent explain` return plain text. An early draft documented `agent read | jq -r '.result.output'`, which fails with a parse error.
- `--source recent` reads accumulated history and comes back empty on a pane created moments ago. `visible` is the one that works there. On an established pane all sources agree.
- `pane run` executes through an interactive shell, and that shell inherits per-directory mise activation, so a mise-managed tool available elsewhere can return `command not found`. Caught this when `markless` failed in a freshly split pane.
- `agent_status` is scraped from the pane's screen against a detection manifest, not reported by the integration hook, which only supplies session identity. That is why a suppressed terminal title reads as `unknown`.
- `agent_session.value` carries the Claude session UUID, making pane-to-session correlation exact where the tmux skill had to match on titles.
- Worktree creation stays with worktrunk, since `herdr worktree create` writes outside the sandbox's allowed paths.

`orient.sh` guards on `HERDR_PANE_ID` before calling out. Unguarded, a missing socket makes `herdr api snapshot` print a raw Rust debug string, and the skill would open on a stack-trace fragment. All four paths were exercised: normal, no env, missing binary, dead socket.

## What This Deliberately Leaves Alone

Retiring `tmux@bendrucker` was the headline candidate going in, and it was wrong. On a two-day-stale view of the work machine the plugin looked dead everywhere. Re-syncing that host inverted it: work is running both multiplexers, with operational `list-panes` and `capture-pane` use in the last two days. Disabling a user-level plugin would have broken live usage on the other machine. The plugin is a clean no-op outside tmux, so it stays until both machines report a quiet week.

## Removal Criteria

The `--help` re-probe count is the signal, and it is queryable from the session index. If it holds steady after this lands, or the skill goes unloaded for two consecutive weeks, the skill is not earning its tokens and should go.
