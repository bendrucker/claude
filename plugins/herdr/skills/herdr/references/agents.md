# Agents

## Dispatch Result

Read `prompted` on the JSON line `dispatch.ts` prints: false means herdr never confirmed the agent took the work, so read the pane before reporting the hand-off. A non-null `retry` means the first submission left the agent idle and the script resent Enter (`enter`) or the whole prompt (`prompt`). A failure prints the error, then the partial record once the worktree exists. Every dispatch appends to `dispatches.jsonl` in the plugin data dir.

## Starting an Agent

`agent start` attaches an agent to an existing free pane, sitting at its interactive prompt with nothing in the foreground. Split first, start second:

```bash
pane=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | jq -r '.result.pane.pane_id')
herdr agent start reviewer --kind claude --pane "$pane"
```

If the command substitution is refused, run the two steps separately and pass `.result.pane.pane_id` to `--pane`.

Only `agent start` binds a name. An agent launched through `pane run` or `pane send-text` never gets one, and `agent start` against that pane returns `agent_pane_busy`. Target it by pane ID, which `agent prompt`, `agent read`, and `agent wait` all accept.

The name is the handle every later command uses, so make it descriptive. It must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. It binds to the pane's current occupant and clears when that agent exits, is released, or is replaced. Arguments for the agent's own CLI go after `--`.

An agent that comes up into a permission or trust dialog returns `agent_not_ready` without waiting out the startup timeout. The name is bound, so `agent read` and `agent send-keys` reach the pane. `agent prompt` stays refused until it settles at `idle`.

## Agent Status

For Claude, the integration hook herdr installs reports only session identity. herdr then refuses lifecycle reports from any other source for that pane. The `idle`, `working`, `blocked`, and `done` states come from matching the pane's screen against a detection manifest, so an unusual or suppressed terminal title reads as `unknown`.

`idle` and `done` are one resting state, split by whether the pane's tab has been seen. A seen tab rests at `idle`. Work that finished in a tab nobody looked at rests at `done`. The user focusing that tab marks it seen, and so does a `focus` command you issue. Plain reads never do, so an agent followed entirely through `agent read` stays `done`.

`blocked` means herdr recognized an approval or question UI. `unknown` means an agent is present and the scraper could not classify it, and does not mean it finished.

`herdr agent explain <pane>` prints the manifest rule that fired, the region it read, and the text it matched.
