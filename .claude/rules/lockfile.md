---
paths:
  - "bun.lock"
  - "**/package.json"
---

# Lockfile Conflicts

Resolve `bun.lock` conflicts by deleting the lockfile and running `bun install` to regenerate. Do not merge lockfile contents or use `git checkout origin/main -- bun.lock && bun install`, which produces empty integrity hashes for platform-specific packages and breaks CI on other platforms.

See [`plugins/bun/skills/bun/references/lockfile.md`](../../plugins/bun/skills/bun/references/lockfile.md) for the full explanation.
