---
paths:
  - "schemas/**"
---

# Schemas

`schemas/` holds JSON Schemas for Claude Code config formats, in two kinds.

**Upstream-backed** (`plugin`, `marketplace`, `settings`): the repo holds only our edits, as an RFC 6902 overlay in `overlays/<name>.patch.json`. The upstream base is fetched live from SchemaStore and merged with the overlay in memory at validation time, so no base or merged schema is vendored. Change one by editing the patch, adding an `add` op for a field upstream lacks. See [`overlays/README.md`](../../schemas/overlays/README.md).

**Hand-authored** (`hook`, `plugin-hook`): no upstream exists. Edit `schemas/<name>.schema.json` directly.

`bun run schemas check` (CI) fetches current upstream, fails if an overlay stops applying, flags overlay ops upstream has absorbed, and warns when an `add` op overwrites a definition upstream now ships.
