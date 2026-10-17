---
fail: []
---
<issue>
```markdown
---
title: Decide between file-backed and in-memory per-chat database state
type: spike
relations:
  related:
    - https://tracker.example.com/issue/TEAM-970
---

Each request opens a fresh in-memory database in `connect_loaded`, so per-chat state is rebuilt on every turn. Decide whether a file-backed workspace in object storage beats that, within one week.

## Questions

- How long does a cold load from object storage take for a typical chat, against today's rebuild?
- What does a concurrent write from two requests on the same chat do to a file-backed workspace?

## Deliverable

A recommendation with benchmark numbers from a real environment, and a follow-up implementation issue if the answer is file-backed.

## 🤖 Agent Context

- `connect_loaded` in `agent/db/connection.py` opens the in-memory database
- `agent/db/workspace.py` would hold the file-backed workspace
```
</issue>
