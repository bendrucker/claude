# Oxlint Hook

Runs [oxlint](https://oxc.rs/docs/guide/usage/linter.html) over each file you `Edit` or `Write` and shows any issues as context. It is informational only and never writes to the file, so later edits in the same turn still match what is on disk.

Type-aware rules are skipped here, since tsgolint costs about a second per run however small the file. The pass reads `.oxlintrc.fast.json` where the working tree has one, falling back to the default config. Loading oxlint's JS plugin host costs a fixed ~150ms whatever rules it carries, so the fast config leaves the JS-plugin rules to the commit gate.

oxlint resolves from the module graph, falling back to the main checkout of the same repository, so a fresh worktree gets the pass before anyone runs `bun install`.

## Commit Gate

Formatting, the whole-tree lint and type check, and the import checks run from `.pre-commit-config.yaml`, so a commit made outside Claude gets them too. The `prek` SessionStart entry installs the git hook. The Stop hook (`.claude/hooks/stop/`) runs the same hooks over the files a turn edited, blocking at most twice in a row per session. A run whose only failure is a file oxfmt rewrote passes at Stop, since the rewrite is the fix.
