# Chief

Triage alerts from Claude sessions, herdr panes, and phone into a tiered ledger so only what needs you gets through.

## Contents

- **Agent**: [`chief`](agents/chief.md) reads the ledger, decides hold or ack per row, and never edits code or pushes.
- **Skill**: [`chief:chief`](skills/chief/SKILL.md) drives the agent's `drain` and `digest` loops from the herdr pane. `disable-model-invocation`, invoked only by the doorbell and the periodic tick.
- **MCP server**: `chief`, a stdio bridge to the daemon's HTTP API (`inbox`, `hold`, `ack`, `drop`, `status`, `why`).

## Testing

```sh
bun test plugins/chief
```

## What Runs Where

Every alert chief triages starts as a hook payload or a herdr event, lands in an append-only ledger, and gets tiered deterministically before chief ever sees it. Chief only decides whether a tiered row surfaces now, waits for a boundary, or waits for the next digest.

| process | where | role |
| --- | --- | --- |
| `chief-tap.ts` hook | every Claude session | posts `Notification`, `PermissionRequest`, `PostToolUse` (`AskUserQuestion`), `Stop`, and `SessionStart` events to the daemon |
| `chief serve` daemon | background, `127.0.0.1:7391` | owns the ledger, the tier table, presence, release timers, and the doorbell |
| act page server | background, `127.0.0.1:7392`, tailnet-served | renders the Hold/Drop page a push opens and applies the tap |
| chief herdr pane | `~/src/chief/`, one persistent pane | runs the `chief` agent via `--agent chief:chief --remote-control`, woken by the doorbell |
| MCP bridge | spawned per session | `bun bin/chief.ts mcp`, stdio-to-HTTP bridge to the daemon, ensuring it's running first |
| bark-server | phone-facing, `127.0.0.1:8090`, tailnet-served | relays encrypted now/boundary pushes to every configured device |

## Install

The plugin runs from the repo checkout that `claude-upgrade` syncs, so nothing installs by hand except a settings file and, for the phone, the dotfiles topic.

1. Merge the dotfiles PR that pins `bark-server`, runs it as a launch agent, and adds the `chief` install step to the `claude` topic, then run its installer. It writes `~/.config/chief/config.json` with an empty `bark.devices` list, ready for the per-device keys below (see Phone below).
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

Phone delivery runs on [Bark](https://github.com/Finb/Bark): the dotfiles installer pins `bark-server` and runs it as a launch agent on `127.0.0.1:8090`, and the daemon serves the act page (the Hold/Drop buttons a push opens) on `127.0.0.1:7392`. Bark's app never leaves a notification stuck after a tap the way ntfy's did, since tapping opens the act page instead of firing an in-app reply, and the page confirms the outcome in place.

The phone can be more than one device (an iPhone, an iPad, a Mac running the Bark app), each with its own device key. `bark.devices` holds one entry per device, `publish` pushes to all of them in one call, and tapping a push from any device opens the same act page. A row already held or dropped from one device shows its state and no buttons when opened from another.

1. Expose both ports on the tailnet, printed by the dotfiles installer:

   ```sh
   tailscale serve --bg --https=8090 http://127.0.0.1:8090
   tailscale serve --bg --https=7392 http://127.0.0.1:7392
   ```

2. Install the Bark app on each device and add a server pointing at the tailnet URL for port 8090.
3. In the app's encryption settings, turn on encryption and match `bark.key` from `~/.config/chief/config.json`: AES-CBC with PKCS7 padding, key length 16 or 32 characters (AES-128 or AES-256), the key and IV used as literal UTF-8 bytes rather than hex-decoded. `bark.ts` generates a fresh random IV per push.
4. Copy each device's key from the app into its own entry in `bark.devices`, then restart the chief pane's session so the daemon picks up the change.
5. Run `chief bell --test` and confirm a push arrives on every device. Tapping it opens the act page with Hold 1h, After meeting, and Drop; tapping the same push on a second device after acting on the first shows the outcome with no buttons.

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
skip - bark server reachable (no bark block in config)
skip - bark devices set (0) (no bark block in config)
pass - act page listening
skip - act page reachable on tailnet (no bark block in config)
skip - herdr agent list (config unavailable)
skip - Focus file readable (config unavailable)
```

`bell --test` appends a sample `now` row to the ledger. Within a minute the daemon pushes it, publishes to every configured device via bark, and prompts the pane with `/chief:chief drain`, which acks it.

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

- [ ] Bark app on each device: server added at the tailnet URL for port 8090, encryption on and matching `bark.key`, device key copied into its own `bark.devices` entry.
- [ ] `chief bell --test` produces a real push on every device, and tapping Hold 1h on one shows the row `held` in the ledger and no buttons when the same push is opened on another device.
- [ ] Calendar and Focus: deferred with the presence slice. `doctor` prints `skip` for them until then, and boundaries fall at the top of the hour.

## Troubleshooting

Keyed by the failing `chief doctor` line:

| line | cause | fix |
| --- | --- | --- |
| `fail - daemon healthz` | no daemon, or a stale `daemon.pid` | start a session in `~/src/chief`, whose bridge respawns it, or delete `~/.local/state/chief/daemon.pid` first |
| `fail - config parses` | `~/.config/chief/config.json` missing or malformed | run the dotfiles installer, or write the file by hand in the shape the installer uses |
| `fail - bark server reachable` | the `bark-server` launch agent is down | check its log under `~/.local/state/bark/` and restart the launch agent |
| `fail - bark devices set (0)` | no device has been added yet | copy each device's key from the Bark app into `bark.devices`, then restart the pane's session |
| `fail - act page listening` | the daemon isn't running, or `CHIEF_ACT_PORT` is already taken | start a session in `~/src/chief`, whose bridge respawns the daemon |
| `skip - act page reachable on tailnet` | `tailscale serve` isn't forwarding port 7392, or the doctor's machine can't reach the tailnet | rerun the `tailscale serve` command for 7392; this check never fails, since the daemon may be reachable from the phone but not from wherever `doctor` runs |
| `fail - herdr agent list` | the configured `herdr.agent` has no live pane | start the pane with the command above |
| `fail - Focus file readable` | `presence.focusFile` moved or is unreadable | fix the path in config; presence is inert until its slice ships |
| `/mcp` shows `plugin:chief:chief` failed | the daemon is running code the bridge cannot talk to | kill the pid in `daemon.pid`, then Reconnect from `/mcp` |
| the pane says `Unknown command: /chief` | the doorbell text lacks the plugin prefix | the skill is `/chief:chief drain` |
| `doorbell: stalled` in `status` | the pane sat at a permission prompt through the retry ladder | clear the prompt in the pane, then `chief bell` |
