# Lockfile

`bun.lock` is a text-based lockfile. Bun populates integrity hashes for all platforms from the registry, even for packages not downloaded locally.

## Conflict Resolution

Regenerate:

```bash
rm bun.lock && bun install
```

Do **not** use `git checkout origin/main -- bun.lock && bun install` — it produces empty integrity hashes for platform-specific packages (e.g., `@img/sharp-libvips-linux-x64`), breaking CI on other platforms.
