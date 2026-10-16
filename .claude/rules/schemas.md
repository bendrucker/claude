---
paths:
  - "schemas/**"
---

# Schemas

**Upstream-backed** (`plugin`, `marketplace`, `settings`): the repo holds only our edits, as an RFC 6902 overlay in `overlays/<name>.patch.json`. The upstream base is fetched live from SchemaStore and merged with the overlay in memory at validation time, so no base or merged schema is vendored. Change one by editing the patch, adding an `add` op for a field upstream lacks. See [`overlays/README.md`](../../schemas/overlays/README.md).

**Hand-authored** (`hook`, `plugin-hook`): no upstream exists. Edit `schemas/<name>.schema.json` directly.
