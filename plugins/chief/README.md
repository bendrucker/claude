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

1. Merge the dotfiles PR that adds the `chief` topic (ntfy, launch agents if any, and the `~/src/chief` directory setup).
2. Run `claude-upgrade` so `~/.claude-repo` picks up this plugin from `main`.
3. Create `~/src/chief/.claude/settings.json`:

   ```json
   { "enabledPlugins": { "chief@bendrucker": true } }
   ```

   The plugin stays out of `user/settings.json`, so its tools only load in sessions started from this directory.

## The herdr Pane

From any herdr workspace:

```sh
herdr pane split --cwd ~/src/chief
herdr agent start chief --kind claude --pane <pane> -- --agent chief:chief --remote-control
```

The pane stays open. The daemon's doorbell prompts it with `/chief:chief drain` on every push and release; the 20-minute `workHours` tick prompts `/flock`.

## Phone

1. Install the ntfy iOS app and point it at the tailnet URL for the daemon's ntfy instance.
2. Subscribe to the `chief` topic using the token from `~/.config/chief/config.json`.
3. Add the Open Minis connector for tailgate's `chief` URL and complete its consent page.

## Verifying

```sh
chief doctor
chief bell --test
```

`doctor` checks the daemon, the ledger, presence readers, and the ntfy subscription. `bell --test` pushes a synthetic now-tier row through to the phone without touching the ledger.

<!-- coordinator: paste the commands that ran during integration here -->

## Troubleshooting

Keyed by the failing `chief doctor` line:

| line | cause | fix |
| --- | --- | --- |
| `daemon: unreachable` | `chief serve` isn't running or `daemon.pid` is stale | delete `~/.local/state/chief/daemon.pid` and start a session so the MCP bridge respawns it |
| `ledger: unwritable` | `~/.local/state/chief/` missing or wrong permissions | create the directory, owned by your user |
| `presence: focus reader failed` | `Assertions.json` path changed or DND permissions revoked | re-grant Focus Status access, check `presence.focusFile` in config |
| `presence: calendar reader failed` | `calendar/main.swift` not built | run `bun run build:calendar` |
| `ntfy: subscription closed` | ntfy server restarted or token rotated | confirm the token in config matches the ntfy user, restart the daemon |
| `doorbell: stalled` | the chief pane sat at a permission prompt through the whole retry ladder | clear the prompt in the pane by hand, then re-run `chief bell --test` |
