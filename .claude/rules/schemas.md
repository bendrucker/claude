---
paths:
  - "schemas/**"
---

# Schemas

`schemas/` holds JSON Schemas for Claude Code config formats. Two kinds:

- **Upstream-backed** (`plugin`, `marketplace`, `settings`): the repo holds only
  our edits as an RFC 6902 overlay (`overlays/<name>.patch.json`). The upstream
  base is fetched live from SchemaStore and **merged with the overlay in memory
  at validation time** — no base or merged schema is vendored. To change one,
  edit the patch (add an `add` op for a field upstream lacks). See
  [`overlays/README.md`](../../schemas/overlays/README.md).
- **Hand-authored** (`hook`, `plugin-hook`): no upstream exists; edit
  `schemas/<name>.schema.json` directly.

`bun run schemas check` (CI) fetches current upstream, fails if an overlay stops
applying, and flags overlay ops upstream has absorbed so they can be dropped.
