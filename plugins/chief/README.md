# Chief

Triage alerts from Claude sessions, herdr panes, and phone into a tiered ledger so only what needs you gets through.

## Contents

- **Agent**: [`chief`](agents/chief.md) reads the ledger, decides hold or ack per row, and never edits code or pushes.
- **Skill**: [`chief:chief`](skills/chief/SKILL.md) drives the agent's `drain` and `digest` loops from the herdr pane. `disable-model-invocation`, invoked only by the doorbell and the periodic tick.
- **MCP server**: `chief`, a stdio bridge to the daemon's HTTP API (`inbox`, `hold`, `ack`, `dispatch`, `status`, `why`).

## Testing

```sh
bun test plugins/chief
```

## What Runs Where

Every alert chief triages starts as a hook payload or a herdr event, lands in an append-only ledger, and gets tiered deterministically before chief ever sees it. Chief only decides whether a tiered row surfaces now, waits for a boundary, or waits for the next digest.

| process | where | role |
| --- | --- | --- |
| `chief-tap.ts` hook | every Claude session | posts `Notification`, `PermissionRequest`, `PostToolUse` (`AskUserQuestion`), `Stop`, and `SessionStart` events to the daemon |
| `chief serve` daemon | background, `127.0.0.1:7391` | owns the ledger, the tier table, presence, release timers, the ntfy replies subscription, and the doorbell |
| chief herdr pane | `~/src/chief/`, one persistent pane | runs the `chief` agent via `--agent chief:chief --remote-control`, woken by the doorbell |
| MCP bridge | spawned per session | `bun bin/chief.ts mcp`, stdio-to-HTTP bridge to the daemon, ensuring it's running first |
| ntfy | phone-facing | pushes now/boundary rows, carries hold/drop actions back to the daemon |

## Install

The plugin runs from the repo checkout that `claude-upgrade` syncs, so nothing installs by hand except a settings file and, for the phone, the dotfiles topic.

1. Merge the dotfiles PR that adds the ntfy server config and the `chief` install step to the `claude` topic, then run its installer. It writes `~/.config/chief/config.json` when a server-capable `ntfy` is on `PATH`, and warns otherwise (see Phone below).
2. Run `claude-upgrade` so `~/.claude-repo` carries this plugin from `main`.
3. Create the chief workspace, a plain directory with one settings file:

   ```sh
   mkdir -p ~/src/chief/.claude
   echo '{ "enabledPlugins": { "chief@bendrucker": true } }' > ~/src/chief/.claude/settings.json
   ```

   The plugin stays out of `user/settings.json`, so its seven tool schemas load only in sessions started from this directory.

## The herdr Pane

From any herdr workspace:

```sh
pane=$(herdr pane split --current --direction down --cwd ~/src/chief --no-focus | jq -r '.result.pane.pane_id')
herdr agent start chief --kind claude --pane "$pane" -- --agent chief:chief --remote-control
```

Starting the session spawns the daemon through the plugin's stdio MCP entry (`bun bin/chief.ts mcp`), which writes `daemon.pid` and `daemon.log` under `~/.local/state/chief/`. The daemon outlives the session, and the next session's bridge reuses it. If `/mcp` shows `plugin:chief:chief` as failed, select it and choose Reconnect once. That was needed after a daemon rebuild during integration and has not recurred on a clean start.

The pane stays open. The daemon prompts it with `/chief:chief drain` on every push and release, and with `/flock tick` every 20 minutes inside `presence.workHours`.

To run the pane against a checkout instead of the deployed clone, add `--plugin-dir <checkout>/plugins/chief` before `--agent`. Integration ran exactly that way.

## Phone

Homebrew's `ntfy` for macOS is a client-only build, and so is every upstream macOS release. The dotfiles installer detects this and skips the config until a server-capable binary is on `PATH`. The two options are building upstream's `cli-darwin-server` target from source, or running the official Docker image. Until one is chosen the phone path is dormant and the daemon runs without an `ntfy` block in its config.

Once ntfy serves:

1. Install the ntfy iOS app, set its default server to the tailnet URL the installer printed for `tailscale serve`, and add the token from `~/.config/chief/config.json`. A subscription made before the default server is set goes to `ntfy.sh` with the topic name.
2. Subscribe to the `chief` topic. Now and boundary rows arrive with Hold 1h, After meeting, and Drop buttons, which post to the `chief-replies` topic and land in the ledger as holds and drops.
3. Add the `chief` and `chief-node` upstreams to `~/.config/tailgate/tailgate.hujson` by hand (the snippet is in the dotfiles PR), send tailgate SIGHUP, then add tailgate's `chief` URL as an Open Minis connector and complete the consent page.

