---
name: relay
description: Pass messages and hand off work between Claude Code sessions running in different tmux panes. Use when coordinating with, messaging, replying to, or handing context to a Claude in another pane or window.
argument-hint: "[send | handoff | reply] <pane> <message>"
allowed-tools:
  - "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/relay.sh:*)"
  - "Bash(bash ${CLAUDE_SKILL_DIR}/../tmux/scripts/sessions.sh)"
  - "Bash(bash ${CLAUDE_SKILL_DIR}/../tmux/scripts/session.sh:*)"
hooks:
  PreToolUse:
    - matcher: "Bash(bash ${CLAUDE_SKILL_DIR}/scripts/:*)"
      hooks:
        - type: command
          command: |
            cat | jq '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "allow"}}'
---

# relay

A handoff protocol for Claude sessions sharing a tmux server. Each session lives
in a pane; `relay.sh` carries a message into another pane's prompt, stamped with
the sender's pane id so the peer knows who it's talking to and where to reply.
Pane ids are server-global, so this works within a window and across windows and
sessions.

## Sending

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/relay.sh <target-pane> <kind> <message...>
```

- `target-pane` — the peer's pane id (e.g. `%3`).
- `kind` — `hello`, `message`, `handoff`, or `ack` (see [Kinds](#kinds)).
- `message` — the body; multiple args join with spaces.

The peer receives a header line plus your body and submits it as its next
prompt:

```
[[tmux-relay from=%4 reply-to=%4 kind=handoff window=main:1]]
<your message>
```

## Finding a peer

You need the target pane's id. Inventory the server with the sibling `tmux`
skill's scripts:

```bash
bash ${CLAUDE_SKILL_DIR}/../tmux/scripts/sessions.sh        # all sessions
bash ${CLAUDE_SKILL_DIR}/../tmux/scripts/session.sh <name>  # windows + pane ids
```

Match the user's reference ("the pane on the X branch", "the window running
tests") to a pane id. Your own pane is `$TMUX_PANE` — never relay to yourself.

## Receiving

When a prompt arrives whose first line is `[[tmux-relay ...]]`, a
`UserPromptSubmit` hook injects the sender's pane, reply target, and kind into
your context. Treat the text after the header as the peer's message:

1. Act on it (or answer it) as the situation warrants.
2. Reply by relaying back to the `reply-to` pane, stamped with your own pane:
   ```bash
   bash ${CLAUDE_SKILL_DIR}/scripts/relay.sh <reply-to> message "<your reply>"
   ```
3. Continue until the request is resolved. Acknowledge completion with an `ack`
   so the peer knows the link is idle.

## Establishing a link

Open with a `hello` so the peer learns your pane id without having to look it
up; it replies with `ack`. After that, both sides hold each other's id and
exchange `message`s freely.

```bash
# pane %4 -> pane %3
bash ${CLAUDE_SKILL_DIR}/scripts/relay.sh %3 hello "Pairing on the auth refactor — ping me when the migration lands."
```

## Kinds

| Kind | Use |
|---|---|
| `hello` | Open a link; announce your pane and intent. Expect an `ack`. |
| `message` | Ongoing exchange once a link is open. |
| `handoff` | Transfer a task. Include enough context to take over: branch/worktree, what's done, what's left, where to look. |
| `ack` | Acknowledge receipt or completion; signals the link is idle. |

## Handing off to a teammate

A handoff is a `message` carrying everything the peer needs to continue without
re-deriving state. Lead with the ask, then the context:

```bash
bash ${CLAUDE_SKILL_DIR}/scripts/relay.sh %3 handoff "Take over the failing e2e suite on branch feat/checkout. \
Root cause is the stubbed clock in tests/setup.ts; I've fixed unit tests, e2e still red. \
Start at tests/e2e/checkout.spec.ts:42. Reply here when green."
```

## Notes

- Relayed text submits as the peer's next prompt. If the peer is mid-turn the
  keystrokes queue until its input is ready, so messages are never dropped but
  may land after the current turn finishes.
- Sending is auto-allowed (the skill's scripts run without a prompt) so an
  autonomous session can drive an exchange. This is deliberate: it makes a
  pane addressable by its peers. Don't relay to a pane the user hasn't asked
  you to coordinate with.
- Both panes must share one tmux server. The sandbox must allow the tmux socket
  — see the plugin [README](../../README.md).
