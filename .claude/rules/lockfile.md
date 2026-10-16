---
paths:
  - "bun.lock"
  - "**/package.json"
---

# Lockfile Conflicts

Resolve a `bun.lock` conflict by regenerating it in a clean detached worktree at `origin/main`. Copy in only the resolved `package.json` files, run `bun install` there (sandbox disabled), confirm the lockfile diff is only the intended deps, copy it back, then run `bun install --frozen-lockfile` locally. A bare `rm bun.lock && bun install` floats every transitive dependency. Do not merge lockfile contents, and do not use `git checkout origin/main -- bun.lock && bun install`, which leaves empty integrity hashes for platform-specific packages.

See [`plugins/bun/skills/bun/references/lockfile.md`](../../plugins/bun/skills/bun/references/lockfile.md) for the commands.