## Verifying

The plugin's CLI runs from the checkout:

```sh
chief() { bun ~/.claude-repo/plugins/chief/bin/chief.ts "$@"; }
chief doctor
chief bell --test
```

`doctor` prints one line per check. On a machine with the daemon up and no config yet it reads:

```
pass - daemon healthz
fail - config parses (missing: /Users/ben/.config/chief/config.json)
skip - ntfy reachable (config unavailable)
skip - ntfy replies subscription connected (daemon-side; see status)
skip - herdr agent list (config unavailable)
skip - Focus file readable (config unavailable)
```

`bell --test` appends a sample `now` row to the ledger. Within a minute the daemon pushes it, publishes to ntfy when configured, and prompts the pane with `/chief:chief drain`, which acks it.

These ran during integration and are the same checks to repeat after install:

```sh
# a permission prompt tiers boundary, releases three minutes later, and resolves on SessionStart
echo '{"hook_event_name":"Notification","session_id":"s1","notification_type":"permission_prompt","message":"Claude needs your permission","cwd":"/tmp"}' | bun ~/.claude/hooks/chief-tap.ts
echo '{"hook_event_name":"SessionStart","session_id":"s1","cwd":"/tmp"}' | bun ~/.claude/hooks/chief-tap.ts
# an AskUserQuestion tiers boundary with releaseAt at the top of the next hour (presence stub)
echo '{"hook_event_name":"PostToolUse","session_id":"s2","tool_name":"AskUserQuestion","tool_input":{},"cwd":"/tmp"}' | bun ~/.claude/hooks/chief-tap.ts
# a credential message tiers now and rings the pane within a minute
echo '{"hook_event_name":"Notification","session_id":"s3","notification_type":"info","message":"token expired, please authenticate","cwd":"/tmp"}' | bun ~/.claude/hooks/chief-tap.ts
jq -c '{id, tier, state, releaseAt}' ~/.local/state/chief/ledger.jsonl
herdr agent read chief --source recent-unwrapped --lines 20
# the flock tick, shortened to a minute, against a throwaway state dir
CHIEF_STATE_DIR=/tmp/chief-probe CHIEF_CONFIG=<config with workHours covering now> CHIEF_PORT=7398 CHIEF_FLOCK_INTERVAL_MS=60000 chief serve
```

Things only you can check, once the phone pieces are installed:

- [ ] ntfy iOS app: default server set to the tailnet URL with the token, subscribed to `chief`, so `ntfy.sh` never sees the topic name.
- [ ] Tailscale on the phone connected and the tailgate consent page reachable.
- [ ] Open Minis: tailgate's `chief` URL added as a connector, consent completed, `status` answers.
- [ ] `chief bell --test` produces a real push with three buttons, and tapping Hold 1h shows the row as `held` in the ledger.
- [ ] tailgate picked up the two upstreams after SIGHUP: the consent page lists `chief`.
- [ ] Calendar and Focus: deferred with the presence slice. `doctor` prints `skip` for them until then, and boundaries fall at the top of the hour.

## Troubleshooting

Keyed by the failing `chief doctor` line:

| line | cause | fix |
| --- | --- | --- |
| `fail - daemon healthz` | no daemon, or a stale `daemon.pid` | start a session in `~/src/chief`, whose bridge respawns it, or delete `~/.local/state/chief/daemon.pid` first |
| `fail - config parses` | `~/.config/chief/config.json` missing or malformed | run the dotfiles installer, or write the file by hand in the shape the installer uses |
| `fail - ntfy reachable` | the server is down or the token was rotated | check `ntfy serve` and the token in config, then restart the daemon so it resubscribes |
| `fail - herdr agent list` | the configured `herdr.agent` has no live pane | start the pane with the command above |
| `fail - Focus file readable` | `presence.focusFile` moved or is unreadable | fix the path in config; presence is inert until its slice ships |
| `/mcp` shows `plugin:chief:chief` failed | the daemon is running code the bridge cannot talk to | kill the pid in `daemon.pid`, then Reconnect from `/mcp` |
| the pane says `Unknown command: /chief` | the doorbell text lacks the plugin prefix | the skill is `/chief:chief drain` |
| `doorbell: stalled` in `status` | the pane sat at a permission prompt through the retry ladder | clear the prompt in the pane, then `chief bell` |
