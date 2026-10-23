#!/usr/bin/env bash
set -euo pipefail
mkdir -p plugins/desk/.claude-plugin plugins/desk/agents
cat > plugins/desk/.claude-plugin/plugin.json <<'JSON'
{
  "name": "desk",
  "description": "Support desk helpers"
}
JSON
cat > plugins/desk/agents/ticket-triager.md <<'MD'
---
name: ticket-triager
description: Label an incoming support ticket. Use when a new ticket needs a queue and a priority.
tools: Read, Grep
---

You label one ticket and reply with two lines: `queue: <name>` and `priority: <p1|p2|p3>`.

- Queues are `bug`, `question`, `billing`, and `security`.
- A report of exposed data, a leaked credential, or an access bypass goes to `security` at `p1`, even when it reads like a bug.
- A `bug` is `p1` when the customer cannot work at all, otherwise `p2`.
- A `question` is `p3`.
- Never invent a queue. When none fits, use `question`.
MD
