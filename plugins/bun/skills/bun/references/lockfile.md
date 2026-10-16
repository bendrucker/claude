# Lockfile

`bun.lock` is a text-based lockfile. Bun populates integrity hashes for all platforms from the registry, even for packages not downloaded locally.

## Conflict Resolution

Regenerate the lockfile from `origin/main` with only the resolved manifests applied, so the only versions that move are the ones the conflicting change intended:

```bash
git fetch origin
git worktree add --detach tmp/lockfile origin/main
cp package.json tmp/lockfile/package.json   # repeat for each resolved package.json
(cd tmp/lockfile && bun install)             # run with the sandbox disabled, a sandboxed install hangs
git -C tmp/lockfile diff bun.lock            # confirm only the intended dependencies changed
cp tmp/lockfile/bun.lock bun.lock
git worktree remove tmp/lockfile
bun install --frozen-lockfile
```

Do **not** run `rm bun.lock && bun install`. It re-resolves every transitive dependency to its latest matching version, which can pull in breaking releases and fail CI.

Do **not** use `git checkout origin/main -- bun.lock && bun install`. It produces empty integrity hashes for platform-specific packages (e.g., `@img/sharp-libvips-linux-x64`), breaking CI on other platforms.

Do not merge lockfile contents by hand.
