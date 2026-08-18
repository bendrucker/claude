# Oxlint/Oxfmt Hook

Runs [oxlint](https://oxc.rs/docs/guide/usage/linter.html) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) over the files you edit, splitting them across two events so nothing rewrites a file while a turn is still editing it.

## How It Works

#### During Work (PostToolUse)

When you `Edit` or `Write` a file oxlint understands, it runs and shows any issues as context. This is informational only. It never writes to the file, so your later edits in the same turn still match what is on disk. Formatting is deferred to the Stop and pre-commit gates.

#### Before Stopping (Stop)

When the session ends, oxfmt formats all edited files, oxlint checks them, and a type check runs over each working tree those files belong to (`oxlint --type-aware --type-check`). If issues remain, the session is blocked until they're resolved.

## Pre-Commit Check

The hook does the same on `git commit`, over staged files, and denies the commit if a lint or type error remains. Nothing is auto-fixed beyond formatting, so a lint error blocks whether or not a fixer exists for it. The formatting it applies is restaged, so the commit records the text the check passed.

A staged file carrying further unstaged edits is refused before any of that runs. The check reads working-tree files while the commit records the index, so the two have to hold the same text for its verdict to describe what git is about to write. Stage or stash the working-tree changes and commit again.

## Degraded Runs

Only oxlint is required. When oxfmt cannot be resolved, the gates still lint and type-check and simply skip reformatting, rather than passing silently.

A working tree with no `node_modules` skips the type check and says so in the block reason. tsgolint resolves imports through the dependency tree, so without one it reports every external import as missing, and no edit the session makes can clear that. Lint and formatting still run: the binaries come from Bun's install cache, falling back to the main checkout of the same repository, so a fresh worktree is gated before anyone runs `bun install`.
